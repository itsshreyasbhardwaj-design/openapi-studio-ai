"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Code2,
  Download,
  FileJson,
  FileText,
  Loader2,
  Save,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import type { SpecFormat, SpecVersion } from "@/lib/domain/types";
import type { AnalysisResponse } from "@/lib/client/api";
import { studioApi } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { VisualEditor } from "./visual-editor";
import { cn } from "@/lib/utils/cn";

const CodeEditor = dynamic(() => import("./code-editor").then((module) => module.CodeEditor), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

const ANALYZE_DEBOUNCE_MS = 500;

export function Designer({
  specId,
  version,
  initialAnalysis,
}: {
  specId: string;
  version: SpecVersion;
  initialAnalysis: AnalysisResponse;
}) {
  const router = useRouter();
  const [source, setSource] = React.useState(version.document);
  const [format, setFormat] = React.useState<SpecFormat>(version.format);
  const [analysis, setAnalysis] = React.useState<AnalysisResponse>(initialAnalysis);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [improving, setImproving] = React.useState(false);
  const [view, setView] = React.useState("visual");

  const dirty = source !== version.document;
  const savedRef = React.useRef(version.document);

  // Re-analyse on a trailing debounce; an in-flight request is superseded by
  // the next edit rather than racing it into state.
  React.useEffect(() => {
    if (source === savedRef.current && analysis === initialAnalysis) return;
    let cancelled = false;
    setAnalyzing(true);

    const timer = setTimeout(() => {
      studioApi
        .analyze(source)
        .then((result) => {
          if (!cancelled) {
            setAnalysis(result);
            setFormat(result.format);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled && error instanceof Error) {
            setAnalysis((previous) => ({ ...previous, valid: false }));
          }
        })
        .finally(() => {
          if (!cancelled) setAnalyzing(false);
        });
    }, ANALYZE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `analysis` is intentionally excluded: including it would re-trigger on
    // every successful analysis and loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, initialAnalysis]);

  const save = async (publish: boolean): Promise<void> => {
    setSaving(true);
    try {
      const result = await studioApi.saveVersion(specId, {
        source,
        publish,
        ...(publish ? { message: "Published" } : {}),
      });
      savedRef.current = source;
      toast.success(`Saved v${result.version.label}`, {
        description: result.diff ? result.diff.summary : "First version recorded.",
      });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this version.");
    } finally {
      setSaving(false);
    }
  };

  const improve = async (mode: "auto" | "ai"): Promise<void> => {
    setImproving(true);
    try {
      const result = await studioApi.improve({ source, mode });
      setSource(result.source);
      toast.success(`Score ${result.scoreBefore} → ${result.scoreAfter}`, {
        description:
          result.applied.slice(0, 3).join(" · ") || "No machine-applicable fixes were available.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not improve the document.");
    } finally {
      setImproving(false);
    }
  };

  const convert = async (): Promise<void> => {
    const next: SpecFormat = format === "yaml" ? "json" : "yaml";
    const { convertFormat } = await import("@/lib/core/openapi/document");
    const converted = convertFormat(source, next);
    if (!converted.ok) {
      toast.error(`Cannot convert: ${converted.error.message}`);
      return;
    }
    setSource(converted.value);
    setFormat(next);
    toast.success(`Converted to ${next.toUpperCase()}`);
  };

  const download = (): void => {
    const blob = new Blob([source], { type: format === "json" ? "application/json" : "text/yaml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `openapi.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line/70 flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <ScorePill label="Quality" value={analysis.score} suffix="/100" />
        <ScorePill label="Security" value={analysis.security.grade} />
        <Badge tone={analysis.valid ? "ok" : "danger"}>
          {analysis.valid ? "Valid" : `${analysis.summary.errors} errors`}
        </Badge>
        <Badge tone="neutral">{analysis.stats.operations} operations</Badge>
        <Badge tone="neutral">{analysis.documentationCoverage}% documented</Badge>
        {analyzing ? (
          <span className="text-ink-subtle flex items-center gap-1.5 text-[11px]">
            <Loader2 className="size-3 animate-spin" /> analysing
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void convert()}>
            {format === "yaml" ? <FileJson /> : <FileText />}
            {format === "yaml" ? "To JSON" : "To YAML"}
          </Button>
          <Button variant="ghost" size="sm" onClick={download}>
            <Download />
            Export
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void improve("auto")}
            disabled={improving}
          >
            {improving ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Improve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void save(true)}
            disabled={saving || !analysis.valid}
          >
            <UploadCloud />
            Publish
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save(false)}
            disabled={saving || !dirty}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save version
          </Button>
        </div>
      </div>

      <div className="bg-line grid min-h-0 flex-1 grid-cols-1 gap-px xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="bg-canvas flex min-h-0 flex-col">
          <Tabs value={view} onValueChange={setView} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-3 px-4 py-2.5">
              <TabsList>
                <TabsTrigger value="visual">
                  <FileText className="size-3.5" />
                  Visual
                </TabsTrigger>
                <TabsTrigger value="code">
                  <Code2 className="size-3.5" />
                  {format.toUpperCase()}
                </TabsTrigger>
              </TabsList>
              {dirty ? (
                <span className="text-amber text-[11px]">Unsaved changes</span>
              ) : (
                <span className="text-ink-subtle text-[11px]">v{version.label}</span>
              )}
            </div>

            <TabsContent value="visual" className="min-h-0 flex-1 data-[state=inactive]:hidden">
              <VisualEditor document={analysis.document} format={format} onChange={setSource} />
            </TabsContent>

            <TabsContent value="code" className="min-h-0 flex-1 data-[state=inactive]:hidden">
              <CodeEditor
                value={source}
                language={format}
                onChange={setSource}
                diagnostics={analysis.diagnostics}
              />
            </TabsContent>
          </Tabs>
        </div>

        <Panel className="bg-canvas-raised/60 min-h-0 rounded-none border-0">
          <DiagnosticsPanel
            diagnostics={analysis.diagnostics}
            fixable={analysis.fixable}
            busy={improving}
            onApplyFix={() => void improve("auto")}
          />
        </Panel>
      </div>
    </div>
  );
}

function ScorePill({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  const numeric =
    typeof value === "number"
      ? value
      : value === "A"
        ? 95
        : value === "B"
          ? 82
          : value === "C"
            ? 68
            : 40;
  const tone = numeric >= 85 ? "text-mint" : numeric >= 65 ? "text-amber" : "text-rose";
  return (
    <span className="border-line bg-canvas-raised/60 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1">
      <span className="text-ink-subtle text-[10px] tracking-wider uppercase">{label}</span>
      <span className={cn("font-mono text-xs font-semibold", tone)}>
        {value}
        {suffix}
      </span>
    </span>
  );
}
