/**
 * Domain model shared by the server and the browser.
 *
 * These types are intentionally free of any runtime dependency so they can be
 * imported from React Server Components, client components, API routes and the
 * pure core engines alike.
 */

export type SpecFormat = "yaml" | "json";
export type ApiKind = "rest" | "graphql" | "webhook";
export type LifecycleStatus = "draft" | "published" | "deprecated";

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly ownerId: string;
  readonly memberIds: readonly string[];
  readonly createdAt: string;
}

export interface ApiProject {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly kind: ApiKind;
  readonly status: LifecycleStatus;
  readonly tags: readonly string[];
  readonly currentVersionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SpecVersion {
  readonly id: string;
  readonly specId: string;
  /** Human-facing label, e.g. `1.4.0`. */
  readonly label: string;
  readonly document: string;
  readonly format: SpecFormat;
  readonly hash: string;
  readonly message: string;
  readonly status: Exclude<LifecycleStatus, "deprecated"> | "deprecated";
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface Comment {
  readonly id: string;
  readonly specId: string;
  readonly versionId: string | null;
  /** JSON Pointer into the specification, e.g. `/paths/~1orders/get`. */
  readonly pointer: string;
  readonly body: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly resolved: boolean;
  readonly createdAt: string;
}

export type ReviewStatus = "open" | "approved" | "changes_requested" | "merged" | "closed";

export interface ReviewDecision {
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly decision: "approved" | "changes_requested" | "commented";
  readonly note: string;
  readonly createdAt: string;
}

export interface ReviewRequest {
  readonly id: string;
  readonly specId: string;
  readonly versionId: string;
  readonly baseVersionId: string | null;
  readonly title: string;
  readonly description: string;
  readonly status: ReviewStatus;
  readonly requestedBy: string;
  readonly requestedByName: string;
  readonly reviewers: readonly string[];
  readonly decisions: readonly ReviewDecision[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnvironmentVariable {
  readonly key: string;
  /** Encrypted at rest when `secret` is true and ENCRYPTION_KEY is configured. */
  readonly value: string;
  readonly secret: boolean;
}

export interface ApiEnvironment {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly variables: readonly EnvironmentVariable[];
  readonly createdAt: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type AuthConfig =
  | { readonly type: "none" }
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  | {
      readonly type: "apiKey";
      readonly name: string;
      readonly in: "header" | "query";
      readonly value: string;
    };

export type AssertionKind =
  "status" | "statusRange" | "header" | "jsonPath" | "bodyContains" | "responseTime" | "schema";

export interface Assertion {
  readonly id: string;
  readonly kind: AssertionKind;
  /** Target selector: header name, JSON path expression, or empty for status. */
  readonly target: string;
  readonly operator:
    "equals" | "notEquals" | "contains" | "matches" | "lessThan" | "greaterThan" | "exists";
  readonly expected: string;
}

/** Extract a value from a response into a variable for later requests. */
export interface VariableCapture {
  readonly name: string;
  /** JSON path (`data.token`) or `header:<name>`. */
  readonly from: string;
}

export interface RequestDefinition {
  readonly id: string;
  readonly name: string;
  readonly protocol: "rest" | "graphql";
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: string | null;
  /** GraphQL variables document, used when `protocol` is `graphql`. */
  readonly variables: string | null;
  readonly auth: AuthConfig;
  readonly assertions: readonly Assertion[];
  /** Values promoted into the run's variable bag after a successful response. */
  readonly captures?: readonly VariableCapture[];
}

export interface RequestCollection {
  readonly id: string;
  readonly workspaceId: string;
  readonly specId: string | null;
  readonly name: string;
  readonly description: string;
  readonly requests: readonly RequestDefinition[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssertionResult {
  readonly assertionId: string;
  readonly kind: AssertionKind;
  readonly passed: boolean;
  readonly message: string;
  readonly actual: string;
  readonly expected: string;
}

export interface ExecutedRequest {
  readonly requestId: string;
  readonly name: string;
  readonly status: number;
  readonly statusText: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly error: string | null;
  readonly assertions: readonly AssertionResult[];
}

export interface TestRun {
  readonly id: string;
  readonly collectionId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly ExecutedRequest[];
}

export interface MetricSample {
  readonly id: string;
  readonly specId: string;
  readonly timestamp: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly source: "mock" | "client" | "monitor";
}

export interface HistoryEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly at: string;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly durationMs: number;
}
