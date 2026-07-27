export type Severity = "error" | "warning" | "info";
export type DiagnosticSource = "structure" | "quality" | "security";

export interface Diagnostic {
  /** Stable machine-readable rule identifier, e.g. `operation-missing-4xx`. */
  readonly rule: string;
  readonly source: DiagnosticSource;
  readonly severity: Severity;
  readonly message: string;
  /** JSON Pointer to the offending node. */
  readonly pointer: string;
  /** Actionable remediation shown next to the message in the UI. */
  readonly hint?: string;
  /** Optional machine-applicable fix: set `value` at `pointer`. */
  readonly fix?: { readonly pointer: string; readonly value: unknown; readonly label: string };
}

export interface DiagnosticSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly total: number;
}

export function summarise(diagnostics: readonly Diagnostic[]): DiagnosticSummary {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
    else if (diagnostic.severity === "warning") warnings += 1;
    else infos += 1;
  }
  return { errors, warnings, infos, total: diagnostics.length };
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.pointer.localeCompare(b.pointer) ||
      a.rule.localeCompare(b.rule),
  );
}

/**
 * Convert diagnostics into a 0–100 quality score.
 *
 * Errors are weighted an order of magnitude above warnings so that a
 * structurally invalid document can never score in the "good" band, and the
 * penalty is normalised against document size so large APIs are not punished
 * simply for having more surface area.
 */
export function qualityScore(diagnostics: readonly Diagnostic[], operationCount: number): number {
  const { errors, warnings, infos } = summarise(diagnostics);
  const scale = Math.max(6, operationCount * 2);
  const penalty = (errors * 12 + warnings * 3 + infos * 1) / scale;
  return Math.max(0, Math.min(100, Math.round(100 - penalty * 10)));
}

export function scoreBand(score: number): "excellent" | "good" | "fair" | "poor" {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 50) return "fair";
  return "poor";
}
