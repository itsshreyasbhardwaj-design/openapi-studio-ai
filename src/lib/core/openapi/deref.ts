import { resolvePointer } from "./pointer";
import { isReference, type OpenApiDocument, type Reference } from "./types";

export interface DerefOptions {
  /** Maximum depth before a cyclic structure is replaced by a stub. */
  readonly maxDepth?: number;
}

export class RefResolutionError extends Error {
  constructor(readonly ref: string) {
    super(`Unable to resolve $ref "${ref}".`);
    this.name = "RefResolutionError";
  }
}

/**
 * Resolver for local (`#/...`) references.
 *
 * External references are deliberately *not* fetched: a design tool that
 * silently performs network requests while validating untrusted specifications
 * is an SSRF vector. External refs are surfaced as diagnostics instead.
 */
export class RefResolver {
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly root: OpenApiDocument) {}

  isLocal(ref: string): boolean {
    return ref.startsWith("#/") || ref === "#";
  }

  /** Resolve one hop. Throws {@link RefResolutionError} when unresolvable. */
  resolveOnce<T>(reference: Reference): T {
    const { $ref } = reference;
    if (!this.isLocal($ref)) throw new RefResolutionError($ref);
    if (this.cache.has($ref)) return this.cache.get($ref) as T;

    const value = resolvePointer(this.root, $ref.slice(1));
    if (value === undefined) throw new RefResolutionError($ref);
    this.cache.set($ref, value);
    return value as T;
  }

  /** Follow a chain of references until a concrete value is reached. */
  resolve<T>(value: unknown, seen = new Set<string>()): T {
    let current: unknown = value;
    while (isReference(current)) {
      const ref = current.$ref;
      if (seen.has(ref)) throw new RefResolutionError(ref);
      seen.add(ref);
      current = this.resolveOnce(current);
    }
    return current as T;
  }

  /** Resolve, returning `null` instead of throwing for unresolvable refs. */
  tryResolve<T>(value: unknown): T | null {
    try {
      const resolved = this.resolve<T>(value);
      return resolved === undefined ? null : resolved;
    } catch {
      return null;
    }
  }
}

/**
 * Fully dereference a document, replacing cycles with `{}` stubs at
 * `maxDepth`. Used by the SDK generator and documentation renderer, which need
 * a self-contained tree.
 */
export function dereference(
  document: OpenApiDocument,
  options: DerefOptions = {},
): OpenApiDocument {
  const maxDepth = options.maxDepth ?? 12;
  const resolver = new RefResolver(document);

  const walk = (node: unknown, depth: number, stack: ReadonlySet<string>): unknown => {
    if (depth > maxDepth) return {};
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1, stack));
    if (!node || typeof node !== "object") return node;

    if (isReference(node)) {
      const ref = node.$ref;
      if (stack.has(ref)) return { $ref: ref, "x-circular": true };
      const target = resolver.tryResolve(node);
      if (target === null) return { $ref: ref, "x-unresolved": true };
      return walk(target, depth + 1, new Set([...stack, ref]));
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = walk(value, depth + 1, stack);
    }
    return out;
  };

  return walk(document, 0, new Set()) as OpenApiDocument;
}

/** Collect every `$ref` string appearing in a document, with its pointer. */
export function collectRefs(document: OpenApiDocument): { pointer: string; ref: string }[] {
  const found: { pointer: string; ref: string }[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}/${index}`));
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.$ref === "string") found.push({ pointer: path, ref: record.$ref });
    for (const [key, value] of Object.entries(record)) {
      walk(value, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
    }
  };
  walk(document, "");
  return found;
}
