import type { Metadata } from "next";
import { DashboardView } from "@/components/studio/dashboard-view";
import { analyzeSource } from "@/lib/core/analysis";
import { currentIdentity } from "@/lib/server/auth";
import { capabilities } from "@/lib/server/env";
import { SpecService } from "@/lib/services/spec-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "APIs",
  description: "Every API you are designing, with live quality and security scores.",
};

export interface DashboardSpec {
  id: string;
  name: string;
  description: string;
  status: string;
  kind: string;
  updatedAt: string;
  versionLabel: string | null;
  operations: number;
  score: number | null;
  securityGrade: string | null;
  errors: number;
}

export default async function DashboardPage() {
  const identity = await currentIdentity();
  const specs = await SpecService.list(identity);

  const summaries: DashboardSpec[] = specs.map(({ project, version }) => {
    const analysis = version ? analyzeSource(version.document) : null;
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      kind: project.kind,
      updatedAt: project.updatedAt,
      versionLabel: version?.label ?? null,
      operations: analysis?.ok ? analysis.value.stats.operations : 0,
      score: analysis?.ok ? analysis.value.score : null,
      securityGrade: analysis?.ok ? analysis.value.security.grade : null,
      errors: analysis?.ok ? analysis.value.summary.errors : 0,
    };
  });

  return <DashboardView specs={summaries} capabilities={capabilities()} />;
}
