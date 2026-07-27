import { z } from "zod";
import { getRepository } from "@/lib/repository";
import { jsonResponse, readJson, route } from "@/lib/server/http";
import { SpecService } from "@/lib/services/spec-service";

type Params = { id: string; commentId: string };

const patchSchema = z.object({
  body: z.string().min(1).max(4000).optional(),
  resolved: z.boolean().optional(),
});

export const PATCH = route<Params>(
  async ({ request, identity, params }) => {
    await SpecService.get(identity, params.id);
    const patch = await readJson(request, patchSchema);
    const repository = await getRepository();
    const comment = await repository.updateComment(params.commentId, patch);
    return jsonResponse({ comment });
  },
  { scope: "comments:write" },
);

export const DELETE = route<Params>(
  async ({ identity, params }) => {
    await SpecService.get(identity, params.id);
    const repository = await getRepository();
    await repository.deleteComment(params.commentId);
    return new Response(null, { status: 204 });
  },
  { scope: "comments:write" },
);
