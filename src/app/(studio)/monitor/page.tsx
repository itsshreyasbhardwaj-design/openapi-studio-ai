import type { Metadata } from "next";
import { MonitorView } from "@/components/studio/monitor-view";
import { buildOverview } from "@/lib/core/telemetry/metrics";
import { getRepository } from "@/lib/repository";
import { currentIdentity } from "@/lib/server/auth";
import { SpecService } from "@/lib/services/spec-service";

export const dynamic = "force-dynamic";

/** Kept out of the render path: the clock is impure. */
async function twentyFourHoursAgo(): Promise<string> {
  return new Date(Date.now() - 86_400_000).toISOString();
}

export const metadata: Metadata = {
  title: "Monitoring",
  description: "Latency, error rate, availability and endpoint popularity across your APIs.",
};

export default async function MonitorPage() {
  const identity = await currentIdentity();
  const [specs, repository] = await Promise.all([SpecService.list(identity), getRepository()]);

  const samples = await repository.listMetrics(null, await twentyFourHoursAgo());

  return (
    <MonitorView
      specs={specs.map((entry) => entry.project)}
      initialOverview={buildOverview(samples, { bucketMs: 3_600_000 })}
    />
  );
}
