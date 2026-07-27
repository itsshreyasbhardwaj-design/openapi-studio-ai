"use client";

import * as React from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { Diagnostic } from "@/lib/core/openapi/diagnostics";
import { Skeleton } from "@/components/ui/misc";

/**
 * Monaco wrapper tuned for specification editing.
 *
 * Diagnostics are pushed in as markers keyed by the *text* of the pointer's
 * last token, which is a pragmatic way to anchor JSON-Pointer findings to YAML
 * lines without maintaining a full source map.
 */
export function CodeEditor({
  value,
  language,
  onChange,
  diagnostics = [],
  readOnly = false,
  height = "100%",
}: {
  value: string;
  language: "yaml" | "json";
  onChange?: (value: string) => void;
  diagnostics?: readonly Diagnostic[];
  readOnly?: boolean;
  height?: string;
}) {
  const editorRef = React.useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = React.useRef<Parameters<OnMount>[1] | null>(null);

  const applyMarkers = React.useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const lines = model.getLinesContent();
    const markers = diagnostics.slice(0, 250).flatMap((diagnostic) => {
      const tokens = diagnostic.pointer.split("/").filter(Boolean);
      const needle = tokens[tokens.length - 1]?.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!needle) return [];

      const lineIndex = lines.findIndex(
        (line) => line.includes(`${needle}:`) || line.includes(`"${needle}"`),
      );
      if (lineIndex < 0) return [];

      return [
        {
          startLineNumber: lineIndex + 1,
          startColumn: 1,
          endLineNumber: lineIndex + 1,
          endColumn: (lines[lineIndex]?.length ?? 0) + 1,
          message: diagnostic.hint
            ? `${diagnostic.message}\n\n→ ${diagnostic.hint}`
            : diagnostic.message,
          severity:
            diagnostic.severity === "error"
              ? monaco.MarkerSeverity.Error
              : diagnostic.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
          source: diagnostic.rule,
        },
      ];
    });

    monaco.editor.setModelMarkers(model, "openapi-studio", markers);
  }, [diagnostics]);

  React.useEffect(() => {
    applyMarkers();
  }, [applyMarkers, value]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme("studio-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "string", foreground: "9ae6c4" },
        { token: "type", foreground: "a79bff" },
        { token: "keyword", foreground: "35d6f5" },
        { token: "comment", foreground: "6b748c", fontStyle: "italic" },
        { token: "number", foreground: "ffb84d" },
      ],
      colors: {
        "editor.background": "#00000000",
        "editor.foreground": "#eef1f8",
        "editorLineNumber.foreground": "#3b4359",
        "editorLineNumber.activeForeground": "#9aa3b8",
        "editor.selectionBackground": "#7c6cff40",
        "editor.lineHighlightBackground": "#ffffff08",
        "editorCursor.foreground": "#a79bff",
        "editorIndentGuide.background1": "#1e2230",
      },
    });
    monaco.editor.setTheme("studio-dark");
    applyMarkers();
  };

  return (
    <Editor
      height={height}
      language={language}
      value={value}
      onChange={(next) => onChange?.(next ?? "")}
      onMount={handleMount}
      loading={<Skeleton className="h-full w-full" />}
      options={{
        readOnly,
        fontSize: 12.5,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        padding: { top: 14, bottom: 14 },
        lineNumbersMinChars: 3,
        renderLineHighlight: "line",
        tabSize: 2,
        wordWrap: "on",
        automaticLayout: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        bracketPairColorization: { enabled: true },
        stickyScroll: { enabled: true },
      }}
    />
  );
}
