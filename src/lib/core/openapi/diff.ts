import { RefResolver } from "./deref";
import { listOperations } from "./navigate";
import { extend, pointer } from "./pointer";
import {
  isReference,
  type MediaType,
  type OpenApiDocument,
  type Parameter,
  type Schema,
} from "./types";

export type ChangeKind = "added" | "removed" | "modified";

export type ChangeCategory =
  | "info"
  | "server"
  | "operation"
  | "parameter"
  | "request-body"
  | "response"
  | "schema"
  | "security";

export interface Change {
  readonly kind: ChangeKind;
  readonly category: ChangeCategory;
  readonly pointer: string;
  /** Human-readable, review-ready sentence. */
  readonly description: string;
  /** True when the change can break an existing consumer. */
  readonly breaking: boolean;
  readonly before?: string;
  readonly after?: string;
}

export type VersionImpact = "major" | "minor" | "patch" | "none";

export interface DiffResult {
  readonly changes: readonly Change[];
  readonly breakingCount: number;
  readonly additiveCount: number;
  readonly totalCount: number;
  /** Semantic-versioning recommendation derived from the change set. */
  readonly impact: VersionImpact;
  readonly summary: string;
}

const MAX_SCHEMA_DEPTH = 6;

/**
 * Semantic diff between two OpenAPI documents.
 *
 * Unlike a textual diff this understands *meaning*: removing an endpoint,
 * tightening a schema, or making a parameter required are breaking, whereas
 * adding an optional field is additive. The result drives the version impact
 * badge, the review UI, and CI gating.
 */
export function diffDocuments(before: OpenApiDocument, after: OpenApiDocument): DiffResult {
  const changes: Change[] = [];
  diffInfo(before, after, changes);
  diffServers(before, after, changes);
  diffSecurity(before, after, changes);
  diffOperations(before, after, changes);
  diffComponentSchemas(before, after, changes);

  const breakingCount = changes.filter((change) => change.breaking).length;
  const additiveCount = changes.filter(
    (change) => change.kind === "added" && !change.breaking,
  ).length;
  const impact: VersionImpact =
    changes.length === 0
      ? "none"
      : breakingCount > 0
        ? "major"
        : additiveCount > 0
          ? "minor"
          : "patch";

  return {
    changes,
    breakingCount,
    additiveCount,
    totalCount: changes.length,
    impact,
    summary: describe(changes.length, breakingCount, additiveCount, impact),
  };
}

function describe(
  total: number,
  breaking: number,
  additive: number,
  impact: VersionImpact,
): string {
  if (total === 0) return "No semantic differences between these versions.";
  const parts = [`${total} change${total === 1 ? "" : "s"}`];
  if (breaking > 0) parts.push(`${breaking} breaking`);
  if (additive > 0) parts.push(`${additive} additive`);
  return `${parts.join(", ")} — recommended release: ${impact}.`;
}

function diffInfo(before: OpenApiDocument, after: OpenApiDocument, out: Change[]): void {
  const fields: (keyof NonNullable<OpenApiDocument["info"]>)[] = [
    "title",
    "version",
    "description",
  ];
  for (const field of fields) {
    const previous = before.info?.[field];
    const next = after.info?.[field];
    if (typeof previous === "object" || typeof next === "object") continue;
    if (previous !== next) {
      out.push({
        kind: previous === undefined ? "added" : next === undefined ? "removed" : "modified",
        category: "info",
        pointer: pointer("info", field),
        description: `info.${field} changed from "${previous ?? "—"}" to "${next ?? "—"}".`,
        breaking: false,
        before: previous === undefined ? undefined : String(previous),
        after: next === undefined ? undefined : String(next),
      });
    }
  }
  if (before.openapi !== after.openapi) {
    out.push({
      kind: "modified",
      category: "info",
      pointer: pointer("openapi"),
      description: `OpenAPI version changed from ${before.openapi ?? "—"} to ${after.openapi ?? "—"}.`,
      breaking: false,
    });
  }
}

