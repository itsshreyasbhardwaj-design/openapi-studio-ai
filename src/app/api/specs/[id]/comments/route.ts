import { z } from "zod";
import { getRepository } from "@/lib/repository";
import { jsonResponse, readJson, route } from "@/lib/server/http";
import { SpecService } from "@/lib/services/spec-service";
import { newId } from "@/lib/utils/id";

type Params = { id: string };

const createSchema = z.object({
  pointer: z.string().max(500).default(""),
  body: z.string().min(1).max(4000),
  versionId: z.string().nullable().default(null),
});

/** Review comments anchored to a JSON Pointer inside the specification. */
export const GET = route<Params>(async ({ identity, params }) => {
  await SpecService.get(identity, params.id);
  const repository = await getRepository();
  return jsonResponse({ comments: await repository.listComments(params.id) });
});

export const POST = route<Params>(
  async ({ request, identity, params }) => {
    await SpecService.get(identity, params.id);
    const body = await readJson(request, createSchema);
    const repository = await getRepository();

    const comment = await repository.createComment({
      id: newId("cmt"),
      specId: params.id,
      versionId: body.versionId,
      pointer: body.pointer,
      body: body.body,
      authorId: identity.userId,
      authorName: identity.displayName,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
    return jsonResponse({ comment }, { status: 201 });
  },
  { scope: "comments:write", limit: 120 },
);
