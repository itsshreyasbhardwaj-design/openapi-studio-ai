import { z } from "zod";
import { getRepository } from "@/lib/repository";
import { jsonResponse, readJson, route } from "@/lib/server/http";
import { SpecService } from "@/lib/services/spec-service";
import { newId } from "@/lib/utils/id";

type Params = { id: string };

const createSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(4000).default(""),
  versionId: z.string().min(1),
  baseVersionId: z.string().nullable().default(null),
  reviewers: z.array(z.string().max(120)).max(20).default([]),
});

/** Change-approval requests raised against a specific version. */
export const GET = route<Params>(async ({ identity, params }) => {
  await SpecService.get(identity, params.id);
  const repository = await getRepository();
  return jsonResponse({ reviews: await repository.listReviews(params.id) });
});

export const POST = route<Params>(
  async ({ request, identity, params, log }) => {
    await SpecService.get(identity, params.id);
    const body = await readJson(request, createSchema);
    const repository = await getRepository();
    const now = new Date().toISOString();

    const review = await repository.createReview({
      id: newId("rev"),
      specId: params.id,
      versionId: body.versionId,
      baseVersionId: body.baseVersionId,
      title: body.title,
      description: body.description,
      status: "open",
      requestedBy: identity.userId,
      requestedByName: identity.displayName,
      reviewers: body.reviewers,
      decisions: [],
      createdAt: now,
      updatedAt: now,
    });

    log.info("review.created", { specId: params.id, reviewId: review.id });
    return jsonResponse({ review }, { status: 201 });
  },
  { scope: "reviews:write", limit: 60 },
);