function diffServers(before: OpenApiDocument, after: OpenApiDocument, out: Change[]): void {
  const previous = new Set((before.servers ?? []).map((server) => server.url ?? ""));
  const next = new Set((after.servers ?? []).map((server) => server.url ?? ""));

  for (const url of previous) {
    if (!next.has(url)) {
      out.push({
        kind: "removed",
        category: "server",
        pointer: pointer("servers"),
        description: `Server "${url}" was removed.`,
        breaking: true,
        before: url,
      });
    }
  }
  for (const url of next) {
    if (!previous.has(url)) {
      out.push({
        kind: "added",
        category: "server",
        pointer: pointer("servers"),
        description: `Server "${url}" was added.`,
        breaking: false,
        after: url,
      });
    }
  }
}

function securityKey(requirements: OpenApiDocument["security"]): string {
  return JSON.stringify(
    (requirements ?? []).map((requirement) =>
      Object.entries(requirement)
        .map(([name, scopes]) => `${name}:${[...scopes].sort().join(",")}`)
        .sort(),
    ),
  );
}

function diffSecurity(before: OpenApiDocument, after: OpenApiDocument, out: Change[]): void {
  const previous = securityKey(before.security);
  const next = securityKey(after.security);
  if (previous === next) return;

  const hadNone = (before.security ?? []).length === 0;
  const hasNone = (after.security ?? []).length === 0;
  out.push({
    kind: hadNone ? "added" : hasNone ? "removed" : "modified",
    category: "security",
    pointer: pointer("security"),
    description: hadNone
      ? "Global security requirements were introduced — unauthenticated clients will now be rejected."
      : hasNone
        ? "Global security requirements were removed."
        : "Global security requirements changed.",
    // Introducing or tightening auth breaks existing clients; relaxing it does not.
    breaking: hadNone || (!hadNone && !hasNone),
  });
}

function diffOperations(before: OpenApiDocument, after: OpenApiDocument, out: Change[]): void {
  const beforeOps = new Map(
    listOperations(before).map((entry) => [`${entry.method} ${entry.path}`, entry]),
  );
  const afterOps = new Map(
    listOperations(after).map((entry) => [`${entry.method} ${entry.path}`, entry]),
  );
  const beforeResolver = new RefResolver(before);
  const afterResolver = new RefResolver(after);

  for (const [key, entry] of beforeOps) {
    if (afterOps.has(key)) continue;
    out.push({
      kind: "removed",
      category: "operation",
      pointer: entry.pointer,
      description: `Endpoint ${entry.method.toUpperCase()} ${entry.path} was removed.`,
      breaking: true,
      before: key,
    });
  }

  for (const [key, entry] of afterOps) {
    if (beforeOps.has(key)) continue;
    out.push({
      kind: "added",
      category: "operation",
      pointer: entry.pointer,
      description: `Endpoint ${entry.method.toUpperCase()} ${entry.path} was added.`,
      breaking: false,
      after: key,
    });
  }

  for (const [key, next] of afterOps) {
    const previous = beforeOps.get(key);
    if (!previous) continue;
    const label = `${next.method.toUpperCase()} ${next.path}`;

    if (previous.operation.operationId !== next.operation.operationId) {
      out.push({
        kind: "modified",
        category: "operation",
        pointer: extend(next.pointer, "operationId"),
        description: `${label}: operationId changed from "${previous.operation.operationId ?? "—"}" to "${next.operation.operationId ?? "—"}" — generated SDK method names will change.`,
        breaking: true,
        before: previous.operation.operationId,
        after: next.operation.operationId,
      });
    }
    if (!previous.deprecated && next.deprecated) {
      out.push({
        kind: "modified",
        category: "operation",
        pointer: extend(next.pointer, "deprecated"),
        description: `${label} was marked deprecated.`,
        breaking: false,
      });
    }

    diffParameters(previous.parameters, next.parameters, next.pointer, label, out);
    diffRequestBody(previous, next, beforeResolver, afterResolver, label, out);
    diffResponses(previous, next, beforeResolver, afterResolver, label, out);
    diffOperationSecurity(previous, next, label, out);
  }
}

