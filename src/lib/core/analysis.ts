import type { SpecFormat } from "@/lib/domain/types";
import { parseSpec, type ParseFailure } from "./openapi/document";
import {
  qualityScore,
  scoreBand,
  sortDiagnostics,
  summarise,
  type Diagnostic,
  type DiagnosticSummary,
} from "./openapi/diagnostics";
import { lintDocument } from "./openapi/lint";
import { documentStats, type DocumentStats } from "./openapi/navigate";
import type { OpenApiDocument } from "./openapi/types";
import { validateDocument } from "./openapi/validate";
import { analyzeSecurity, securityDiagnostics, type SecurityReport } from "./security/analyze";
import { err, ok, type Result } from "@/lib/utils/result";

export interface SpecAnalysis {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly summary: DiagnosticSummary;
  readonly score: number;
  readonly band: ReturnType<typeof scoreBand>;
  readonly stats: DocumentStats;
  readonly security: SecurityReport;
  readonly documentationCoverage: number;
}

export interface AnalyzedSource extends SpecAnalysis {
  readonly document: OpenApiDocument;
  readonly format: SpecFormat;
}

/**
 * The single analysis entry point used by the API routes, the editor and CI.
 *
 * Combining structural validation, quality linting and security analysis in one
 * place guarantees that every surface reports the same score for the same
 * document.
 */
export function analyzeDocument(document: OpenApiDocument): SpecAnalysis {
  const security = analyzeSecurity(document);
  const diagnostics = sortDiagnostics([
    ...validateDocument(document),
    ...lintDocument(document),
    ...securityDiagnostics(security),
  ]);
  const stats = documentStats(document);
  const structural = diagnostics.filter((item) => item.source === "structure");

  return {
    valid: structural.every((item) => item.severity !== "error"),
    diagnostics,
    summary: summarise(diagnostics),
    score: qualityScore(diagnostics, stats.operations),
    band: scoreBand(qualityScore(diagnostics, stats.operations)),
    stats,
    security,
    documentationCoverage:
      stats.operations === 0
        ? 100
        : Math.round((stats.documentedOperations / stats.operations) * 100),
  };
}

/** Parse then analyse. Returns a parse failure when the source is not valid YAML/JSON. */
export function analyzeSource(source: string): Result<AnalyzedSource, ParseFailure> {
  const parsed = parseSpec(source);
  if (!parsed.ok) return err(parsed.error);
  const analysis = analyzeDocument(parsed.value.document);
  return ok({ ...analysis, document: parsed.value.document, format: parsed.value.format });
}
