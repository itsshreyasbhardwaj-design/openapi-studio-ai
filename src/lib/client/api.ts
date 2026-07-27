import type {
  ApiProject,
  Assertion,
  Comment,
  RequestCollection,
  RequestDefinition,
  ReviewRequest,
  SpecVersion,
  TestRun,
} from "@/lib/domain/types";
import type { Diagnostic, DiagnosticSummary } from "@/lib/core/openapi/diagnostics";
import type { DocumentStats } from "@/lib/core/openapi/navigate";
import type { OpenApiDocument } from "@/lib/core/openapi/types";
import type { DiffResult } from "@/lib/core/openapi/diff";
import type { SecurityFinding } from "@/lib/core/security/rules";
import type { MetricsOverview } from "@/lib/core/telemetry/metrics";
import type { GeneratedFile, SdkLanguage } from "@/lib/core/sdk/model";

/** Error thrown for any non-2xx response from the platform's own API. */
export class StudioApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "StudioApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    (T & { error?: { code: string; message: string; details?: unknown } }) | null;

  if (!response.ok) {
    const error = payload?.error;
    throw new StudioApiError(
      response.status,
      error?.code ?? "unknown",
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.details,
    );
  }
  return payload as T;
}

export interface AnalysisResponse {
  valid: boolean;
  format: "yaml" | "json";
  score: number;
  band: "excellent" | "good" | "fair" | "poor";
  summary: DiagnosticSummary;
  stats: DocumentStats;
  documentationCoverage: number;
  diagnostics: Diagnostic[];
  fixable: number;
  security: {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    summary: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
      total: number;
    };
    findings: SecurityFinding[];
    recommendations: string[];
    byCategory: { category: string; findings: SecurityFinding[] }[];
  };
  document: OpenApiDocument;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  sizeBytes: number;
  truncated: boolean;
  assertions: {
    assertionId: string;
    kind: string;
    passed: boolean;
    message: string;
    actual: string;
    expected: string;
  }[];
  error: string | null;
}

