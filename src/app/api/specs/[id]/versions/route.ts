import { z } from "zod";
import { SpecService } from "@/lib/services/spec-service";
import { jsonResponse, readJson, route } from "@/lib/server/http";

const saveSchema = z.object({
  source: z.string().min(1),
  message: z.string().max(500).optional(),
  label: z.string().max(60).optional(),
  publish: z.boolean().optional(),
});

type Params = { id: string };

/** Full version history, newest first. */
export const GET = route<Params>(async ({ identity, params }) => {
  const versions = await SpecService.listVersions(identity, params.id);
  return jsonResponse({
    versions: versions.map((version) => ({
      ...version,
      document: undefined,
      sizeBytes: version.document.length,
    })),
  });
});

/** Commit a new version; the label is derived from the semantic diff. */
export const POST = route<Params>(
  async ({ request, identity, params, log }) => {
    const body = await readJson(request, saveSchema);
    const result = await SpecService.saveVersion(identity, params.id, body);
    log.info("spec.version_saved", {
      specId: params.id,
      versionId: result.version.id,
      impact: result.diff?.impact ?? "initial",
      breaking: result.diff?.breakingCount ?? 0,
    });
    return jsonResponse(result, { status: 201 });
  },
  { scope: "specs:write", limit: 60 },
);
