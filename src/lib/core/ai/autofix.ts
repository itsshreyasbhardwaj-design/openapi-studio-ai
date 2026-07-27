import { parseSpec, stringifySpec } from "@/lib/core/openapi/document";
import type { Diagnostic } from "@/lib/core/openapi/diagnostics";
import { parsePointer } from "@/lib/core/openapi/pointer";
import type { OpenApiDocument } from "@/lib/core/openapi/types";

export interface AutofixResult {
  readonly source: string;
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Write a value at a JSON Pointer, creating intermediate containers.
 *
 * Returns false when the path traverses a non-container, which keeps the
 * autofixer from corrupting a document it does not understand.
 */
export function setAtPointer(root: unknown, pointer: string, value: unknown): boolean {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return false;

  let current: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    const nextToken = tokens[index + 1]!;
    if (Array.isArray(current)) {
      const arrayIndex = Number(token);
      if (!Number.isInteger(arrayIndex)) return false;
      current[arrayIndex] ??= /^\d+$/.test(nextToken) ? [] : {};
      current = current[arrayIndex];
      continue;
    }
    if (!current || typeof current !== "object") return false;
    const container = current as Record<string, unknown>;
    container[token] ??= /^\d+$/.test(nextToken) ? [] : {};
    current = container[token];
  }

  const last = tokens[tokens.length - 1]!;
  if (Array.isArray(current)) {
    const arrayIndex = Number(last);
    if (!Number.isInteger(arrayIndex)) return false;
    current[arrayIndex] = value;
    return true;
  }
  if (!current || typeof current !== "object") return false;
  (current as Record<string, unknown>)[last] = value;
  return true;
}

/**
 * Apply every machine-applicable fix carried by a diagnostic set.
 *
 * This is what makes "improve my specification" useful with no AI provider
 * configured at all: descriptions, missing error responses, operationIds,
 * required flags and server blocks are all repaired deterministically.
 */
export function applyFixes(source: string, diagnostics: readonly Diagnostic[]): AutofixResult {
  const parsed = parseSpec(source);
  if (!parsed.ok) {
    return {
      source,
      applied: [],
      skipped: [`The document could not be parsed: ${parsed.error.message}`],
    };
  }

  const document: OpenApiDocument = structuredClone(parsed.value.document);
  const applied: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const diagnostic of diagnostics) {
    const fix = diagnostic.fix;
    if (!fix) continue;
    if (seen.has(fix.pointer)) continue;
    seen.add(fix.pointer);

    if (setAtPointer(document, fix.pointer, fix.value)) {
      applied.push(`${fix.label} at ${fix.pointer || "(root)"}`);
    } else {
      skipped.push(`Could not apply "${fix.label}" at ${fix.pointer}`);
    }
  }

  return {
    source: applied.length > 0 ? stringifySpec(document, parsed.value.format) : source,
    applied,
    skipped,
  };
}

/** Count how many of the supplied diagnostics can be fixed automatically. */
export function fixableCount(diagnostics: readonly Diagnostic[]): number {
  return new Set(
    diagnostics.filter((diagnostic) => diagnostic.fix).map((diagnostic) => diagnostic.fix!.pointer),
  ).size;
}