function diffParameters(
  before: readonly Parameter[],
  after: readonly Parameter[],
  at: string,
  label: string,
  out: Change[],
): void {
  const key = (parameter: Parameter): string => `${parameter.in ?? "?"}:${parameter.name ?? "?"}`;
  const beforeMap = new Map(before.map((parameter) => [key(parameter), parameter]));
  const afterMap = new Map(after.map((parameter) => [key(parameter), parameter]));

  for (const [id, parameter] of beforeMap) {
    if (afterMap.has(id)) continue;
    out.push({
      kind: "removed",
      category: "parameter",
      pointer: extend(at, "parameters"),
      description: `${label}: parameter "${parameter.name}" (${parameter.in}) was removed.`,
      breaking: parameter.required === true,
      before: id,
    });
  }

  for (const [id, parameter] of afterMap) {
    const previous = beforeMap.get(id);
    if (!previous) {
      out.push({
        kind: "added",
        category: "parameter",
        pointer: extend(at, "parameters"),
        description: `${label}: parameter "${parameter.name}" (${parameter.in}) was added${
          parameter.required ? " and is required" : ""
        }.`,
        breaking: parameter.required === true,
        after: id,
      });
      continue;
    }
    if (previous.required !== true && parameter.required === true) {
      out.push({
        kind: "modified",
        category: "parameter",
        pointer: extend(at, "parameters"),
        description: `${label}: parameter "${parameter.name}" became required.`,
        breaking: true,
      });
    } else if (previous.required === true && parameter.required !== true) {
      out.push({
        kind: "modified",
        category: "parameter",
        pointer: extend(at, "parameters"),
        description: `${label}: parameter "${parameter.name}" is no longer required.`,
        breaking: false,
      });
    }
  }
}

function contentSchema(
  content: Record<string, MediaType> | undefined,
  resolver: RefResolver,
): Schema | null {
  const media = content?.["application/json"] ?? Object.values(content ?? {})[0];
  if (!media?.schema) return null;
  return resolver.tryResolve<Schema>(media.schema);
}

function diffRequestBody(
  before: { operation: { requestBody?: unknown }; pointer: string },
  after: { operation: { requestBody?: unknown }; pointer: string },
  beforeResolver: RefResolver,
  afterResolver: RefResolver,
  label: string,
  out: Change[],
): void {
  const previous = before.operation.requestBody
    ? beforeResolver.tryResolve<{ required?: boolean; content?: Record<string, MediaType> }>(
        before.operation.requestBody,
      )
    : null;
  const next = after.operation.requestBody
    ? afterResolver.tryResolve<{ required?: boolean; content?: Record<string, MediaType> }>(
        after.operation.requestBody,
      )
    : null;

  const at = extend(after.pointer, "requestBody");
  if (!previous && next) {
    out.push({
      kind: "added",
      category: "request-body",
      pointer: at,
      description: `${label}: a request body was added${next.required ? " and is required" : ""}.`,
      breaking: next.required === true,
    });
    return;
  }
  if (previous && !next) {
    out.push({
      kind: "removed",
      category: "request-body",
      pointer: at,
      description: `${label}: the request body was removed.`,
      breaking: true,
    });
    return;
  }
  if (!previous || !next) return;

  if (previous.required !== true && next.required === true) {
    out.push({
      kind: "modified",
      category: "request-body",
      pointer: extend(at, "required"),
      description: `${label}: the request body became required.`,
      breaking: true,
    });
  }

  const previousMedia = new Set(Object.keys(previous.content ?? {}));
  const nextMedia = new Set(Object.keys(next.content ?? {}));
  for (const media of previousMedia) {
    if (!nextMedia.has(media)) {
      out.push({
        kind: "removed",
        category: "request-body",
        pointer: extend(at, "content"),
        description: `${label}: request media type "${media}" is no longer accepted.`,
        breaking: true,
      });
    }
  }

  diffSchema(
    contentSchema(previous.content, beforeResolver),
    contentSchema(next.content, afterResolver),
    beforeResolver,
    afterResolver,
    extend(at, "content"),
    `${label} request body`,
    "request",
    out,
    0,
  );
}

