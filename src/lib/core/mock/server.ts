import { RefResolver } from "@/lib/core/openapi/deref";
import { createRandom, exampleFromSchema, hashSeed } from "@/lib/core/openapi/examples";
import { effectiveSecurity } from "@/lib/core/openapi/navigate";
import {
  isReference,
  type Header,
  type Json,
  type MediaType,
  type OpenApiDocument,
  type OperationEntry,
  type Response as OpenApiResponse,
  type Schema,
  type SecurityScheme,
} from "@/lib/core/openapi/types";
import { matchOperation } from "./match";

export type MockScenario = "success" | "error" | "random";

export interface MockOptions {
  /** Which class of response to return. Default: `success`. */
  readonly scenario?: MockScenario;
  /** Force a specific documented status code. */
  readonly statusCode?: string;
  /** Artificial latency in milliseconds. */
  readonly delayMs?: number;
  /** Probability (0–1) of returning a documented error in `random` scenario. */
  readonly errorRate?: number;
  /** Enforce the operation's security requirements. Default: true. */
  readonly enforceAuth?: boolean;
  /** Validate required parameters and request body. Default: true. */
  readonly validateRequest?: boolean;
  /** Seed for deterministic payloads. */
  readonly seed?: string;
  /** Prefer `example`/`examples` from the document over generated data. */
  readonly preferDeclaredExamples?: boolean;
}

export interface MockRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

export interface MockResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly delayMs: number;
  readonly matched: boolean;
  readonly operationId: string | null;
  readonly path: string | null;
  /** Why this particular response was produced — surfaced in the mock console. */
  readonly explanation: string;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function problem(
  status: number,
  title: string,
  detail: string,
  explanation: string,
  extra: Record<string, Json> = {},
  headers: Record<string, string> = {},
): MockResult {
  return {
    status,
    headers: { ...JSON_HEADERS, ...headers, "x-mock-server": "openapi-studio-ai" },
    body: JSON.stringify({ error: { status, title, detail, ...extra } }, null, 2),
    delayMs: 0,
    matched: false,
    operationId: null,
    path: null,
    explanation,
  };
}

function pickStatus(
  entry: OperationEntry,
  options: MockOptions,
  random: () => number,
): { code: string; reason: string } {
  const codes = Object.keys(entry.operation.responses ?? {});
  if (codes.length === 0)
    return { code: "200", reason: "No responses documented; defaulted to 200." };

  if (options.statusCode && codes.includes(options.statusCode)) {
    return {
      code: options.statusCode,
      reason: `Explicitly requested status ${options.statusCode}.`,
    };
  }

  const success = codes.filter((code) => code.startsWith("2"));
  const failure = codes.filter((code) => code.startsWith("4") || code.startsWith("5"));
  const scenario = options.scenario ?? "success";

  if (scenario === "error" && failure.length > 0) {
    const chosen = failure[Math.floor(random() * failure.length)] ?? failure[0]!;
    return { code: chosen, reason: "Error scenario selected a documented failure response." };
  }
  if (scenario === "random" && failure.length > 0 && random() < (options.errorRate ?? 0.15)) {
    const chosen = failure[Math.floor(random() * failure.length)] ?? failure[0]!;
    return { code: chosen, reason: "Random scenario simulated a documented failure." };
  }
  const chosen = success[0] ?? codes.find((code) => code !== "default") ?? codes[0]!;
  return { code: chosen, reason: `Returned the documented ${chosen} response.` };
}

function headerExamples(
  headers: Record<string, unknown> | undefined,
  document: OpenApiDocument,
  resolver: RefResolver,
  seed: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, rawHeader] of Object.entries(headers ?? {})) {
    const header = resolver.tryResolve<Header>(rawHeader);
    if (!header) continue;
    const value = exampleFromSchema(
      header.schema ? (resolver.tryResolve<Schema>(header.schema) ?? undefined) : undefined,
      document,
      { seed: `${seed}:${name}` },
    );
    out[name.toLowerCase()] =
      value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
}

/** Check the request against the operation's security requirements. */
function authFailure(
  entry: OperationEntry,
  document: OpenApiDocument,
  request: MockRequest,
  resolver: RefResolver,
): MockResult | null {
  const requirements = effectiveSecurity(document, entry.operation);
  if (requirements.length === 0) return null;

  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  const satisfiesScheme = (name: string): boolean => {
    const raw = document.components?.securitySchemes?.[name];
    const scheme = isReference(raw) ? resolver.tryResolve<SecurityScheme>(raw) : raw;
    if (!scheme) return false;
    switch (scheme.type) {
      case "http":
        return (headers.authorization ?? "")
          .toLowerCase()
          .startsWith(`${scheme.scheme ?? "bearer"} `.toLowerCase());
      case "apiKey": {
        const key = (scheme.name ?? "").toLowerCase();
        if (scheme.in === "header") return Boolean(headers[key]);
        if (scheme.in === "query") return Boolean(request.query[scheme.name ?? ""]);
        return Boolean(headers.cookie?.includes(`${scheme.name}=`));
      }
      case "oauth2":
      case "openIdConnect":
        return (headers.authorization ?? "").toLowerCase().startsWith("bearer ");
      case "mutualTLS":
        return true; // cannot be simulated over the mock transport
      default:
        return false;
    }
  };

  // A requirement object is an AND of schemes; the array is an OR of objects.
  const satisfied = requirements.some((requirement) =>
    Object.keys(requirement).every((name) => satisfiesScheme(name)),
  );
  if (satisfied) return null;

  const schemeNames = [...new Set(requirements.flatMap((requirement) => Object.keys(requirement)))];
  return {
    ...problem(
      401,
      "Unauthorized",
      `This operation requires: ${schemeNames.join(" or ")}.`,
      "The request did not satisfy the documented security requirements.",
      { requiredSchemes: schemeNames },
      { "www-authenticate": 'Bearer realm="openapi-studio-mock"' },
    ),
    matched: true,
    operationId: entry.operationId,
    path: entry.path,
  };
}

