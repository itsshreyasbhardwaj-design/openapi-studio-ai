import { z } from "zod";
import { buildOverview } from "@/lib/core/telemetry/metrics";
import { getRepository } from "@/lib/repository";
import { jsonResponse, readJson, route } from "@/lib/server/http";
import { SpecService } from "@/lib/services/spec-service";
import { newId } from "@/lib/utils/id";

export const dynamic = "force-dynamic";

const recordSchema = z.object({
  specId: z.string().min(1),
  method: z.string().max(10),
  path: z.string().max(500),
  status: z.number().int().min(0).max(599),
  durationMs: z.number().int().min(0).max(600_000),
  source: z.enum(["mock", "client", "monitor"]).default("monitor"),
});

const WINDOWS: Record<string, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

/** Aggregated monitoring overview for one API (or the whole workspace). */
export const GET = route(async ({ request, identity }) => {
  const url = new URL(request.url);
  const specId = url.searchParams.get("specId");
  const window = url.searchParams.get("window") ?? "24h";
  const windowMs = WINDOWS[window] ?? WINDOWS["24h"]!;

  if (specId) await SpecService.get(identity, specId);

  const repository = await getRepository();
  const since = new Date(Date.now() - windowMs).toISOString();
  const samples = await repository.listMetrics(specId, since);

  return jsonResponse({
    window,
    since,
    overview: buildOverview(samples, { bucketMs: windowMs <= 3_600_000 ? 300_000 : 3_600_000 }),
  });
});

/** Ingest a sample from an external collector or the browser client. */
export const POST = route(
  async ({ request, identity }) => {
    const body = await readJson(request, recordSchema);
    await SpecService.get(identity, body.specId);

    const repository = await getRepository();
    await repository.recordMetric({
      id: newId("mtr"),
      timestamp: new Date().toISOString(),
      ...body,
    });
    return jsonResponse({ recorded: true }, { status: 201 });
  },
  { scope: "metrics:write", limit: 600 },
);
