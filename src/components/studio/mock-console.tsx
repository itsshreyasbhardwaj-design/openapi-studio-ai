"use client";

import * as React from "react";
import { Loader2, Play, Server } from "lucide-react";
import type { OperationEntry } from "@/lib/core/openapi/types";
import { examplePathFor } from "@/lib/core/mock/match";
import { Badge, MethodBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { CopyButton, Switch } from "@/components/ui/misc";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

export interface MockOperationSummary {
  method: string;
  path: string;
  operationId: string;
  summary: string;
  examplePath: string;
  secured: boolean;
  statuses: string[];
}

interface MockResult {
  status: number;
  durationMs: number;
  body: string;
  explanation: string;
  headers: Record<string, string>;
}

/**
 * Control surface for the mock server.
 *
 * Every knob maps to a `__mock_*` query parameter, so whatever the console can
 * do, a client integration can do too — just by changing the URL.
 */
export function MockConsole({
  operations,
  mockBaseUrl,
}: {
  operations: MockOperationSummary[];
  mockBaseUrl: string;
}) {
  const [selected, setSelected] = React.useState(0);
  const [scenario, setScenario] = React.useState("success");
  const [status, setStatus] = React.useState("");
  const [delay, setDelay] = React.useState(0);
  const [enforceAuth, setEnforceAuth] = React.useState(true);
  const [token, setToken] = React.useState("demo-token");
  const [result, setResult] = React.useState<MockResult | null>(null);
  const [busy, setBusy] = React.useState(false);

  const operation = operations[selected];

  const url = React.useMemo(() => {
    if (!operation) return mockBaseUrl;
    const search = new URLSearchParams();
    if (scenario !== "success") search.set("__mock_scenario", scenario);
    if (status) search.set("__mock_status", status);
    if (delay > 0) search.set("__mock_delay", String(delay));
    if (!enforceAuth) search.set("__mock_auth", "off");
    const query = search.toString();
    return `${mockBaseUrl}${operation.examplePath}${query ? `?${query}` : ""}`;
  }, [delay, enforceAuth, mockBaseUrl, operation, scenario, status]);

  const send = async (): Promise<void> => {
    if (!operation) return;
    setBusy(true);
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: operation.method.toUpperCase(),
        headers: {
          accept: "application/json",
          ...(token && enforceAuth ? { authorization: `Bearer ${token}` } : {}),
          ...(["post", "put", "patch"].includes(operation.method)
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(["post", "put", "patch"].includes(operation.method) ? { body: "{}" } : {}),
      });
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      setResult({
        status: response.status,
        durationMs: Math.round(performance.now() - started),
        body,
        explanation: headers["x-mock-explanation"] ?? "",
        headers,
      });
    } catch (error) {
      setResult({
        status: 0,
        durationMs: Math.round(performance.now() - started),
        body: error instanceof Error ? error.message : String(error),
        explanation: "The request failed before reaching the mock server.",
        headers: {},
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Panel>
          <PanelHeader>
            <PanelTitle>Mock endpoint</PanelTitle>
            <Badge tone="ok">live</Badge>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <div className="border-line bg-canvas flex items-center gap-2 rounded-lg border px-3 py-2">
              <Server className="text-accent-soft size-3.5 shrink-0" />
              <code className="text-ink truncate font-mono text-[11px]">{mockBaseUrl}</code>
              <CopyButton value={mockBaseUrl} className="ml-auto" />
            </div>
            <p className="text-ink-muted text-[11px] leading-relaxed">
              Point any client at this base URL. Behaviour is controlled per request with{" "}
              <code className="text-ink font-mono">__mock_scenario</code>,{" "}
              <code className="text-ink font-mono">__mock_status</code>,{" "}
              <code className="text-ink font-mono">__mock_delay</code> and{" "}
              <code className="text-ink font-mono">__mock_auth</code>.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Behaviour</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <Field label="Scenario">
              <Select value={scenario} onChange={(event) => setScenario(event.target.value)}>
                <option value="success">Success — first documented 2xx</option>
                <option value="error">Error — a documented failure</option>
                <option value="random">Random — mostly success, some failures</option>
              </Select>
            </Field>
            <Field label="Force status" hint="Must be a status the operation documents.">
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Automatic</option>
                {(operation?.statuses ?? []).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Latency: ${delay}ms`}>
              <input
                type="range"
                min={0}
                max={3000}
                step={50}
                value={delay}
                onChange={(event) => setDelay(Number(event.target.value))}
                className="w-full accent-[var(--color-accent)]"
                aria-label="Simulated latency"
              />
            </Field>
            <Switch
              checked={enforceAuth}
              onCheckedChange={setEnforceAuth}
              label="Enforce authentication"
            />
            {enforceAuth ? (
              <Field label="Bearer token">
                <Input value={token} onChange={(event) => setToken(event.target.value)} />
              </Field>
            ) : null}
          </PanelBody>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel>
          <PanelHeader>
            <PanelTitle>Operations</PanelTitle>
            <Badge tone="neutral">{operations.length}</Badge>
          </PanelHeader>
          <ul className="max-h-64 overflow-y-auto p-2">
            {operations.map((entry, index) => (
              <li key={`${entry.method}${entry.path}`}>
                <button
                  type="button"
                  onClick={() => setSelected(index)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                    selected === index ? "bg-surface-strong" : "hover:bg-surface/60",
                  )}
                >
                  <MethodBadge method={entry.method} />
                  <code className="text-ink truncate font-mono text-xs">{entry.path}</code>
                  <span className="text-ink-subtle ml-auto hidden truncate text-[11px] sm:inline">
                    {entry.summary}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Request</PanelTitle>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void send()}
              disabled={busy || !operation}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Play />}
              Send
            </Button>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <div className="border-line bg-canvas flex items-center gap-2 rounded-lg border px-3 py-2">
              {operation ? <MethodBadge method={operation.method} /> : null}
              <code className="text-ink-muted truncate font-mono text-[11px]">{url}</code>
              <CopyButton value={url} className="ml-auto" />
            </div>

            {result ? (
              <div className="border-line rounded-lg border">
                <div className="border-line flex flex-wrap items-center gap-3 border-b px-3 py-2">
                  <StatusBadge status={result.status} />
                  <span className="text-ink-subtle font-mono text-[11px]">
                    {result.durationMs}ms
                  </span>
                  {result.explanation ? (
                    <span className="text-ink-muted truncate text-[11px]">
                      {result.explanation}
                    </span>
                  ) : null}
                  <CopyButton value={result.body} className="ml-auto" />
                </div>
                <pre className="bg-canvas text-ink-muted max-h-80 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed">
                  <code>{prettify(result.body)}</code>
                </pre>
              </div>
            ) : (
              <p className="border-line text-ink-subtle rounded-lg border border-dashed px-3 py-6 text-center text-xs">
                Send a request to see the mocked response.
              </p>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function prettify(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** Build the console's operation list from the parsed document. */
export function toMockSummaries(entries: readonly OperationEntry[]): MockOperationSummary[] {
  return entries
    .filter((entry) => entry.kind === "path")
    .map((entry) => ({
      method: entry.method,
      path: entry.path,
      operationId: entry.operationId,
      summary: entry.operation.summary ?? "",
      examplePath: examplePathFor(entry),
      secured: (entry.operation.security ?? []).length > 0,
      statuses: Object.keys(entry.operation.responses ?? {}),
    }));
}
