import type { MetricSample } from "@/lib/domain/types";

export interface LatencyPercentiles {
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export interface TimeBucket {
  readonly at: string;
  readonly requests: number;
  readonly errors: number;
  readonly p95: number;
  readonly averageMs: number;
}

export interface EndpointStat {
  readonly key: string;
  readonly method: string;
  readonly path: string;
  readonly requests: number;
  readonly errors: number;
  readonly errorRate: number;
  readonly averageMs: number;
  readonly p95: number;
}

export interface MetricsOverview {
  readonly requests: number;
  readonly errors: number;
  readonly errorRate: number;
  /** Share of non-5xx responses, expressed as a percentage. */
  readonly availability: number;
  readonly averageMs: number;
  readonly latency: LatencyPercentiles;
  readonly buckets: readonly TimeBucket[];
  readonly endpoints: readonly EndpointStat[];
  readonly statusDistribution: readonly { status: string; count: number }[];
  readonly busiestHour: string | null;
}

/** Nearest-rank percentile over an unsorted array of durations. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

export function latencyPercentiles(values: readonly number[]): LatencyPercentiles {
  return {
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

function bucketKey(timestamp: string, bucketMs: number): string {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return timestamp;
  return new Date(Math.floor(time / bucketMs) * bucketMs).toISOString();
}

export interface OverviewOptions {
  /** Bucket width for the time series. Default: 1 hour. */
  readonly bucketMs?: number;
  readonly topEndpoints?: number;
}

/**
 * Aggregate raw samples into everything the monitoring dashboard renders.
 *
 * Kept pure so the same function serves the API route, server components and
 * the unit tests — and so that swapping the sample source (mock traffic, the
 * built-in client, or a production collector) changes nothing downstream.
 */
export function buildOverview(
  samples: readonly MetricSample[],
  options: OverviewOptions = {},
): MetricsOverview {
  const bucketMs = options.bucketMs ?? 3_600_000;
  const durations = samples.map((sample) => sample.durationMs);
  const errors = samples.filter((sample) => sample.status >= 400).length;
  const serverErrors = samples.filter((sample) => sample.status >= 500).length;

  const buckets = new Map<string, { requests: number; errors: number; durations: number[] }>();
  const endpoints = new Map<
    string,
    { method: string; path: string; requests: number; errors: number; durations: number[] }
  >();
  const statuses = new Map<string, number>();

  for (const sample of samples) {
    const key = bucketKey(sample.timestamp, bucketMs);
    const bucket = buckets.get(key) ?? { requests: 0, errors: 0, durations: [] };
    bucket.requests += 1;
    if (sample.status >= 400) bucket.errors += 1;
    bucket.durations.push(sample.durationMs);
    buckets.set(key, bucket);

    const endpointKey = `${sample.method.toUpperCase()} ${sample.path}`;
    const endpoint = endpoints.get(endpointKey) ?? {
      method: sample.method.toUpperCase(),
      path: sample.path,
      requests: 0,
      errors: 0,
      durations: [],
    };
    endpoint.requests += 1;
    if (sample.status >= 400) endpoint.errors += 1;
    endpoint.durations.push(sample.durationMs);
    endpoints.set(endpointKey, endpoint);

    const statusClass = `${Math.floor(sample.status / 100) || 0}xx`;
    statuses.set(statusClass, (statuses.get(statusClass) ?? 0) + 1);
  }

  const orderedBuckets: TimeBucket[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([at, bucket]) => ({
      at,
      requests: bucket.requests,
      errors: bucket.errors,
      p95: percentile(bucket.durations, 0.95),
      averageMs:
        bucket.durations.length === 0
          ? 0
          : Math.round(
              bucket.durations.reduce((sum, value) => sum + value, 0) / bucket.durations.length,
            ),
    }));

  const endpointStats: EndpointStat[] = [...endpoints.entries()]
    .map(([key, endpoint]) => ({
      key,
      method: endpoint.method,
      path: endpoint.path,
      requests: endpoint.requests,
      errors: endpoint.errors,
      errorRate:
        endpoint.requests === 0 ? 0 : Math.round((endpoint.errors / endpoint.requests) * 1000) / 10,
      averageMs: Math.round(
        endpoint.durations.reduce((sum, value) => sum + value, 0) /
          Math.max(1, endpoint.durations.length),
      ),
      p95: percentile(endpoint.durations, 0.95),
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, options.topEndpoints ?? 12);

  const busiest = orderedBuckets.reduce<TimeBucket | null>(
    (best, bucket) => (!best || bucket.requests > best.requests ? bucket : best),
    null,
  );

  return {
    requests: samples.length,
    errors,
    errorRate: samples.length === 0 ? 0 : Math.round((errors / samples.length) * 1000) / 10,
    availability:
      samples.length === 0
        ? 100
        : Math.round(((samples.length - serverErrors) / samples.length) * 1000) / 10,
    averageMs:
      durations.length === 0
        ? 0
        : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    latency: latencyPercentiles(durations),
    buckets: orderedBuckets,
    endpoints: endpointStats,
    statusDistribution: [...statuses.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    busiestHour: busiest?.at ?? null,
  };
}
