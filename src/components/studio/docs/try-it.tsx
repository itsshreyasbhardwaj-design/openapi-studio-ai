"use client";

import * as React from "react";
import { Loader2, Send } from "lucide-react";
import { RefResolver } from "@/lib/core/openapi/deref";
import { exampleForParameter, exampleJson } from "@/lib/core/openapi/examples";
import type { MediaType, OpenApiDocument, OperationEntry, Schema } from "@/lib/core/openapi/types";
import { effectiveSecurity } from "@/lib/core/openapi/navigate";
import { studioApi, type ProxyResponse } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/misc";

/**
 * Interactive request console rendered under every documented operation.
 *
 * Requests are executed through the server proxy (never the browser) so CORS is
 * a non-issue and the SSRF policy applies uniformly.
 */
export function TryItConsole({
  entry,
  document,
  mockBaseUrl,
}: {
  entry: OperationEntry;
  document: OpenApiDocument;
  mockBaseUrl: string;
}) {
  const resolver = React.useMemo(() => new RefResolver(document), [document]);
  const servers = React.useMemo(
    () => [
      { url: mockBaseUrl, label: "Mock server (this workspace)" },
      ...(document.servers ?? []).map((server) => ({
        url: server.url ?? "",
        label: server.description ?? server.url ?? "",
      })),
    ],
    [document.servers, mockBaseUrl],
  );

  const [baseUrl, setBaseUrl] = React.useState(servers[0]?.url ?? "");
  const [token, setToken] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const parameter of entry.parameters) {
      if (!parameter.name) continue;
      const schema = parameter.schema
        ? (resolver.tryResolve<Schema>(parameter.schema) ?? undefined)
        : undefined;
      initial[parameter.name] = parameter.required
        ? exampleForParameter(schema, parameter.name, document, entry.operationId)
        : "";
    }
    return initial;
  });

  const [body, setBody] = React.useState(() => {
    if (!entry.operation.requestBody) return "";
    const resolved = resolver.tryResolve<{ content?: Record<string, MediaType> }>(
      entry.operation.requestBody,
    );
    const media = Object.values(resolved?.content ?? {})[0];
    const schema = media?.schema
      ? (resolver.tryResolve<Schema>(media.schema) ?? undefined)
      : undefined;
    return schema ? exampleJson(schema, document, { seed: `${entry.operationId}:try` }) : "";
  });

  const [response, setResponse] = React.useState<ProxyResponse | null>(null);
  const [sending, setSending] = React.useState(false);

  const secured = effectiveSecurity(document, entry.operation).length > 0;

  const send = async (): Promise<void> => {
    setSending(true);
    try {
      let path = entry.path;
      const query = new URLSearchParams();
      const headers: Record<string, string> = { accept: "application/json" };

      for (const parameter of entry.parameters) {
        const value = values[parameter.name ?? ""];
        if (!value) continue;
        if (parameter.in === "path")
          path = path.replace(`{${parameter.name}}`, encodeURIComponent(value));
        else if (parameter.in === "query") query.set(parameter.name ?? "", value);
        else if (parameter.in === "header") headers[(parameter.name ?? "").toLowerCase()] = value;
      }

      if (token) headers.authorization = `Bearer ${token}`;
      if (body.trim()) headers["content-type"] = "application/json";

      const search = query.toString();
      const url = `${baseUrl.replace(/\/$/, "")}${path}${search ? `?${search}` : ""}`;

      const result = await studioApi.proxy({
        method: entry.method.toUpperCase(),
        url,
        headers,
        body: body.trim() ? body : null,
      });
      setResponse(result);
    } catch (error) {
      setResponse({
        status: 0,
        statusText: "Failed",
        headers: {},
        body: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        sizeBytes: 0,
        truncated: false,
        assertions: [],
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Server">
          <Select value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)}>
            {servers.map((server) => (
              <option key={server.url} value={server.url}>
                {server.label}
              </option>
            ))}
          </Select>
        </Field>
        {secured ? (
          <Field label="Bearer token" hint="Sent as Authorization: Bearer …">
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="paste a token"
            />
          </Field>
        ) : null}
      </div>

      {entry.parameters.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {entry.parameters.map((parameter) => (
            <Field
              key={`${parameter.in}-${parameter.name}`}
              label={`${parameter.name}${parameter.required ? " *" : ""} (${parameter.in})`}
            >
              <Input
                value={values[parameter.name ?? ""] ?? ""}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    [parameter.name ?? ""]: event.target.value,
                  }))
                }
                placeholder={parameter.description ?? ""}
              />
            </Field>
          ))}
        </div>
      ) : null}

      {entry.operation.requestBody ? (
        <Field label="Request body">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            className="font-mono text-[11px]"
          />
        </Field>
      ) : null}

      <Button variant="primary" size="sm" onClick={() => void send()} disabled={sending}>
        {sending ? <Loader2 className="animate-spin" /> : <Send />}
        Send request
      </Button>

      {response ? (
        <div className="border-line rounded-lg border">
          <div className="border-line flex flex-wrap items-center gap-3 border-b px-3 py-2">
            <StatusBadge status={response.status} />
            <span className="text-ink-muted text-[11px]">{response.statusText}</span>
            <span className="text-ink-subtle font-mono text-[11px]">{response.durationMs}ms</span>
            <span className="text-ink-subtle font-mono text-[11px]">{response.sizeBytes}B</span>
            <CopyButton value={response.body} className="ml-auto" />
          </div>
          {response.error ? (
            <p className="text-rose px-3 py-2 text-xs">{response.error}</p>
          ) : (
            <pre className="bg-canvas text-ink-muted max-h-80 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed">
              <code>{formatBody(response.body)}</code>
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
