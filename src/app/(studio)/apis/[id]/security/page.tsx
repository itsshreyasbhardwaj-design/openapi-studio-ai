import { notFound } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { analyzeSource } from "@/lib/core/analysis";
import type { FindingSeverity } from "@/lib/core/security/rules";
import { describePointer } from "@/lib/core/openapi/pointer";
import { currentIdentity } from "@/lib/server/auth";
import { SpecService } from "@/lib/services/spec-service";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { EmptyState, Stat } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<FindingSeverity, "danger" | "warn" | "info" | "neutral"> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "info",
  info: "neutral",
};

export default async function SecurityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await currentIdentity();
  const { source } = await SpecService.sourceFor(identity, id);

  const analysis = analyzeSource(source);
  if (!analysis.ok) notFound();
  const report = analysis.value.security;

  return (
    <div className="space-y-6 p-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Security grade"
          value={report.grade}
          tone={
            report.grade === "A"
              ? "ok"
              : report.grade === "B"
                ? "accent"
                : report.grade === "C"
                  ? "warn"
                  : "danger"
          }
          hint={`${report.score}/100`}
        />
        <Stat
          label="Critical + high"
          value={report.summary.critical + report.summary.high}
          tone={report.summary.critical + report.summary.high === 0 ? "ok" : "danger"}
        />
        <Stat
          label="Medium"
          value={report.summary.medium}
          tone={report.summary.medium === 0 ? "ok" : "warn"}
        />
        <Stat label="Total findings" value={report.summary.total} />
      </div>

      {report.recommendations.length > 0 ? (
        <Panel>
          <PanelHeader>
            <PanelTitle>Priority remediation</PanelTitle>
            <Badge tone="accent">{report.recommendations.length} actions</Badge>
          </PanelHeader>
          <PanelBody>
            <ol className="space-y-2">
              {report.recommendations.map((recommendation, index) => (
                <li
                  key={recommendation}
                  className="text-ink-muted flex gap-3 text-sm leading-relaxed"
                >
                  <span className="text-accent-soft font-mono text-xs">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {recommendation}
                </li>
              ))}
            </ol>
          </PanelBody>
        </Panel>
      ) : null}

      {report.findings.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<ShieldCheck />}
            title="No security findings"
            description="Every rule in the OWASP API Security Top 10 rule set passed against this document."
          />
        </Panel>
      ) : (
        report.byCategory.map((group) => (
          <Panel key={group.category}>
            <PanelHeader>
              <PanelTitle>{group.category}</PanelTitle>
              <Badge tone="neutral">{group.findings.length}</Badge>
            </PanelHeader>
            <ul className="divide-line/70 divide-y">
              {group.findings.map((finding, index) => (
                <li key={`${finding.id}-${finding.pointer}-${index}`} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert className="text-ink-subtle size-4" />
                    <span className="text-ink text-sm font-medium">{finding.title}</span>
                    <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge>
                    <code className="text-ink-subtle ml-auto truncate font-mono text-[11px]">
                      {finding.subject}
                    </code>
                  </div>
                  <p className="text-ink-muted mt-2 text-xs leading-relaxed">{finding.detail}</p>
                  <p className="text-mint mt-1.5 text-xs leading-relaxed">
                    → {finding.recommendation}
                  </p>
                  <p className="text-ink-subtle mt-1.5 font-mono text-[10px]">
                    {describePointer(finding.pointer)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
