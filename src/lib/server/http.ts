import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { NotFoundError } from "@/lib/repository/types";
import { ForbiddenError, UnauthorizedError, currentIdentity, type Identity } from "./auth";
import { EnvironmentError, env } from "./env";
import { logger } from "./logger";
import { clientKey, consume } from "./rate-limit";

/** Application-level error carrying an HTTP status and a machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, "bad_request", message, details);
  }
  static payloadTooLarge(message: string): ApiError {
    return new ApiError(413, "payload_too_large", message);
  }
  static notFound(message: string): ApiError {
    return new ApiError(404, "not_found", message);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, "conflict", message);
  }
  static upstream(message: string, details?: unknown): ApiError {
    return new ApiError(502, "upstream_error", message, details);
  }
}

export interface ProblemBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
  readonly requestId: string;
}

function requestId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

export function jsonResponse<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function problemResponse(
  status: number,
  code: string,
  message: string,
  id: string,
  details?: unknown,
  headers?: Record<string, string>,
): NextResponse {
  const body: ProblemBody = {
    error: { code, message, ...(details ? { details } : {}) },
    requestId: id,
  };
  return NextResponse.json(body, { status, headers });
}

export interface RouteContext<P = Record<string, string>> {
  readonly request: Request;
  readonly identity: Identity;
  readonly params: P;
  readonly requestId: string;
  readonly log: ReturnType<typeof logger.child>;
}

export interface RouteOptions {
  /** Rate-limit bucket name. Omit to skip rate limiting. */
  readonly scope?: string;
  readonly limit?: number;
  /** Set to false for public endpoints such as health checks. */
  readonly authenticated?: boolean;
}

type Handler<P> = (ctx: RouteContext<P>) => Promise<Response> | Response;

/**
 * Wrap a route handler with identity resolution, rate limiting, structured
 * logging and uniform error mapping. Every API route in the app goes through
 * this single seam so behaviour cannot drift between endpoints.
 */
export function route<
  P extends Record<string, string | string[] | undefined> = Record<string, string>,
>(handler: Handler<P>, options: RouteOptions = {}) {
  return async (request: Request, segment?: { params: Promise<P> }): Promise<Response> => {
    const id = requestId();
    const started = performance.now();
    const log = logger.child({ requestId: id, path: new URL(request.url).pathname });

    try {
      const params = ((await segment?.params) ?? {}) as P;
      const identity =
        options.authenticated === false
          ? {
              userId: "anonymous",
              email: null,
              displayName: "Anonymous",
              provider: "local" as const,
            }
          : await currentIdentity();

      if (options.scope) {
        const result = consume(clientKey(request.headers, options.scope, identity.userId), {
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        });
        if (!result.allowed) {
          log.warn("http.rate_limited", { scope: options.scope, userId: identity.userId });
          return problemResponse(
            429,
            "rate_limited",
            "Too many requests. Please retry shortly.",
            id,
            undefined,
            {
              "Retry-After": String(result.retryAfterSeconds),
              "X-RateLimit-Limit": String(result.limit),
              "X-RateLimit-Remaining": String(result.remaining),
              "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
            },
          );
        }
      }

      const response = await handler({ request, identity, params, requestId: id, log });
      response.headers.set("x-request-id", id);
      log.debug("http.ok", {
        status: response.status,
        durationMs: Math.round(performance.now() - started),
      });
      return response;
    } catch (error) {
      return mapError(error, id, log, Math.round(performance.now() - started));
    }
  };
}

function mapError(
  error: unknown,
  id: string,
  log: ReturnType<typeof logger.child>,
  durationMs: number,
): NextResponse {
  if (error instanceof ApiError) {
    log.warn("http.error", { code: error.code, status: error.status, durationMs });
    return problemResponse(error.status, error.code, error.message, id, error.details);
  }
  if (error instanceof z.ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    log.warn("http.validation_error", { durationMs, issues: details.length });
    return problemResponse(
      400,
      "validation_failed",
      "The request payload is invalid.",
      id,
      details,
    );
  }
  if (error instanceof UnauthorizedError) {
    return problemResponse(401, "unauthorized", error.message, id);
  }
  if (error instanceof ForbiddenError) {
    return problemResponse(403, "forbidden", error.message, id);
  }
  if (error instanceof NotFoundError) {
    return problemResponse(404, "not_found", error.message, id);
  }
  if (error instanceof EnvironmentError) {
    log.error("http.environment_error", { issues: error.issues });
    return problemResponse(500, "misconfigured", "The server is misconfigured.", id);
  }

  const message = error instanceof Error ? error.message : String(error);
  log.error("http.unhandled", { error: message, durationMs });
  return problemResponse(
    500,
    "internal_error",
    env().NODE_ENV === "production" ? "An unexpected error occurred." : message,
    id,
  );
}

/** Parse and validate a JSON body, enforcing the configured size ceiling. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const raw = await request.text();
  if (raw.length > env().MAX_SPEC_BYTES) {
    throw ApiError.payloadTooLarge(`Request body exceeds the ${env().MAX_SPEC_BYTES} byte limit.`);
  }
  let parsed: unknown;
  try {
    parsed = raw.length ? JSON.parse(raw) : {};
  } catch {
    throw ApiError.badRequest("Request body must be valid JSON.");
  }
  return schema.parse(parsed);
}
