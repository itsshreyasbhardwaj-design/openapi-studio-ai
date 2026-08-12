import { z } from "zod";
import {
  runCollection,
  runStats,
  type ExecutionOutcome,
  type Transport,
} from "@/lib/core/testing/runner";
import type { PreparedRequest } from "@/lib/core/testing/request";
import { getRepository } from "@/lib/repository";
import { NotFoundError } from "@/lib/repository/types";
import { ForbiddenError } from "@/lib/server/auth";
import { jsonResponse, readJson, route } from "@/lib/server/http";
import { assertSafeUrl, sanitizeForwardHeaders, DEFAULT_POLICY } from "@/lib/server/ssrf";
import { newId } from "@/lib/utils/id";
import { resolveVariables } from "../../environments/route";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  collectionId: z.string().min(1),
  environmentId: z.string().nullable().default(null),
  stopOnFailure: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(60_000).default(20_000),
  specId: z.string().optional(),
});

/** SSRF-guarded transport used by the collection runner. */
function makeTransport(timeoutMs: number): Transport {
  return async (prepared: PreparedRequest): Promise<ExecutionOutcome> => {
    const check = await assertSafeUrl(prepared.url, DEFAULT_POLICY);
    if (!check.ok) {
      return {
        status: 0,
        statusText: "Blocked",
        headers: {},
        body: "",
        durationMs: 0,
        sizeBytes: 0,
        error: check.reason,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();

    try {
      const response = await fetch(check.url, {
        method: prepared.method,
        headers: sanitizeForwardHeaders({ ...prepared.headers }),
        body: prepared.body ?? undefined,
        signal: controller.signal,
        redirect: "manual",
      });

      const text = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: text,
        durationMs: Math.round(performance.now() - started),
        sizeBytes: new TextEncoder().encode(text).length,
        error: null,
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        status: 0,
        statusText: aborted ? "Timeout" : "Network error",
        headers: {},
        body: "",
        durationMs: Math.round(performance.now() - started),
        sizeBytes: 0,
        error: aborted
          ? `Timed out after ${timeoutMs}ms.`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

/** Execute a saved collection as an automated test suite. */
export const POST = route(
  async ({ request, identity, log }) => {
    const body = await readJson(request, schema);
    const repository = await getRepository();
    const workspace = await repository.ensureWorkspace(identity.userId);

    const collection = await repository.getCollection(body.collectionId);
    if (!collection) throw new NotFoundError("Collection", body.collectionId);
    if (collection.workspaceId !== workspace.id) throw new ForbiddenError();

    const variables = await resolveVariables(identity.userId, body.environmentId);
    const run = await runCollection(collection, makeTransport(body.timeoutMs), {
      stopOnFailure: body.stopOnFailure,
      variables,
    });

    const specId = body.specId ?? collection.specId;
    if (specId) {
      for (const result of run.results) {
        if (result.status === 0) continue;
        await repository.recordMetric({
          id: newId("mtr"),
          specId,
          timestamp: new Date().toISOString(),
          method: "TEST",
          path: result.name.slice(0, 200),
          status: result.status,
          durationMs: result.durationMs,
          source: "client",
        });
      }
    }

    log.info("test.run", {
      collectionId: collection.id,
      passed: run.passed,
      failed: run.failed,
      durationMs: run.durationMs,
    });

    return jsonResponse({ run, stats: runStats(run) });
  },
  { scope: "test:run", limit: 30 },
);
