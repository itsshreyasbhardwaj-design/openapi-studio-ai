import { z } from "zod";
import { improveSpec } from "@/lib/core/ai";
import { applyFixes } from "@/lib/core/ai/autofix";
import { SpecService } from "@/lib/services/spec-service";
import { jsonResponse, readJson, route } from "@/lib/server/http";

export const maxDuration = 120;

const schema = z.object({
  source: z.string().min(1),
  /** `auto` applies deterministic fixes only; `ai` asks the model to revise. */
  mode: z.enum(["auto", "ai"]).default("auto"),
  /** Restrict the work to a subset of rules. */
  rules: z.array(z.string().max(80)).max(100).optional(),
});

/** Apply improvement suggestions to a specification. */
export const POST = route(
  async ({ request, log }) => {
    const body = await readJson(request, schema);
    const analysis = await SpecService.analyze(body.source);

    const diagnostics = body.rules?.length
      ? analysis.diagnostics.filter((diagnostic) => body.rules?.includes(diagnostic.rule))
      : analysis.diagnostics;

    if (body.mode === "auto") {
      const result = applyFixes(body.source, diagnostics);
      const after = await SpecService.analyze(result.source);
      log.info("ai.autofix", { applied: result.applied.length });
      return jsonResponse({
        source: result.source,
        engine: "offline" as const,
        applied: result.applied,
        skipped: result.skipped,
        scoreBefore: analysis.score,
        scoreAfter: after.score,
      });
    }

    const result = await improveSpec(body.source, diagnostics, request.signal);
    const after = await SpecService.analyze(result.source);
    log.info("ai.improved", { engine: result.engine });
    return jsonResponse({
      source: result.source,
      engine: result.engine,
      applied: result.notes,
      skipped: [],
      scoreBefore: analysis.score,
      scoreAfter: after.score,
    });
  },
  { scope: "ai:improve", limit: 30 },
);
