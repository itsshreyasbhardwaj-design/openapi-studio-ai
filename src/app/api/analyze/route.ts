import { z } from "zod";
import { SpecService } from "@/lib/services/spec-service";
import { fixableCount } from "@/lib/core/ai/autofix";
import { jsonResponse, readJson, route } from "@/lib/server/http";

const schema = z.object({ source: z.string().min(1) });

/**
 * Validate, lint and security-scan a specification in one call.
 *
 * Returns the document itself so the editor can render the visual view from the
 * same parse the diagnostics came from.
 */
export const POST = route(
  async ({ request }) => {
    const { source } = await readJson(request, schema);
    const analysis = await SpecService.analyze(source);

    return jsonResponse({
      valid: analysis.valid,
      format: analysis.format,
      score: analysis.score,
      band: analysis.band,
      summary: analysis.summary,
      stats: analysis.stats,
      documentationCoverage: analysis.documentationCoverage,
      diagnostics: analysis.diagnostics,
      fixable: fixableCount(analysis.diagnostics),
      security: {
        score: analysis.security.score,
        grade: analysis.security.grade,
        summary: analysis.security.summary,
        findings: analysis.security.findings,
        recommendations: analysis.security.recommendations,
        byCategory: analysis.security.byCategory,
      },
      document: analysis.document,
    });
  },
  { scope: "analyze", limit: 240 },
);
