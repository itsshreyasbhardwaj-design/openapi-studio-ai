import { extend, pointer } from "./pointer";
import { RefResolver } from "./deref";
import {
  HTTP_METHODS,
  isReference,
  type HttpMethodLower,
  type OpenApiDocument,
  type Operation,
  type OperationEntry,
  type Parameter,
  type PathItem,
  type SecurityRequirement,
} from "./types";

/** Derive a stable operationId when the document does not declare one. */
export function synthesiseOperationId(method: string, path: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith("{")
        ? `By${capitalise(segment.replace(/[{}]/g, ""))}`
        : capitalise(
            segment
              .replace(/[^a-zA-Z0-9]+/g, " ")
              .trim()
              .replace(/\s+/g, " "),
          ),
    )
    .map((segment) =>
      segment.replace(/\s(.)/g, (_, c: string) => c.toUpperCase()).replace(/\s/g, ""),
    );
  const tail = segments.join("") || "Root";
  return `${method.toLowerCase()}${tail}`;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function mergeParameters(
  pathItem: PathItem,
  operation: Operation,
  resolver: RefResolver,
): Parameter[] {
  const resolveAll = (list: PathItem["parameters"]): Parameter[] =>
    (list ?? [])
      .map((entry) => (isReference(entry) ? resolver.tryResolve<Parameter>(entry) : entry))
      .filter((entry): entry is Parameter => entry !== null && typeof entry === "object");

  const inherited = resolveAll(pathItem.parameters);
  const own = resolveAll(operation.parameters);
  const key = (parameter: Parameter): string => `${parameter.in ?? "?"}:${parameter.name ?? "?"}`;
  const merged = new Map<string, Parameter>();
  for (const parameter of inherited) merged.set(key(parameter), parameter);
  for (const parameter of own) merged.set(key(parameter), parameter); // operation wins
  return [...merged.values()];
}

/**
 * Flatten a document into an ordered list of operations.
 *
 * This is the single traversal used by the documentation renderer, the SDK
 * generators, the mock router, the security analyser and the diff engine, which
 * guarantees they all agree on what "the operations" of a document are.
 */
export function listOperations(document: OpenApiDocument): OperationEntry[] {
  const resolver = new RefResolver(document);
  const entries: OperationEntry[] = [];

  const visit = (
    container: Record<string, unknown> | undefined,
    kind: OperationEntry["kind"],
    rootKey: "paths" | "webhooks",
  ): void => {
    for (const [path, rawItem] of Object.entries(container ?? {})) {
      const pathItem = (
        isReference(rawItem) ? resolver.tryResolve<PathItem>(rawItem) : rawItem
      ) as PathItem | null;
      if (!pathItem || typeof pathItem !== "object") continue;

      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation || typeof operation !== "object") continue;
        entries.push({
          path,
          method,
          operationId: operation.operationId ?? synthesiseOperationId(method, path),
          operation,
          parameters: mergeParameters(pathItem, operation, resolver),
          tags: operation.tags ?? [],
          deprecated: operation.deprecated === true,
          pointer: extend(pointer(rootKey), path, method),
          kind,
        });
      }
    }
  };

  visit(document.paths as Record<string, unknown> | undefined, "path", "paths");
  visit(document.webhooks as Record<string, unknown> | undefined, "webhook", "webhooks");
  return entries;
}

/** Group operations by their first tag, falling back to `Default`. */
export function groupByTag(
  entries: readonly OperationEntry[],
): { tag: string; operations: OperationEntry[] }[] {
  const groups = new Map<string, OperationEntry[]>();
  for (const entry of entries) {
    const tag = entry.tags[0] ?? "Default";
    const bucket = groups.get(tag);
    if (bucket) bucket.push(entry);
    else groups.set(tag, [entry]);
  }
  return [...groups.entries()]
    .map(([tag, operations]) => ({ tag, operations }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Effective security for an operation (operation-level overrides global). */
export function effectiveSecurity(
  document: OpenApiDocument,
  operation: Operation,
): SecurityRequirement[] {
  if (Array.isArray(operation.security)) return operation.security;
  return document.security ?? [];
}

/** Extract `{placeholders}` declared in a path template. */
export function pathTemplateVariables(path: string): string[] {
  return [...path.matchAll(/\{([^}]*)\}/g)].map((match) => match[1] ?? "").filter(Boolean);
}

export function methodsOf(pathItem: PathItem): HttpMethodLower[] {
  return HTTP_METHODS.filter((method) => Boolean(pathItem[method]));
}

/** Count of operations, schemas, and other headline document statistics. */
export interface DocumentStats {
  readonly operations: number;
  readonly paths: number;
  readonly webhooks: number;
  readonly schemas: number;
  readonly securitySchemes: number;
  readonly tags: number;
  readonly deprecated: number;
  readonly documentedOperations: number;
}

export function documentStats(document: OpenApiDocument): DocumentStats {
  const operations = listOperations(document);
  return {
    operations: operations.length,
    paths: Object.keys(document.paths ?? {}).length,
    webhooks: Object.keys(document.webhooks ?? {}).length,
    schemas: Object.keys(document.components?.schemas ?? {}).length,
    securitySchemes: Object.keys(document.components?.securitySchemes ?? {}).length,
    tags: (document.tags ?? []).length,
    deprecated: operations.filter((entry) => entry.deprecated).length,
    documentedOperations: operations.filter(
      (entry) => Boolean(entry.operation.description) || Boolean(entry.operation.summary),
    ).length,
  };
}
