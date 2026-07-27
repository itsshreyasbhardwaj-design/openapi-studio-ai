import { RefResolver } from "@/lib/core/openapi/deref";
import type { Diagnostic } from "@/lib/core/openapi/diagnostics";
import type { OpenApiDocument } from "@/lib/core/openapi/types";
import { SECURITY_RULES, type FindingSeverity, type SecurityFinding } from "./rules";

export interface SecuritySummary {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly info: number;
  readonly total: number;
}

export interface SecurityReport {
  readonly findings: readonly SecurityFinding[];
  readonly summary: SecuritySummary;
  /** 0–100, where 100 means no findings. */
  readonly score: number;
  readonly grade: "A" | "B" | "C" | "D" | "F";
  /** Findings grouped by OWASP category, ordered by severity. */
  readonly byCategory: readonly { category: string; findings: readonly SecurityFinding[] }[];
  readonly recommendations: readonly string[];
}

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
  info: 0.5,
};

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function grade(score: number): SecurityReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 78) return "B";
  if (score >= 62) return "C";
  if (score >= 45) return "D";
  return "F";
}

/**
 * Run the full security rule set over a document.
 *
 * The score is deliberately non-linear: a single critical finding (an
 * unauthenticated write endpoint, say) should drop an API out of the top grade
 * no matter how clean the rest of the specification is.
 */
export function analyzeSecurity(document: OpenApiDocument): SecurityReport {
  const ctx = { document, resolver: new RefResolver(document) };
  const findings: SecurityFinding[] = [];

  for (const rule of SECURITY_RULES) {
    try {
      findings.push(...rule.evaluate(ctx));
    } catch {
      // A malformed document must never take the analyser down; skip the rule.
    }
  }

  findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );

  const summary = summarise(findings);
  // Critical and high findings are counted in full; low-severity findings apply
  // diminishing returns so that a broadly sound API is not graded F purely for
  // repeating the same minor omission across many fields.
  const penalty =
    summary.critical * SEVERITY_WEIGHT.critical +
    summary.high * SEVERITY_WEIGHT.high +
    Math.min(summary.medium, 6) * SEVERITY_WEIGHT.medium +
    Math.min(summary.low, 8) * SEVERITY_WEIGHT.low +
    Math.min(summary.info, 10) * SEVERITY_WEIGHT.info;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  const categories = new Map<string, SecurityFinding[]>();
  for (const item of findings) {
    const bucket = categories.get(item.category);
    if (bucket) bucket.push(item);
    else categories.set(item.category, [item]);
  }

  return {
    findings,
    summary,
    score,
    grade: grade(score),
    byCategory: [...categories.entries()]
      .map(([category, items]) => ({ category, findings: items }))
      .sort((a, b) => a.category.localeCompare(b.category)),
    recommendations: topRecommendations(findings),
  };
}

function summarise(findings: readonly SecurityFinding[]): SecuritySummary {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: findings.length };
  for (const item of findings) summary[item.severity] += 1;
  return summary;
}

/** De-duplicated, severity-ordered remediation list for the report header. */
function topRecommendations(findings: readonly SecurityFinding[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of findings) {
    if (seen.has(item.recommendation)) continue;
    seen.add(item.recommendation);
    out.push(item.recommendation);
    if (out.length >= 8) break;
  }
  return out;
}

/** Expose security findings as editor diagnostics so they surface inline. */
export function securityDiagnostics(report: SecurityReport): Diagnostic[] {
  return report.findings.map((item) => ({
    rule: item.id,
    source: "security" as const,
    severity:
      item.severity === "critical" || item.severity === "high"
        ? ("error" as const)
        : item.severity === "medium"
          ? ("warning" as const)
          : ("info" as const),
    message: `${item.title}: ${item.detail}`,
    pointer: item.pointer,
    hint: item.recommendation,
  }));
}