function validationFailure(
  entry: OperationEntry,
  request: MockRequest,
  resolver: RefResolver,
): MockResult | null {
  const missing: string[] = [];
  for (const parameter of entry.parameters) {
    if (parameter.required !== true || !parameter.name) continue;
    if (parameter.in === "query" && request.query[parameter.name] === undefined) {
      missing.push(`query.${parameter.name}`);
    }
    if (parameter.in === "header") {
      const present = Object.keys(request.headers).some(
        (key) => key.toLowerCase() === parameter.name?.toLowerCase(),
      );
      if (!present) missing.push(`header.${parameter.name}`);
    }
  }

  const body = entry.operation.requestBody
    ? resolver.tryResolve<{ required?: boolean }>(entry.operation.requestBody)
    : null;
  if (body?.required === true && !request.body) missing.push("body");

  if (missing.length === 0) return null;
  return {
    ...problem(
      400,
      "Bad Request",
      `Missing required input: ${missing.join(", ")}.`,
      "The mock server validated the request against the specification and rejected it.",
      { missing },
    ),
    matched: true,
    operationId: entry.operationId,
    path: entry.path,
  };
}

/**
 * Produce a mock response for a request against a specification.
 *
 * The mock is a pure function of (document, request, options) — no I/O, no
 * global state — which makes it trivially testable and lets the same code power
 * both the HTTP mock route and the in-browser preview.
 */
export function mockResponse(
  document: OpenApiDocument,
  request: MockRequest,
  options: MockOptions = {},
): MockResult {
  const resolver = new RefResolver(document);
  const match = matchOperation(document, request.method, request.path);

  if (!match) {
    return problem(
      404,
      "Not Found",
      `No operation in this specification matches ${request.method.toUpperCase()} ${request.path}.`,
      "The path did not match any documented path template.",
    );
  }

  const { entry } = match;
  const seed = options.seed ?? `${entry.method}:${entry.path}`;
  const random = createRandom(hashSeed(`${seed}:${request.path}`));

  if (options.enforceAuth !== false) {
    const failure = authFailure(entry, document, request, resolver);
    if (failure) return { ...failure, delayMs: options.delayMs ?? 0 };
  }
  if (options.validateRequest !== false) {
    const failure = validationFailure(entry, request, resolver);
    if (failure) return { ...failure, delayMs: options.delayMs ?? 0 };
  }

  const { code, reason } = pickStatus(entry, options, random);
  const rawResponse = entry.operation.responses?.[code];
  const response = resolver.tryResolve<OpenApiResponse>(rawResponse);

  const status = code === "default" ? 200 : Number.parseInt(code.replace("XX", "00"), 10) || 200;
  const content = response?.content ?? {};
  const mediaTypeName =
    Object.keys(content).find((name) => name.includes("json")) ?? Object.keys(content)[0] ?? null;
  const media: MediaType | undefined = mediaTypeName ? content[mediaTypeName] : undefined;

  let body = "";
  let contentType = "application/json; charset=utf-8";

  if (media) {
    contentType = mediaTypeName?.includes("json")
      ? "application/json; charset=utf-8"
      : (mediaTypeName ?? "text/plain");

    const declaredExample =
      media.example !== undefined
        ? media.example
        : Object.values(media.examples ?? {})
            .map((example) => resolver.tryResolve<{ value?: unknown }>(example)?.value)
            .find((value) => value !== undefined);

    const payload =
      options.preferDeclaredExamples !== false && declaredExample !== undefined
        ? (declaredExample as Json)
        : exampleFromSchema(
            media.schema ? (resolver.tryResolve<Schema>(media.schema) ?? undefined) : undefined,
            document,
            { seed: `${seed}:${code}`, preferDeclared: options.preferDeclaredExamples !== false },
          );

    body =
      typeof payload === "string" && !mediaTypeName?.includes("json")
        ? payload
        : JSON.stringify(payload, null, 2);
  } else if (status !== 204) {
    body = JSON.stringify(
      { message: response?.description ?? "No content documented for this response." },
      null,
      2,
    );
  }

  const headers: Record<string, string> = {
    ...(body ? { "content-type": contentType } : {}),
    ...headerExamples(response?.headers, document, resolver, seed),
    "x-mock-server": "openapi-studio-ai",
    "x-mock-operation": entry.operationId,
    "x-mock-status-source": code,
  };

  return {
    status,
    headers,
    body,
    delayMs: Math.max(0, options.delayMs ?? 0),
    matched: true,
    operationId: entry.operationId,
    path: entry.path,
    explanation: reason,
  };
}
