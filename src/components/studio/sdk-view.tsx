"use client";

import * as React from "react";
import { Download, FileCode2, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { SDK_LANGUAGES, type GeneratedFile, type SdkLanguage } from "@/lib/core/sdk/model";
import { studioApi } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton, EmptyState, Skeleton } from "@/components/ui/misc";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

interface GeneratedSdkResponse {
  language: SdkLanguage;
  entryPoint: string;
  installCommand: string;
  sizeBytes: number;
  files: GeneratedFile[];
}

export function SdkView({ specId }: { specId: string }) {
  const [language, setLanguage] = React.useState<SdkLanguage>("typescript");
  const [sdk, setSdk] = React.useState<GeneratedSdkResponse | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const generate = React.useCallback(
    async (target: SdkLanguage) => {
      setLoading(true);
      try {
        const result = await studioApi.generateSdk({ language: target, specId });
        setSdk(result);
        setSelected(result.entryPoint);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not generate the SDK.");
      } finally {
        setLoading(false);
      }
    },
    [specId],
  );

  React.useEffect(() => {
    void generate(language);
  }, [generate, language]);

  const file = sdk?.files.find((entry) => entry.path === selected) ?? sdk?.files[0];

  const downloadAll = (): void => {
    if (!sdk) return;
    // A single self-describing bundle avoids shipping a zip dependency; the
    // file boundaries are machine-parseable and obvious to a human reader.
    const bundle = sdk.files
      .map(
        (entry) =>
          `${"=".repeat(78)}\n== FILE: ${entry.path}\n${"=".repeat(78)}\n\n${entry.contents}`,
      )
      .join("\n\n");
    const blob = new Blob([bundle], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sdk.language}-sdk.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadFile = (): void => {
    if (!file) return;
    const blob = new Blob([file.contents], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.path.split("/").pop() ?? "file.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-2">
        {SDK_LANGUAGES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setLanguage(entry.id)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              language === entry.id
                ? "border-accent/60 bg-accent/12 text-accent-soft"
                : "border-line text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {entry.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {sdk ? (
            <>
              <Badge tone="neutral">{sdk.files.length} files</Badge>
              <Badge tone="neutral">{(sdk.sizeBytes / 1024).toFixed(1)} KB</Badge>
              <Button variant="secondary" size="sm" onClick={downloadAll}>
                <Download />
                Download bundle
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {sdk ? (
        <div className="border-line bg-canvas-raised/50 flex items-center gap-3 rounded-lg border px-4 py-2.5">
          <Package className="text-accent-soft size-4" />
          <code className="text-ink font-mono text-xs">{sdk.installCommand}</code>
          <CopyButton value={sdk.installCommand} className="ml-auto" />
        </div>
      ) : null}

      {loading && !sdk ? (
        <Skeleton className="h-96 w-full" />
      ) : !sdk ? (
        <Panel>
          <EmptyState
            icon={<FileCode2 />}
            title="No SDK generated"
            description="Pick a language to generate a production-ready client from the current specification."
          />
        </Panel>
      ) : (
        <div className="border-line bg-line grid gap-px overflow-hidden rounded-[var(--radius-panel)] border lg:grid-cols-[18rem_minmax(0,1fr)]">
          <ul className="bg-canvas-raised/60 max-h-[34rem] overflow-y-auto p-2">
            {sdk.files.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => setSelected(entry.path)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                    file?.path === entry.path
                      ? "bg-surface-strong text-ink"
                      : "text-ink-muted hover:bg-surface/60",
                  )}
                >
                  <FileCode2 className="text-ink-subtle size-3.5 shrink-0" />
                  <span className="truncate font-mono">{entry.path}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="bg-canvas flex min-h-0 flex-col">
            <PanelHeader className="border-b">
              <PanelTitle className="font-mono text-xs">{file?.path}</PanelTitle>
              <div className="flex items-center gap-1">
                <CopyButton value={file?.contents ?? ""} />
                <Button variant="ghost" size="sm" onClick={downloadFile}>
                  <Download />
                </Button>
              </div>
            </PanelHeader>
            <pre className="text-ink-muted max-h-[30rem] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
              <code>{file?.contents}</code>
            </pre>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-ink-subtle flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          Generating…
        </p>
      ) : null}
    </div>
  );
}