function diffResponses(
  before: { operation: { responses?: Record<string, unknown> }; pointer: string },
  after: { operation: { responses?: Record<string, unknown> }; pointer: string },
  beforeResolver: RefResolver,
  afterResolver: RefResolver,
  label: string,
  out: Change[],
): void {
  const previousCodes = Object.keys(before.operation.responses ?? {});
  const nextCodes = Object.keys(after.operation.responses ?? {});

  for (const code of previousCodes) {
    if (nextCodes.includes(code)) continue;
    out.push({
      kind: "removed",
      category: "response",
      pointer: extend(after.pointer, "responses"),
      description: `${label}: response ${code} is no longer documented.`,
      breaking: code.startsWith("2"),
      before: code,
    });
  }
  for (const code of nextCodes) {
    if (previousCodes.includes(code)) continue;
    out.push({
      kind: "added",
      category: "response",
      pointer: extend(after.pointer, "responses", code),
      description: `${label}: response ${code} was added.`,
      breaking: false,
      after: code,
    });
  }

  for (const code of nextCodes) {
    if (!previousCodes.includes(code) || !code.startsWith("2")) continue;
    const previous = beforeResolver.tryResolve<{ content?: Record<string, MediaType> }>(
      before.operation.responses?.[code],
    );
    const next = afterResolver.tryResolve<{ content?: Record<string, MediaType> }>(
      after.operation.responses?.[code],
    );
    diffSchema(
      contentSchema(previous?.content, beforeResolver),
      contentSchema(next?.content, afterResolver),
      beforeResolver,
      afterResolver,
      extend(after.pointer, "responses", code),
      `${label} → ${code}`,
      "response",
      out,
      0,
    );
  }
}

function diffOperationSecurity(
  before: { operation: { security?: unknown[] } },
  after: { operation: { security?: unknown[] }; pointer: string },
  label: string,
  out: Change[],
): void {
  const previous = JSON.stringify(before.operation.security ?? null);
  const next = JSON.stringify(after.operation.security ?? null);
  if (previous === next) return;
  const tightened =
    (before.operation.security?.length ?? 0) === 0 && (after.operation.security?.length ?? 0) > 0;
  out.push({
    kind: "modified",
    category: "security",
    pointer: extend(after.pointer, "security"),
    description: `${label}: security requirements changed.`,
    breaking: tightened,
  });
}

/**
 * Compare two schemas. `direction` decides which side of the contract a change
 * breaks: removing a response property breaks readers, while adding a required
 * request property breaks writers.
 */
