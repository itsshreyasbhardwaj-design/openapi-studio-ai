"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  GitCompareArrows,
  History,
  Loader2,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import type { SpecVersion } from "@/lib/domain/types";
import type { Change, DiffResult } from "@/lib/core/openapi/diff";
import { studioApi } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

type VersionSummary = SpecVersion & { sizeBytes: number };

const IMPACT_TONE = {
  major: "danger",
  minor: "warn",
  patch: "info",
  none: "neutral",
} as const;

export function VersionsView({
  specId,
  versions: initialVersions,
}: {
  specId: string;
  versions: VersionSummary[];
}) {
  const router = useRouter();
  const [versions, setVersions] = React.useState(initialVersions);
  const [base, setBase] = React.useState<string | null>(initialVersions[1]?.id ?? null);
  const [head, setHead] = React.useState<string | null>(initialVersions[0]?.id ?? null);
  const [diff, setDiff] = React.useState<(DiffResult & { suggestedVersion: string }) | null>(null);
  const [busy, setBusy] = React.useState(false);

  const compare = React.useCallback(async () => {
    if (!base || !head || base === head) {
      setDiff(null);
      return;
    }
    setBusy(true);
    try {
      const result = await studioApi.diff({ specId, beforeVersionId: base, afterVersionId: head });
      setDiff(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not compute the diff.");
    } finally {
      setBusy(false);
    }
  }, [base, head, specId]);

  React.useEffect(() => {
    void compare();
  }, [compare]);

  const act = async (versionId: string, action: "rollback" | "publish"): Promise<void> => {
    setBusy(true);
    try {
      await studioApi.versionAction(specId, versionId, action);
      const refreshed = await studioApi.listVersions(specId);
      setVersions(refreshed.versions);
      toast.success(
        action === "rollback" ? "Rolled back — a new version was appended." : "Version published.",
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  };

  if (versions.length === 0) {
    return (
      <Panel className="m-6">
        <EmptyState
          icon={<History />}
          title="No versions yet"
          description="Save a version in the designer to start tracking history."
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <Panel className="h-fit">
        <PanelHeader>
          <PanelTitle>History</PanelTitle>
          <Badge tone="neutral">{versions.length}</Badge>
        </PanelHeader>
        <ul className="divide-line/70 max-h-[32rem] divide-y overflow-y-auto">
          {versions.map((version, index) => (
            <li key={version.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <code className="text-ink font-mono text-xs font-semibold">v{version.label}</code>
                {index === 0 ? <Badge tone="accent">current</Badge> : null}
                <Badge tone={version.status === "published" ? "ok" : "neutral"}>
                  {version.status}
                </Badge>
                <span className="text-ink-subtle ml-auto font-mono text-[10px]">
                  {(version.sizeBytes / 1024).toFixed(1)}KB
                </span>
              </div>
              <p className="text-ink-muted mt-1 line-clamp-2 text-[11px] leading-relaxed">
                {version.message}
              </p>
              <p className="text-ink-subtle mt-1 text-[10px]">
                {new Date(version.createdAt).toLocaleString()} · {version.hash.slice(0, 10)}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setBase(version.id)}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] transition-colors",
                    base === version.id
                      ? "border-accent/60 bg-accent/12 text-accent-soft"
                      : "border-line text-ink-subtle hover:text-ink",
                  )}
                >
                  base
                </button>
                <button
                  type="button"
                  onClick={() => setHead(version.id)}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] transition-colors",
                    head === version.id
                      ? "border-cyan/60 bg-cyan/12 text-cyan"
                      : "border-line text-ink-subtle hover:text-ink",
                  )}
                >
                  compare
                </button>
                {index !== 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-1.5 text-[10px]"
                    disabled={busy}
                    onClick={() => void act(version.id, "rollback")}
                  >
                    <RotateCcw className="size-3" />
                    Restore
                  </Button>
                ) : version.status !== "published" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-1.5 text-[10px]"
                    disabled={busy}
                    onClick={() => void act(version.id, "publish")}
                  >
                    <UploadCloud className="size-3" />
                    Publish
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="space-y-4">
        <Panel>
          <PanelHeader>
            <PanelTitle className="flex items-center gap-2">
              <GitCompareArrows className="text-accent-soft size-4" />
              Semantic diff
            </PanelTitle>
            <div className="text-ink-subtle flex items-center gap-2 text-[11px]">
              <span className="font-mono">{labelFor(versions, base)}</span>
              <ArrowLeftRight className="size-3" />
              <span className="font-mono">{labelFor(versions, head)}</span>
            </div>
          </PanelHeader>
          <PanelBody>
            {busy ? (
              <p className="text-ink-subtle flex items-center gap-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Computing…
              </p>
            ) : !diff ? (
              <p className="text-ink-muted text-xs">Select two different versions to compare.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="Changes" value={diff.totalCount} />
                <Stat
                  label="Breaking"
                  value={diff.breakingCount}
                  tone={diff.breakingCount > 0 ? "danger" : "ok"}
                />
                <Stat label="Additive" value={diff.additiveCount} tone="accent" />
                <Stat
                  label="Next version"
                  value={diff.suggestedVersion}
                  hint={`${diff.impact} release`}
                />
              </div>
            )}
          </PanelBody>
        </Panel>

        {diff && diff.changes.length > 0 ? (
          <Panel>
            <PanelHeader>
              <PanelTitle>Changes</PanelTitle>
              <Badge tone={IMPACT_TONE[diff.impact]}>{diff.impact}</Badge>
            </PanelHeader>
            <ul className="divide-line/70 max-h-[28rem] divide-y overflow-y-auto">
              {diff.changes.map((change, index) => (
                <ChangeRow key={`${change.pointer}-${index}`} change={change} />
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function labelFor(versions: VersionSummary[], id: string | null): string {
  const version = versions.find((entry) => entry.id === id);
  return version ? `v${version.label}` : "—";
}

function ChangeRow({ change }: { change: Change }) {
  const tone =
    change.kind === "added" ? "text-mint" : change.kind === "removed" ? "text-rose" : "text-amber";
  const symbol = change.kind === "added" ? "+" : change.kind === "removed" ? "−" : "~";

  return (
    <li className="flex items-start gap-3 px-5 py-2.5">
      <span className={cn("mt-0.5 font-mono text-sm font-bold", tone)}>{symbol}</span>
      <div className="min-w-0 flex-1">
        <p className="text-ink text-xs leading-relaxed">{change.description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral" className="text-[10px]">
            {change.category}
          </Badge>
          {change.breaking ? <Badge tone="danger">breaking</Badge> : null}
        </div>
      </div>
    </li>
  );
}
