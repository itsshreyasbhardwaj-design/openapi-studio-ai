import { z } from "zod";
import { SpecService } from "@/lib/services/spec-service";
import { ApiError, jsonResponse, readJson, route } from "@/lib/server/http";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  status: z.enum(["draft", "published", "deprecated"]).optional(),
  kind: z.enum(["rest", "graphql", "webhook"]).optional(),
});

type Params = { id: string };

export const GET = route<Params>(async ({ identity, params }) => {
  const spec = await SpecService.get(identity, params.id);
  return jsonResponse(spec);
});

export const PATCH = route<Params>(
  async ({ request, identity, params }) => {
    const body = await readJson(request, patchSchema);
    if (Object.keys(body).length === 0) throw ApiError.badRequest("No fields to update.");
    const project = await SpecService.updateMetadata(identity, params.id, body);
    return jsonResponse({ project });
  },
  { scope: "specs:write" },
);

export const DELETE = route<Params>(
  async ({ identity, params, log }) => {
    await SpecService.remove(identity, params.id);
    log.info("spec.deleted", { specId: params.id });
    return new Response(null, { status: 204 });
  },
  { scope: "specs:write" },
);
