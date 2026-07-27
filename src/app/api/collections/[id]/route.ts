import { getRepository } from "@/lib/repository";
import { NotFoundError } from "@/lib/repository/types";
import { ForbiddenError } from "@/lib/server/auth";
import { jsonResponse, route } from "@/lib/server/http";

type Params = { id: string };

async function loadOwned(identity: { userId: string }, id: string) {
  const repository = await getRepository();
  const workspace = await repository.ensureWorkspace(identity.userId);
  const collection = await repository.getCollection(id);
  if (!collection) throw new NotFoundError("Collection", id);
  if (collection.workspaceId !== workspace.id) throw new ForbiddenError();
  return { repository, collection };
}

export const GET = route<Params>(async ({ identity, params }) => {
  const { collection } = await loadOwned(identity, params.id);
  return jsonResponse({ collection });
});

export const DELETE = route<Params>(
  async ({ identity, params }) => {
    const { repository } = await loadOwned(identity, params.id);
    await repository.deleteCollection(params.id);
    return new Response(null, { status: 204 });
  },
  { scope: "collections:write" },
);
