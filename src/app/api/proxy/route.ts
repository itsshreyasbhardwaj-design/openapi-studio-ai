import { z } from "zod";
import { evaluateAssertions } from "@/lib/core/testing/assertions";
import { getRepository } from "@/lib/repository";
import { jsonResponse, readJson, route, ApiError } from "@/lib/server/http";
import { assertSafeUrl, sanitizeForwardHeaders, DEFAULT_POLICY } from "@/lib/server/ssrf";
import { newId } from "@/lib/utils/id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const assertionSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "status",
    "statusRange",
    "header",
    "jsonPath",
    "bodyContains",
    "responseTime",
    "schema",
  ]),
  target: z.string().max(200),
  operator: z.enum([
    "equals",
    "notEquals",
    "contains",
    "matches",
    "lessThan",
    "greaterThan",
    "exists",
  ]),
  expected: z.string().max(2000),
});

const schema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().min(1).max(4000),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(1_000_000).nullable().default(null),
  timeoutMs: z.number().int().min(100).max(60_000).default(30_000),
  assertions: z.array(assertionSchema).max(50).default([]),
  specId: z.string().optional(),
});

const MAX_RESPONSE_BYTES = 2_000_000;

/**
 * Execute a user-authored HTTP request from the server.
 *
 * The browser cannot call arbitrary APIs directly (CORS), so the client proxies
 * through here. That makes this endpoint an SSRF sink, which is why every target
 * is checked against {@link assertSafeUrl} and hop-by-hop/identity headers are
 * stripped before the request leaves the process.
 */
export const POST = route(
  async ({ request, log }) => {
    const body = await readJson(request, schema);

    const check = assertSafeUrl(body.url, DEFAULT_POLICY);
    if (!check.ok) throw ApiError.badRequest(check.reason);

    const headers = sanitizeForwardHeaders(body.headers);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), body.timeoutMs);
    const started = performance.now();

    try {
      const response = await fetch(check.url, {
        method: body.method,
        headers,
        body: body.body === null || ["GET", "HEAD"].includes(body.method) ? undefined : body.body,
        signal: controller.signal,
        redirect: "manual",
      });

      const raw = await response.arrayBuffer();
      const truncated = raw.byteLength > MAX_RESPONSE_BYTES;
      const text = new TextDecoder().decode(truncated ? raw.slice(0, MAX_RESPONSE_BYTES) : raw);
      const durationMs = Math.round(performance.now() - started);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const snapshot = {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: text,
        durationMs,
      };

      if (body.specId) {
        const repository = await getRepository();
        await repository.recordMetric({
          id: newId("mtr"),
          specId: body.specId,
          timestamp: new Date().toISOString(),
          method: body.method,
          path: check.url.pathname,
          status: response.status,
          durationMs,
          source: "client",
        });
      }

      log.info("proxy.request", {
        method: body.method,
        host: check.url.host,
        status: response.status,
        durationMs,
      });

      return jsonResponse({
        ...snapshot,
        sizeBytes: raw.byteLength,
        truncated,
        assertions: evaluateAssertions(body.assertions, snapshot),
        error: null,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const message = aborted
        ? `The request timed out after ${body.timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : String(error);
      log.warn("proxy.failed", { host: check.url.host, error: message });

      return jsonResponse({
        status: 0,
        statusText: aborted ? "Timeout" : "Network error",
        headers: {},
        body: "",
        durationMs: Math.round(performance.now() - started),
        sizeBytes: 0,
        truncated: false,
        assertions: [],
        error: message,
      });
    } finally {
      clearTimeout(timeout);
    }
  },
  { scope: "proxy", limit: 240 },
);
