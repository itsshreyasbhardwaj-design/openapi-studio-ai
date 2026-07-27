import { z } from "zod";
import { diffDocuments, nextVersionLabel } from "@/lib/core/openapi/diff";
import { parseSpec } from "@/lib/core/openapi/document";
import { ApiError, jsonResponse, readJson, route } from "@/lib/server/http";
import { SpecService } from "@/lib/services/spec-service";

const schema = z
  .object({
    before: z.string().optional(),
    after: z.string().optional(),
    specId: z.string().optional(),
    beforeVersionId: z.string().optional(),
    afterVersionId: z.string().optional(),
  })
  .refine(
    (value) =>
      (value.before && value.after) ||
      (value.specId && value.beforeVersionId && value.afterVersionId),
    { message: "Supply either both documents or a specId with two version ids." },
  );

/** Semantic diff between two documents or two stored versions. */
export const POST = route(
  async ({ request, identity }) => {
    const body = await readJson(request, schema);

    let beforeSource = body.before;
    let afterSource = body.after;

    if (body.specId && body.beforeVersionId && body.afterVersionId) {
      const [before, after] = await Promise.all([
        SpecService.sourceFor(identity, body.specId, body.beforeVersionId),
        SpecService.sourceFor(identity, body.specId, body.afterVersionId),
      ]);
      beforeSource = before.source;
      afterSource = after.source;
    }

    const previous = parseSpec(beforeSource ?? "");
    const next = parseSpec(afterSource ?? "");
    if (!previous.ok)
      throw ApiError.badRequest(`Base document is invalid: ${previous.error.message}`);
    if (!next.ok)
      throw ApiError.badRequest(`Comparison document is invalid: ${next.error.message}`);

    const diff = diffDocuments(previous.value.document, next.value.document);
    return jsonResponse({
      ...diff,
      suggestedVersion: nextVersionLabel(
        previous.value.document.info?.version ?? "1.0.0",
        diff.impact,
      ),
    });
  },
  { scope: "diff", limit: 120 },
);
