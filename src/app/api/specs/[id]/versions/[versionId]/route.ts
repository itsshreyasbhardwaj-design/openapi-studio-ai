import { z } from "zod";
import { SpecService } from "@/lib/services/spec-service";
import { ApiError, jsonResponse, readJson, route } from "@/lib/server/http";
import { getRepository } from "@/lib/repository";
import { NotFoundError } from "@/lib/repository/types";

type Params = { id: string; versionId: string };

const actionSchema = z.object({ action: z.enum(["rollback", "publish"]) });

/** Fetch one version including its full document. */
export const GET = route<Params>(async ({ identity, params }) => {
  const { version } = await SpecService.sourceFor(identity, params.id, params.versionId);
  return jsonResponse({ version });
});

/** Restore a version (`rollback`) or mark it published. */
export const POST = route<Params>(
  async ({ request, identity, params, log }) => {
    const { action } = await readJson(request, actionSchema);

    if (action === "rollback") {
      const version = await SpecService.rollback(identity, params.id, params.versionId);
      log.info("spec.rolled_back", { specId: params.id, toVersion: params.versionId });
      return jsonResponse({ version });
    }

    await SpecService.get(identity, params.id);
    const repository = await getRepository();
    const existing = await repository.getVersion(params.versionId);
    if (!existing || existing.specId !== params.id) {
      throw new NotFoundError("Specification version", params.versionId);
    }
    if (existing.status === "published")
      throw ApiError.conflict("This version is already published.");

    const version = await repository.updateVersion(params.versionId, { status: "published" });
    await repository.updateProject(params.id, {
      status: "published",
      currentVersionId: version.id,
    });
    log.info("spec.published", { specId: params.id, versionId: version.id });
    return jsonResponse({ version });
  },
  { scope: "specs:write" },
);
