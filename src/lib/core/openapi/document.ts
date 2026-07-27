import YAML from "yaml";
import type { SpecFormat } from "@/lib/domain/types";
import { err, ok, type Result } from "@/lib/utils/result";
import type { OpenApiDocument } from "./types";

export interface ParseFailure {
  readonly message: string;
  readonly line: number | null;
  readonly column: number | null;
}

export interface ParsedSpec {
  readonly document: OpenApiDocument;
  readonly format: SpecFormat;
  readonly source: string;
}

/**
 * Detect whether a source string is JSON or YAML.
 *
 * JSON is a subset of YAML, so the check is intentionally shape-based: a
 * document whose first significant character is `{` and which round-trips
 * through `JSON.parse` is treated as JSON, everything else as YAML.
 */
export function detectFormat(source: string): SpecFormat {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith("{")) return "yaml";
  try {
    JSON.parse(source);
    return "json";
  } catch {
    return "yaml";
  }
}

/** Parse a specification source into a document, reporting the failing line. */
export function parseSpec(source: string): Result<ParsedSpec, ParseFailure> {
  const format = detectFormat(source);
  if (!source.trim()) {
    return err({ message: "The specification is empty.", line: 1, column: 1 });
  }

  if (format === "json") {
    try {
      const document = JSON.parse(source) as OpenApiDocument;
      if (typeof document !== "object" || document === null || Array.isArray(document)) {
        return err({
          message: "The root of an OpenAPI document must be an object.",
          line: 1,
          column: 1,
        });
      }
      return ok({ document, format, source });
    } catch (error) {
      return err({
        message: error instanceof Error ? error.message : String(error),
        line: null,
        column: null,
      });
    }
  }

  const parsed = YAML.parseDocument(source, { prettyErrors: true, uniqueKeys: true });
  const firstError = parsed.errors[0];
  if (firstError) {
    return err({
      message: firstError.message,
      line: firstError.linePos?.[0]?.line ?? null,
      column: firstError.linePos?.[0]?.col ?? null,
    });
  }

  const value = parsed.toJS({ maxAliasCount: 200 }) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err({
      message: "The root of an OpenAPI document must be a mapping.",
      line: 1,
      column: 1,
    });
  }
  return ok({ document: value as OpenApiDocument, format, source });
}

/** Serialise a document back to a source string in the requested format. */
export function stringifySpec(document: OpenApiDocument, format: SpecFormat): string {
  if (format === "json") return `${JSON.stringify(document, null, 2)}\n`;
  return YAML.stringify(document, {
    indent: 2,
    lineWidth: 100,
    aliasDuplicateObjects: false,
    singleQuote: false,
  });
}

/** Convert a source document between YAML and JSON, preserving semantics. */
export function convertFormat(source: string, to: SpecFormat): Result<string, ParseFailure> {
  const parsed = parseSpec(source);
  if (!parsed.ok) return parsed;
  if (parsed.value.format === to) return ok(source);
  return ok(stringifySpec(parsed.value.document, to));
}

/** Duplicate a document safely (used before applying mutations in the editor). */
export function cloneDocument<T>(document: T): T {
  return structuredClone(document);
}

/** The OpenAPI major/minor version of a document, e.g. `3.1`. */
export function specVersionOf(document: OpenApiDocument): "3.0" | "3.1" | "unknown" {
  const raw = document.openapi ?? "";
  if (/^3\.1(\.\d+)?$/.test(raw)) return "3.1";
  if (/^3\.0(\.\d+)?$/.test(raw)) return "3.0";
  return "unknown";
}
