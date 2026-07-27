import { notFound } from "next/navigation";
import { Designer } from "@/components/studio/designer/designer";
import { analyzeSource } from "@/lib/core/analysis";
import { fixableCount } from "@/lib/core/ai/autofix";
import { currentIdentity } from "@/lib/server/auth";
import { SpecService } from "@/lib/services/spec-service";
import type { AnalysisResponse } from "@/lib/client/api";

export const dynamic = "force-dynamic";

export default async function DesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await currentIdentity();
  const { version } = await SpecService.get(identity, id);
  if (!version) notFound();

  const analysis = analyzeSource(version.document);
  if (!analysis.ok) notFound();

  // Serialise the same shape the client route returns so the designer can
  // render immediately and then keep refreshing through `/api/analyze`.
  const initialAnalysis: AnalysisResponse = {
    valid: analysis.value.valid,
    format: analysis.value.format,
    score: analysis.value.score,
    band: analysis.value.band,
    summary: analysis.value.summary,
    stats: analysis.value.stats,
    documentationCoverage: analysis.value.documentationCoverage,
    diagnostics: [...analysis.value.diagnostics],
    fixable: fixableCount(analysis.value.diagnostics),
    security: {
      score: analysis.value.security.score,
      grade: analysis.value.security.grade,
      summary: analysis.value.security.summary,
      findings: [...analysis.value.security.findings],
      recommendations: [...analysis.value.security.recommendations],
      byCategory: analysis.value.security.byCategory.map((entry) => ({
        category: entry.category,
        findings: [...entry.findings],
      })),
    },
    document: analysis.value.document,
  };

  return <Designer specId={id} version={version} initialAnalysis={initialAnalysis} />;
}