export const studioApi = {
  analyze: (source: string) =>
    call<AnalysisResponse>("/api/analyze", { method: "POST", body: JSON.stringify({ source }) }),

  listSpecs: () =>
    call<{ specs: { project: ApiProject; version: SpecVersion | null }[] }>("/api/specs"),

  createSpec: (input: { name: string; source: string; description?: string; kind?: string }) =>
    call<{ project: ApiProject; version: SpecVersion }>("/api/specs", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteSpec: (id: string) => call<void>(`/api/specs/${id}`, { method: "DELETE" }),

  updateSpec: (
    id: string,
    patch: Partial<Pick<ApiProject, "name" | "description" | "tags" | "status">>,
  ) =>
    call<{ project: ApiProject }>(`/api/specs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listVersions: (id: string) =>
    call<{ versions: (SpecVersion & { sizeBytes: number })[] }>(`/api/specs/${id}/versions`),

  getVersion: (id: string, versionId: string) =>
    call<{ version: SpecVersion }>(`/api/specs/${id}/versions/${versionId}`),

  saveVersion: (id: string, input: { source: string; message?: string; publish?: boolean }) =>
    call<{ version: SpecVersion; diff: DiffResult | null }>(`/api/specs/${id}/versions`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  versionAction: (id: string, versionId: string, action: "rollback" | "publish") =>
    call<{ version: SpecVersion }>(`/api/specs/${id}/versions/${versionId}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  diff: (input: {
    before?: string;
    after?: string;
    specId?: string;
    beforeVersionId?: string;
    afterVersionId?: string;
  }) =>
    call<DiffResult & { suggestedVersion: string }>("/api/diff", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  generateSdk: (input: {
    language: SdkLanguage;
    source?: string;
    specId?: string;
    packageName?: string;
  }) =>
    call<{
      language: SdkLanguage;
      entryPoint: string;
      installCommand: string;
      sizeBytes: number;
      files: GeneratedFile[];
    }>("/api/sdk", { method: "POST", body: JSON.stringify(input) }),

  improve: (input: { source: string; mode: "auto" | "ai"; rules?: string[] }) =>
    call<{
      source: string;
      engine: "offline" | "openrouter";
      applied: string[];
      skipped: string[];
      scoreBefore: number;
      scoreAfter: number;
    }>("/api/ai/improve", { method: "POST", body: JSON.stringify(input) }),

  proxy: (input: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
    assertions?: Assertion[];
    specId?: string;
    timeoutMs?: number;
  }) => call<ProxyResponse>("/api/proxy", { method: "POST", body: JSON.stringify(input) }),

  listComments: (id: string) => call<{ comments: Comment[] }>(`/api/specs/${id}/comments`),

  addComment: (id: string, input: { pointer: string; body: string; versionId?: string | null }) =>
    call<{ comment: Comment }>(`/api/specs/${id}/comments`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateComment: (id: string, commentId: string, patch: { resolved?: boolean; body?: string }) =>
    call<{ comment: Comment }>(`/api/specs/${id}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listReviews: (id: string) => call<{ reviews: ReviewRequest[] }>(`/api/specs/${id}/reviews`),

  createReview: (
    id: string,
    input: {
      title: string;
      description?: string;
      versionId: string;
      baseVersionId?: string | null;
      reviewers?: string[];
    },
  ) =>
    call<{ review: ReviewRequest }>(`/api/specs/${id}/reviews`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  reviewDecision: (
    id: string,
    reviewId: string,
    input: {
      decision?: "approved" | "changes_requested" | "commented";
      note?: string;
      status?: string;
    },
  ) =>
    call<{ review: ReviewRequest }>(`/api/specs/${id}/reviews/${reviewId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  listCollections: () => call<{ collections: RequestCollection[] }>("/api/collections"),

  saveCollection: (input: {
    id?: string;
    name: string;
    description?: string;
    specId?: string | null;
    requests: RequestDefinition[];
  }) =>
    call<{ collection: RequestCollection }>("/api/collections", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  importCollection: (input: { specId: string; name?: string; baseUrl?: string }) =>
    call<{ collection: RequestCollection }>("/api/collections?mode=import", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteCollection: (id: string) => call<void>(`/api/collections/${id}`, { method: "DELETE" }),

  runCollection: (input: {
    collectionId: string;
    environmentId?: string | null;
    stopOnFailure?: boolean;
    specId?: string;
  }) =>
    call<{
      run: TestRun;
      stats: { assertionsPassed: number; assertionsFailed: number; averageDurationMs: number };
    }>("/api/test/run", { method: "POST", body: JSON.stringify(input) }),

  metrics: (params: { specId?: string; window?: string }) => {
    const search = new URLSearchParams();
    if (params.specId) search.set("specId", params.specId);
    if (params.window) search.set("window", params.window);
    return call<{ window: string; since: string; overview: MetricsOverview }>(
      `/api/metrics?${search}`,
    );
  },
};

/** Consume the NDJSON stream produced by `/api/ai/generate`. */
export async function streamGeneration(
  input: { request: string; title?: string; baseUrl?: string; style?: string },
  handlers: {
    onStatus?: (message: string) => void;
    onDelta?: (text: string) => void;
    onDone?: (result: {
      source: string;
      engine: string;
      notes: string[];
      repaired: boolean;
    }) => void;
    onError?: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message: string };
    } | null;
    handlers.onError?.(payload?.error?.message ?? "The generator is unavailable.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as
          | { type: "status"; message: string }
          | { type: "delta"; text: string }
          | {
              type: "done";
              result: { source: string; engine: string; notes: string[]; repaired: boolean };
            }
          | { type: "error"; message: string };

        if (event.type === "status") handlers.onStatus?.(event.message);
        else if (event.type === "delta") handlers.onDelta?.(event.text);
        else if (event.type === "done") handlers.onDone?.(event.result);
        else handlers.onError?.(event.message);
      } catch {
        // Skip malformed frames rather than aborting the stream.
      }
    }
  }
}
