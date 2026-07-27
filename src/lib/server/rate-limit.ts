import "server-only";
import { env } from "./env";

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch milliseconds at which the current window resets. */
  readonly resetAt: number;
  readonly retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process fixed-window rate limiter.
 *
 * Deliberately dependency-free so the platform stays free to self-host. For
 * multi-instance deployments swap `store` for a Redis/Upstash backed
 * implementation — the `consume` signature is the seam.
 */
const store = new Map<string, Bucket>();

/** Evict expired buckets so the map cannot grow without bound. */
function sweep(now: number): void {
  if (store.size < 5_000) return;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitOptions {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly now?: number;
}

export function consume(identifier: string, options: RateLimitOptions = {}): RateLimitResult {
  const config = env();
  const limit = options.limit ?? config.RATE_LIMIT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? config.RATE_LIMIT_WINDOW_MS;
  const now = options.now ?? Date.now();

  sweep(now);

  const existing = store.get(identifier);
  const bucket: Bucket =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  store.set(identifier, bucket);

  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Test helper — clears all buckets. */
export function resetRateLimits(): void {
  store.clear();
}

/** Derive a stable client key from request headers. */
export function clientKey(headers: Headers, scope: string, userId?: string): string {
  if (userId) return `${scope}:user:${userId}`;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip") || "anonymous";
  return `${scope}:ip:${ip}`;
}
