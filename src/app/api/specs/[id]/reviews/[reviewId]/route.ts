import { z } from "zod";
import { getRepository } from "@/lib/repository";
import { NotFoundError } from "@/lib/repository/types";
import { ApiError, jsonResponse, readJson, route } from "@/lib/server/http";
import { SpecService } from "@/lib/services/spec-service";

type Params = { id: string; reviewId: string };

const patchSchema = z.object({
  decision: z.enum(["approved", "changes_requested", "commented"]).optional(),
  note: z.string().max(4000).default(""),
  status: z.enum(["open", "approved", "changes_requested", "merged", "closed"]).optional(),
});

/**
 * Record a review decision or transition the request.
 *
 * Merging is gated: a review cannot move to `merged` while any reviewer has
 * requested changes, which is what makes the approval step meaningful.
 */
export const PATCH = route<Params>(
  async ({ request, identity, params, log }) => {
    await SpecService.get(identity, params.id);
    const body = await readJson(request, patchSchema);
    const repository = await getRepository();

    const review = await repository.getReview(params.reviewId);
    if (!review || review.specId !== params.id)
      throw new NotFoundError("Review request", params.reviewId);

    const decisions = body.decision
      ? [
          ...review.decisions,
          {
            reviewerId: identity.userId,
            reviewerName: identity.displayName,
            decision: body.decision,
            note: body.note,
            createdAt: new Date().toISOString(),
          },
        ]
      : review.decisions;

    const blocking = decisions.some((entry) => entry.decision === "changes_requested");
    let status = body.status ?? review.status;

    if (body.decision === "approved" && !body.status)
      status = blocking ? "changes_requested" : "approved";
    if (body.decision === "changes_requested") status = "changes_requested";
    if (status === "merged" && blocking) {
      throw ApiError.conflict("This review cannot be merged while changes are requested.");
    }

    const updated = await repository.updateReview(params.reviewId, { decisions, status });
    log.info("review.updated", { reviewId: params.reviewId, status });
    return jsonResponse({ review: updated });
  },
  { scope: "reviews:write" },
);

export const GET = route<Params>(async ({ identity, params }) => {
  await SpecService.get(identity, params.id);
  const repository = await getRepository();
  const review = await repository.getReview(params.reviewId);
  if (!review || review.specId !== params.id)
    throw new NotFoundError("Review request", params.reviewId);
  return jsonResponse({ review });
});
