import { parseSpec, stringifySpec } from "@/lib/core/openapi/document";
import { validateDocument } from "@/lib/core/openapi/validate";
import type { OpenApiDocument } from "@/lib/core/openapi/types";
import { err, ok, type Result } from "@/lib/utils/result";

/**
 * Strip the wrappers language models habitually add around a document:
 * markdown fences, leading prose, trailing explanations.
 */
export function extractSpecSource(raw: string): string {
  const trimmed = raw.trim();

  const fence = /```(?:ya?ml|json)?\s*\n([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();

  // JSON document embedded in prose.
  if (!trimmed.startsWith("{")) {
    const jsonStart = trimmed.indexOf('{\n  "openapi"');
    if (jsonStart >= 0) {
      const candidate = trimmed.slice(jsonStart);
      const lastBrace = candidate.lastIndexOf("}");
      if (lastBrace > 0) return candidate.slice(0, lastBrace + 1);
    }
  }

  // YAML document that begins with the `openapi:` key somewhere after prose.
  const yamlStart = trimmed.search(/^openapi:\s*["']?3\./m);
  if (yamlStart > 0) return trimmed.slice(yamlStart).trim();

  return trimmed;
}

export interface ExtractedSpec {
  readonly source: string;
  readonly document: OpenApiDocument;
  readonly errors: readonly string[];
}

/**
 * Extract, parse and structurally validate a model response.
 *
 * Returns the document *with* its outstanding errors rather than throwing, so
 * the caller can decide between a repair round-trip and falling back to the
 * offline synthesiser.
 */
export function extractAndValidate(raw: string): Result<ExtractedSpec, { message: string }> {
  const source = extractSpecSource(raw);
  if (!source) return err({ message: "The model returned an empty response." });

  const parsed = parseSpec(source);
  if (!parsed.ok) {
    return err({
      message: `The generated document is not valid ${source.trimStart().startsWith("{") ? "JSON" : "YAML"}: ${parsed.error.message}`,
    });
  }

  const errors = validateDocument(parsed.value.document)
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.pointer || "(root)"}: ${diagnostic.message}`);

  return ok({
    // Normalise formatting so downstream diffs are stable.
    source: stringifySpec(parsed.value.document, "yaml"),
    document: parsed.value.document,
    errors,
  });
}
