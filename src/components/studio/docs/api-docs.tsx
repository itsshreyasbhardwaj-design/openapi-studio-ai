"use client";

import * as React from "react";
import { ChevronDown, Lock, Play } from "lucide-react";
import { RefResolver } from "@/lib/core/openapi/deref";
import { exampleJson } from "@/lib/core/openapi/examples";
import { effectiveSecurity, groupByTag, listOperations } from "@/lib/core/openapi/navigate";
import type { MediaType, OpenApiDocument, OperationEntry, Schema } from "@/lib/core/openapi/types";
import { Badge, MethodBadge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/misc";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";
import { TryItConsole } from "./try-it";

export function ApiDocs({
  document,
  mockBaseUrl,
}: {
  document: OpenApiDocument;
  mockBaseUrl: string;
}) {
  const operations = React.useMemo(() => listOperations(document), [document]);
  const groups = React.useMemo(() => groupByTag(operations), [operations]);
  const [active, setActive] = React.useState<string | null>(null);

  const servers = document.servers ?? [];
  const schemes = Object.entries(document.components?.securitySchemes ?? {});

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav
        className="border-line/70 hidden border-r p-4 lg:block"
        aria-label="Documentation sections"
      >
        <div className="sticky top-4 space-y-5">
          <a
            href="#overview"
            className="text-ink hover:text-accent-soft block text-xs font-medium transition-colors"
          >
            Overview
          </a>
          <a
            href="#authentication"
            className="text-ink hover:text-accent-soft block text-xs font-medium transition-colors"
          >
            Authentication
          </a>
          {groups.map((group) => (
            <div key={group.tag}>
              <p className="text-ink-subtle mb-1.5 text-[11px] tracking-wider uppercase">
                {group.tag}
              </p>
              <ul className="space-y-0.5">
                {group.operations.map((entry) => (
                  <li key={`${entry.method}${entry.path}`}>
                    <a
                      href={`#${anchorFor(entry)}`}
                      className="text-ink-muted hover:bg-surface/60 hover:text-ink flex items-center gap-1.5 truncate rounded px-1 py-0.5 text-[11px] transition-colors"
                    >
                      <span className="text-ink-subtle font-mono text-[9px] uppercase">
                        {entry.method}
                      </span>
                      <span className="truncate">{entry.operation.summary ?? entry.path}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 space-y-8 p-6">
        <section id="overview" className="scroll-mt-24">
          <h2 className="text-2xl font-semibold tracking-tight">
            {document.info?.title ?? "Untitled API"}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="accent">v{document.info?.version ?? "—"}</Badge>
            <Badge tone="neutral">OpenAPI {document.openapi ?? "3.1.0"}</Badge>
            <Badge tone="neutral">{operations.length} operations</Badge>
          </div>
          {document.info?.description ? (
            <div className="prose-invert text-ink-muted mt-4 max-w-3xl text-sm leading-relaxed whitespace-pre-wrap">
              {document.info.description}
            </div>
          ) : null}

          {servers.length > 0 ? (
            <div className="mt-5 space-y-2">
              <p className="text-ink-muted text-xs font-medium">Servers</p>
              {servers.map((server) => (
                <div
                  key={server.url}
                  className="border-line bg-canvas-raised/50 flex items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <code className="text-ink font-mono text-xs">{server.url}</code>
                  <span className="text-ink-subtle text-[11px]">{server.description ?? ""}</span>
                  <CopyButton value={server.url ?? ""} className="ml-auto" />
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section id="authentication" className="scroll-mt-24">
          <h3 className="text-lg font-semibold tracking-tight">Authentication</h3>
          {schemes.length === 0 ? (
            <p className="text-ink-muted mt-2 text-sm">This API declares no security schemes.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {schemes.map(([name, raw]) => {
                const scheme = raw as {
                  type?: string;
                  scheme?: string;
                  in?: string;
                  name?: string;
                  bearerFormat?: string;
                  description?: string;
                };
                return (
                  <Panel key={name} className="p-4">
                    <div className="flex items-center gap-2">
                      <Lock className="text-accent-soft size-3.5" />
                      <code className="text-ink font-mono text-xs">{name}</code>
                      <Badge tone="neutral" className="ml-auto">
                        {scheme.type}
                      </Badge>
                    </div>
                    <p className="text-ink-muted mt-2 text-[11px] leading-relaxed">
                      {scheme.description ?? "No description provided."}
                    </p>
                    <pre className="bg-canvas text-ink-muted mt-3 overflow-x-auto rounded-lg px-3 py-2 font-mono text-[11px]">
                      {authExample(scheme)}
                    </pre>
                  </Panel>
                );
              })}
            </div>
          )}
        </section>

        {groups.map((group) => (
          <section key={group.tag} className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight">{group.tag}</h3>
            {group.operations.map((entry) => (
              <OperationCard
                key={`${entry.method}${entry.path}`}
                entry={entry}
                document={document}
                mockBaseUrl={mockBaseUrl}
                expanded={active === anchorFor(entry)}
                onToggle={() => setActive(active === anchorFor(entry) ? null : anchorFor(entry))}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function anchorFor(entry: OperationEntry): string {
  return `${entry.method}-${entry.path.replace(/[^a-zA-Z0-9]+/g, "-")}`.toLowerCase();
}

function authExample(scheme: {
  type?: string;
  scheme?: string;
  in?: string;
  name?: string;
}): string {
  if (scheme.type === "http" && scheme.scheme === "basic")
    return "Authorization: Basic <base64(user:pass)>";
  if (scheme.type === "apiKey" && scheme.in === "query")
    return `?${scheme.name ?? "api_key"}=<your-key>`;
  if (scheme.type === "apiKey") return `${scheme.name ?? "X-API-Key"}: <your-key>`;
  return "Authorization: Bearer <token>";
}

function OperationCard({
  entry,
  document,
  mockBaseUrl,
  expanded,
  onToggle,
}: {
  entry: OperationEntry;
  document: OpenApiDocument;
  mockBaseUrl: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const resolver = React.useMemo(() => new RefResolver(document), [document]);
  const secured = effectiveSecurity(document, entry.operation).length > 0;

  const responses = Object.entries(entry.operation.responses ?? {});
  const successCode = responses.find(([code]) => code.startsWith("2"))?.[0] ?? "200";
  const successResponse = resolver.tryResolve<{
    content?: Record<string, MediaType>;
    description?: string;
  }>(entry.operation.responses?.[successCode]);
  const successMedia = Object.entries(successResponse?.content ?? {})[0];
  const successSchema = successMedia?.[1]?.schema
    ? (resolver.tryResolve<Schema>(successMedia[1].schema) ?? undefined)
    : undefined;

  const requestBody = entry.operation.requestBody
    ? resolver.tryResolve<{ content?: Record<string, MediaType>; required?: boolean }>(
        entry.operation.requestBody,
      )
    : null;
  const requestMedia = Object.entries(requestBody?.content ?? {})[0];
  const requestSchema = requestMedia?.[1]?.schema
    ? (resolver.tryResolve<Schema>(requestMedia[1].schema) ?? undefined)
    : undefined;

  return (
    <Panel id={anchorFor(entry)} className="scroll-mt-24 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="hover:bg-surface/40 flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors"
      >
        <MethodBadge method={entry.method} />
        <code className="text-ink truncate font-mono text-sm">{entry.path}</code>
        {secured ? <Lock className="text-ink-subtle size-3 shrink-0" /> : null}
        {entry.deprecated ? <Badge tone="warn">deprecated</Badge> : null}
        <span className="text-ink-muted ml-auto hidden truncate text-xs sm:inline">
          {entry.operation.summary ?? ""}
        </span>
        <ChevronDown
          className={cn(
            "text-ink-subtle size-4 shrink-0 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="border-line space-y-5 border-t px-5 py-5">
          {entry.operation.description ? (
            <p className="text-ink-muted text-sm leading-relaxed whitespace-pre-wrap">
              {entry.operation.description}
            </p>
          ) : null}

          {entry.parameters.length > 0 ? (
            <div>
              <p className="text-ink-muted mb-2 text-xs font-medium">Parameters</p>
              <div className="border-line overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-canvas-raised/60 text-ink-subtle text-[11px] tracking-wider uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">In</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-line/70 divide-y">
                    {entry.parameters.map((parameter) => {
                      const schema = parameter.schema
                        ? resolver.tryResolve<Schema>(parameter.schema)
                        : null;
                      return (
                        <tr key={`${parameter.in}-${parameter.name}`}>
                          <td className="text-ink px-3 py-2 font-mono">
                            {parameter.name}
                            {parameter.required ? <span className="text-rose"> *</span> : null}
                          </td>
                          <td className="text-ink-subtle px-3 py-2">{parameter.in}</td>
                          <td className="text-ink-muted px-3 py-2 font-mono">
                            {Array.isArray(schema?.type)
                              ? schema.type.join(" | ")
                              : (schema?.type ?? "string")}
                          </td>
                          <td className="text-ink-muted px-3 py-2">
                            {parameter.description ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {requestSchema ? (
            <ExampleBlock
              title={`Request body (${requestMedia?.[0] ?? "application/json"})`}
              code={exampleJson(requestSchema, document, { seed: `${entry.operationId}:req` })}
            />
          ) : null}

          <div>
            <p className="text-ink-muted mb-2 text-xs font-medium">Responses</p>
            <ul className="mb-3 space-y-1">
              {responses.map(([code, response]) => (
                <li key={code} className="flex items-start gap-3 text-xs">
                  <code
                    className={cn(
                      "w-10 shrink-0 font-mono font-semibold",
                      code.startsWith("2")
                        ? "text-mint"
                        : code.startsWith("4")
                          ? "text-amber"
                          : "text-rose",
                    )}
                  >
                    {code}
                  </code>
                  <span className="text-ink-muted">
                    {resolver.tryResolve<{ description?: string }>(response)?.description ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
            {successSchema ? (
              <ExampleBlock
                title={`${successCode} response`}
                code={exampleJson(successSchema, document, { seed: `${entry.operationId}:res` })}
              />
            ) : null}
          </div>

          <details className="border-line rounded-lg border">
            <summary className="text-ink-muted hover:text-ink cursor-pointer px-4 py-2.5 text-xs font-medium transition-colors">
              <Play className="mr-1.5 inline size-3" />
              Try it
            </summary>
            <div className="border-line border-t p-4">
              <TryItConsole entry={entry} document={document} mockBaseUrl={mockBaseUrl} />
            </div>
          </details>
        </div>
      ) : null}
    </Panel>
  );
}

function ExampleBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="border-line rounded-lg border">
      <div className="border-line flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-ink-subtle text-[11px]">{title}</span>
        <CopyButton value={code} />
      </div>
      <pre className="bg-canvas text-ink-muted max-h-72 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
