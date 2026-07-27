"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, Wand2, XCircle } from "lucide-react";
import type { Diagnostic } from "@/lib/core/openapi/diagnostics";
import { describePointer } from "@/lib/core/openapi/pointer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";

const ICONS = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const TONE = {
  error: "text-rose",
  warning: "text-amber",
  info: "text-cyan",
} as const;

export function DiagnosticsPanel({
  diagnostics,
  onApplyFix,
  fixable,
  busy,
}: {
  diagnostics: readonly Diagnostic[];
  onApplyFix: () => void;
  fixable: number;
  busy: boolean;
}) {
  const [filter, setFilter] = React.useState<"all" | "structure" | "quality" | "security">("all");

  const counts = React.useMemo(
    () => ({
      all: diagnostics.length,
      structure: diagnostics.filter((item) => item.source === "structure").length,
      quality: diagnostics.filter((item) => item.source === "quality").length,
      security: diagnostics.filter((item) => item.source === "security").length,
    }),
    [diagnostics],
  );

  const visible =
    filter === "all" ? diagnostics : diagnostics.filter((item) => item.source === filter);

  return (
    <div className="flex h-full flex-col">
      <div className="border-line flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        {(["all", "structure", "quality", "security"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors",
              filter === key ? "bg-surface-strong text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {key} <span className="text-ink-subtle font-mono">{counts[key]}</span>
          </button>
        ))}
        {fixable > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={onApplyFix}
            disabled={busy}
          >
            <Wand2 />
            Fix {fixable} automatically
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 />}
            title="Nothing to report"
            description={
              filter === "all"
                ? "This document passes structural validation, the quality linter and the security analyser."
                : `No ${filter} findings for this document.`
            }
          />
        ) : (
          <ul className="divide-line/70 divide-y">
            {visible.map((diagnostic, index) => {
              const Icon =
                diagnostic.source === "security" ? ShieldAlert : ICONS[diagnostic.severity];
              return (
                <li key={`${diagnostic.rule}-${diagnostic.pointer}-${index}`} className="px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[diagnostic.severity])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-ink text-xs leading-relaxed">{diagnostic.message}</p>
                      {diagnostic.hint ? (
                        <p className="text-ink-muted mt-1 text-[11px] leading-relaxed">
                          → {diagnostic.hint}
                        </p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral" className="font-mono text-[10px]">
                          {diagnostic.rule}
                        </Badge>
                        <span className="text-ink-subtle truncate font-mono text-[10px]">
                          {describePointer(diagnostic.pointer)}
                        </span>
                        {diagnostic.fix ? (
                          <Badge tone="accent" className="text-[10px]">
                            auto-fixable
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
