import { z } from "zod";
import { SpecService } from "@/lib/services/spec-service";
import { jsonResponse, readJson, route } from "@/lib/server/http";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  kind: z.enum(["rest", "graphql", "webhook"]).optional(),
  source: z.string().min(1),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

/** List the caller's API projects with their current version. */
export const GET = route(async ({ identity }) => {
  const specs = await SpecService.list(identity);
  return jsonResponse({ specs });
});

/** Create an API project from a specification document. */
export const POST = route(
  async ({ request, identity, log }) => {
    const body = await readJson(request, createSchema);
    const created = await SpecService.create(identity, body);
    log.info("spec.created", { specId: created.project.id, kind: created.project.kind });
    return jsonResponse(created, { status: 201 });
  },
  { scope: "specs:write", limit: 30 },
);