function diffSchema(
  before: Schema | null,
  after: Schema | null,
  beforeResolver: RefResolver,
  afterResolver: RefResolver,
  at: string,
  label: string,
  direction: "request" | "response",
  out: Change[],
  depth: number,
): void {
  if (depth > MAX_SCHEMA_DEPTH || (!before && !after)) return;
  if (!before || !after) return;

  const beforeType = Array.isArray(before.type) ? before.type.join("|") : before.type;
  const afterType = Array.isArray(after.type) ? after.type.join("|") : after.type;
  if (beforeType && afterType && beforeType !== afterType) {
    out.push({
      kind: "modified",
      category: "schema",
      pointer: at,
      description: `${label}: type changed from ${beforeType} to ${afterType}.`,
      breaking: true,
      before: beforeType,
      after: afterType,
    });
  }

  if (before.enum && after.enum) {
    const removed = before.enum.filter((value) => !after.enum?.includes(value));
    const added = after.enum.filter((value) => !before.enum?.includes(value));
    if (removed.length > 0) {
      out.push({
        kind: "modified",
        category: "schema",
        pointer: extend(at, "enum"),
        description: `${label}: enum value(s) ${removed.map(String).join(", ")} were removed.`,
        breaking: true,
      });
    }
    if (added.length > 0) {
      out.push({
        kind: "modified",
        category: "schema",
        pointer: extend(at, "enum"),
        description: `${label}: enum value(s) ${added.map(String).join(", ")} were added.`,
        // New response values break exhaustive consumers; new request values do not.
        breaking: direction === "response",
      });
    }
  }

  const beforeProps = before.properties ?? {};
  const afterProps = after.properties ?? {};
  const beforeRequired = new Set(before.required ?? []);
  const afterRequired = new Set(after.required ?? []);

  for (const name of Object.keys(beforeProps)) {
    if (name in afterProps) continue;
    out.push({
      kind: "removed",
      category: "schema",
      pointer: extend(at, "properties", name),
      description: `${label}: property "${name}" was removed.`,
      breaking: direction === "response" ? true : beforeRequired.has(name),
    });
  }

  for (const name of Object.keys(afterProps)) {
    if (name in beforeProps) continue;
    out.push({
      kind: "added",
      category: "schema",
      pointer: extend(at, "properties", name),
      description: `${label}: property "${name}" was added${afterRequired.has(name) ? " and is required" : ""}.`,
      breaking: direction === "request" && afterRequired.has(name),
    });
  }

  for (const name of afterRequired) {
    if (!beforeRequired.has(name) && name in beforeProps) {
      out.push({
        kind: "modified",
        category: "schema",
        pointer: extend(at, "required"),
        description: `${label}: property "${name}" became required.`,
        breaking: direction === "request",
      });
    }
  }
  for (const name of beforeRequired) {
    if (!afterRequired.has(name) && name in afterProps) {
      out.push({
        kind: "modified",
        category: "schema",
        pointer: extend(at, "required"),
        description: `${label}: property "${name}" is no longer guaranteed to be present.`,
        breaking: direction === "response",
      });
    }
  }

  for (const name of Object.keys(afterProps)) {
    if (!(name in beforeProps)) continue;
    const previousChild = beforeResolver.tryResolve<Schema>(beforeProps[name] as Schema);
    const nextChild = afterResolver.tryResolve<Schema>(afterProps[name] as Schema);
    diffSchema(
      previousChild,
      nextChild,
      beforeResolver,
      afterResolver,
      extend(at, "properties", name),
      `${label}.${name}`,
      direction,
      out,
      depth + 1,
    );
  }

  if (before.items && after.items) {
    diffSchema(
      beforeResolver.tryResolve<Schema>(before.items),
      afterResolver.tryResolve<Schema>(after.items),
      beforeResolver,
      afterResolver,
      extend(at, "items"),
      `${label}[]`,
      direction,
      out,
      depth + 1,
    );
  }
}

function diffComponentSchemas(
  before: OpenApiDocument,
  after: OpenApiDocument,
  out: Change[],
): void {
  const previous = before.components?.schemas ?? {};
  const next = after.components?.schemas ?? {};

  for (const name of Object.keys(previous)) {
    if (name in next) continue;
    out.push({
      kind: "removed",
      category: "schema",
      pointer: extend(pointer("components", "schemas"), name),
      description: `Schema "${name}" was removed.`,
      breaking: true,
    });
  }
  for (const name of Object.keys(next)) {
    if (name in previous) continue;
    out.push({
      kind: "added",
      category: "schema",
      pointer: extend(pointer("components", "schemas"), name),
      description: `Schema "${name}" was added.`,
      breaking: false,
    });
  }
}

/** Recommend the next version label given the previous one and the diff impact. */
export function nextVersionLabel(current: string, impact: VersionImpact): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(current.trim());
  if (!match) return current;
  const major = Number(match[1] ?? 0);
  const minor = Number(match[2] ?? 0);
  const patch = Number(match[3] ?? 0);
  switch (impact) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "none":
      return current;
  }
}

/** Guard for callers that only care whether a `$ref` was inlined. */
export function isRefLike(value: unknown): boolean {
  return isReference(value);
}
