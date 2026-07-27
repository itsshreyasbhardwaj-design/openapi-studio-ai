"use client";

import * as React from "react";
import {
  CheckCircle2,
  FolderDown,
  Loader2,
  PlayCircle,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { ApiProject, RequestCollection, RequestDefinition, TestRun } from "@/lib/domain/types";
import { studioApi, type ProxyResponse } from "@/lib/client/api";
import { newId } from "@/lib/utils/id";
import { Badge, MethodBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { CopyButton, EmptyState } from "@/components/ui/misc";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils/cn";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function blankRequest(): RequestDefinition {
  return {
    id: newId("req"),
    name: "New request",
    protocol: "rest",
    method: "GET",
    url: "https://api.example.com/v1/health",
    headers: { accept: "application/json" },
    query: {},
    body: null,
    variables: null,
    auth: { type: "none" },
    assertions: [
      { id: "status", kind: "status", target: "", operator: "equals", expected: "200" },
      { id: "speed", kind: "responseTime", target: "", operator: "lessThan", expected: "2000" },
    ],
  };
}

/**
 * The API console: REST and GraphQL requests, collections, assertions and a
 * one-click suite runner. Requests execute server-side through the SSRF-guarded
 * proxy, which is also what the automated runs use — so an ad-hoc request and a
 * suite run behave identically.
 */
export function ApiClient({
  collections: initialCollections,
  specs,
}: {
  collections: RequestCollection[];
  specs: ApiProject[];
}) {
  const [collections, setCollections] = React.useState(initialCollections);
  const [activeCollection, setActiveCollection] = React.useState(initialCollections[0]?.id ?? null);
  const [request, setRequest] = React.useState<RequestDefinition>(
    initialCollections[0]?.requests[0] ?? blankRequest(),
  );
  const [response, setResponse] = React.useState<ProxyResponse | null>(null);
  const [run, setRun] = React.useState<TestRun | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [headerText, setHeaderText] = React.useState(() => toHeaderText(request.headers));

  const collection = collections.find((entry) => entry.id === activeCollection) ?? null;

  const select = (definition: RequestDefinition): void => {
    setRequest(definition);
    setHeaderText(toHeaderText(definition.headers));
    setResponse(null);
  };

  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      const headers = fromHeaderText(headerText);
      const isGraphql = request.protocol === "graphql";
      const body = isGraphql
        ? JSON.stringify({
            query: request.body ?? "",
            variables: request.variables ? safeJson(request.variables) : {},
          })
        : request.body;

      const result = await studioApi.proxy({
        method: isGraphql ? "POST" : request.method,
        url: request.url,
        headers: isGraphql ? { ...headers, "content-type": "application/json" } : headers,
        body,
        assertions: [...request.assertions],
      });
      setResponse(result);
      if (result.error) toast.error(result.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveToCollection = async (): Promise<void> => {
    setBusy(true);
    try {
      const target = collection;
      const requests = target
        ? target.requests.some((entry) => entry.id === request.id)
          ? target.requests.map((entry) =>
              entry.id === request.id ? { ...request, headers: fromHeaderText(headerText) } : entry,
            )
          : [...target.requests, { ...request, headers: fromHeaderText(headerText) }]
        : [{ ...request, headers: fromHeaderText(headerText) }];

      const saved = await studioApi.saveCollection({
        ...(target ? { id: target.id } : {}),
        name: target?.name ?? "My collection",
        description: target?.description ?? "",
        specId: target?.specId ?? null,
        requests,
      });

      setCollections((previous) => {
        const others = previous.filter((entry) => entry.id !== saved.collection.id);
        return [saved.collection, ...others];
      });
      setActiveCollection(saved.collection.id);
      toast.success("Saved to collection");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the request.");
    } finally {
      setBusy(false);
    }
  };

  const importSpec = async (specId: string): Promise<void> => {
    setBusy(true);
    try {
      const result = await studioApi.importCollection({ specId });
      setCollections((previous) => [result.collection, ...previous]);
      setActiveCollection(result.collection.id);
      if (result.collection.requests[0]) select(result.collection.requests[0]);
      toast.success(`Imported ${result.collection.requests.length} requests`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import the specification.");
    } finally {
      setBusy(false);
    }
  };

  const runSuite = async (): Promise<void> => {
    if (!collection) return;
    setBusy(true);
    try {
      const result = await studioApi.runCollection({ collectionId: collection.id });
      setRun(result.run);
      toast[result.run.failed === 0 ? "success" : "error"](
        `${result.run.passed} passed · ${result.run.failed} failed`,
        {
          description: `${result.stats.assertionsPassed} assertions passed in ${result.run.durationMs}ms`,
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The suite failed to run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-line grid min-h-0 flex-1 gap-px lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <div className="bg-canvas-raised/50 flex min-h-0 flex-col">
        <div className="border-line flex items-center gap-2 border-b px-3 py-2.5">
          <Select
            value={activeCollection ?? ""}
            onChange={(event) => {
              setActiveCollection(event.target.value || null);
              const next = collections.find((entry) => entry.id === event.target.value);
              if (next?.requests[0]) select(next.requests[0]);
            }}
            className="h-8 text-xs"
            aria-label="Active collection"
          >
            <option value="">No collection</option>
            {collections.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="border-line flex items-center gap-1 border-b px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => select(blankRequest())}>
            <Plus />
            New
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void runSuite()}
            disabled={!collection || busy}
          >
            <PlayCircle />
            Run all
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!collection || collection.requests.length === 0 ? (
            <EmptyState
              icon={<FolderDown />}
              title="No saved requests"
              description="Import an API to generate a runnable collection, or save the current request."
            />
          ) : (
            <ul className="space-y-0.5">
              {collection.requests.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => select(entry)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                      request.id === entry.id ? "bg-surface-strong" : "hover:bg-surface/60",
                    )}
                  >
                    <MethodBadge method={entry.method} />
                    <span className="text-ink-muted truncate text-xs">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {specs.length > 0 ? (
          <div className="border-line border-t p-3">
            <Field label="Import from API">
              <Select
                defaultValue=""
                onChange={(event) => event.target.value && void importSpec(event.target.value)}
                className="h-8 text-xs"
              >
                <option value="">Choose an API…</option>
                {specs.map((spec) => (
                  <option key={spec.id} value={spec.id}>
                    {spec.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
      </div>

      <div className="bg-canvas flex min-h-0 flex-col">
        <div className="border-line flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Select
            value={request.protocol}
            onChange={(event) =>
              setRequest({
                ...request,
                protocol: event.target.value as RequestDefinition["protocol"],
              })
            }
            className="h-9 w-28 text-xs"
            aria-label="Protocol"
          >
            <option value="rest">REST</option>
            <option value="graphql">GraphQL</option>
          </Select>

          {request.protocol === "rest" ? (
            <Select
              value={request.method}
              onChange={(event) =>
                setRequest({
                  ...request,
                  method: event.target.value as RequestDefinition["method"],
                })
              }
              className="h-9 w-28 font-mono text-xs"
              aria-label="HTTP method"
            >
              {METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </Select>
          ) : null}

          <Input
            value={request.url}
            onChange={(event) => setRequest({ ...request, url: event.target.value })}
            className="min-w-0 flex-1 font-mono text-xs"
            placeholder="https://api.example.com/v1/orders"
            aria-label="Request URL"
          />

          <Button variant="primary" onClick={() => void send()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            Send
          </Button>
          <Button variant="secondary" onClick={() => void saveToCollection()} disabled={busy}>
            Save
          </Button>
        </div>

        <div className="bg-line grid min-h-0 flex-1 grid-rows-2 gap-px xl:grid-cols-2 xl:grid-rows-1">
          <div className="bg-canvas min-h-0 overflow-y-auto p-4">
            <Tabs defaultValue="headers">
              <TabsList>
                <TabsTrigger value="headers">Headers</TabsTrigger>
                <TabsTrigger value="body">
                  {request.protocol === "graphql" ? "Query" : "Body"}
                </TabsTrigger>
                <TabsTrigger value="auth">Auth</TabsTrigger>
                <TabsTrigger value="assertions">Assertions</TabsTrigger>
              </TabsList>

              <TabsContent value="headers" className="mt-3">
                <Field label="Headers" hint="One per line, `name: value`.">
                  <Textarea
                    rows={8}
                    value={headerText}
                    onChange={(event) => setHeaderText(event.target.value)}
                    className="font-mono text-[11px]"
                  />
                </Field>
              </TabsContent>

              <TabsContent value="body" className="mt-3 space-y-3">
                <Field label={request.protocol === "graphql" ? "GraphQL document" : "Request body"}>
                  <Textarea
                    rows={10}
                    value={request.body ?? ""}
                    onChange={(event) =>
                      setRequest({ ...request, body: event.target.value || null })
                    }
                    className="font-mono text-[11px]"
                    placeholder={
                      request.protocol === "graphql"
                        ? "query Orders { orders { id status } }"
                        : "{\n  \n}"
                    }
                  />
                </Field>
                {request.protocol === "graphql" ? (
                  <Field label="Variables (JSON)">
                    <Textarea
                      rows={4}
                      value={request.variables ?? ""}
                      onChange={(event) =>
                        setRequest({ ...request, variables: event.target.value || null })
                      }
                      className="font-mono text-[11px]"
                    />
                  </Field>
                ) : null}
              </TabsContent>

              <TabsContent value="auth" className="mt-3 space-y-3">
                <Field label="Scheme">
                  <Select
                    value={request.auth.type}
                    onChange={(event) => {
                      const type = event.target.value as RequestDefinition["auth"]["type"];
                      setRequest({
                        ...request,
                        auth:
                          type === "bearer"
                            ? { type, token: "" }
                            : type === "basic"
                              ? { type, username: "", password: "" }
                              : type === "apiKey"
                                ? { type, name: "X-API-Key", in: "header", value: "" }
                                : { type: "none" },
                      });
                    }}
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="basic">Basic</option>
                    <option value="apiKey">API key</option>
                  </Select>
                </Field>
                {request.auth.type === "bearer" ? (
                  <Field label="Token" hint="Supports {{variables}} from the active environment.">
                    <Input
                      value={request.auth.token}
                      onChange={(event) =>
                        setRequest({
                          ...request,
                          auth: { type: "bearer", token: event.target.value },
                        })
                      }
                    />
                  </Field>
                ) : null}
              </TabsContent>

              <TabsContent value="assertions" className="mt-3">
                <ul className="space-y-2">
                  {request.assertions.map((assertion) => (
                    <li
                      key={assertion.id}
                      className="border-line flex items-center gap-2 rounded-lg border px-3 py-2"
                    >
                      <Badge tone="neutral" className="text-[10px]">
                        {assertion.kind}
                      </Badge>
                      <code className="text-ink-muted truncate font-mono text-[11px]">
                        {assertion.target || "—"} {assertion.operator} {assertion.expected}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
                        aria-label="Remove assertion"
                        onClick={() =>
                          setRequest({
                            ...request,
                            assertions: request.assertions.filter(
                              (item) => item.id !== assertion.id,
                            ),
                          })
                        }
                      >
                        <Trash2 className="text-rose" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    setRequest({
                      ...request,
                      assertions: [
                        ...request.assertions,
                        {
                          id: newId("asr"),
                          kind: "jsonPath",
                          target: "data.id",
                          operator: "exists",
                          expected: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus />
                  Add assertion
                </Button>
              </TabsContent>
            </Tabs>
          </div>

          <div className="bg-canvas min-h-0 overflow-y-auto p-4">
            {run ? (
              <Panel className="mb-4">
                <PanelHeader>
                  <PanelTitle>Suite run</PanelTitle>
                  <Badge tone={run.failed === 0 ? "ok" : "danger"}>
                    {run.passed}/{run.results.length} passed
                  </Badge>
                </PanelHeader>
                <ul className="divide-line/70 max-h-48 divide-y overflow-y-auto">
                  {run.results.map((result) => (
                    <li key={result.requestId} className="flex items-center gap-2 px-4 py-2">
                      {result.error || result.assertions.some((assertion) => !assertion.passed) ? (
                        <XCircle className="text-rose size-3.5 shrink-0" />
                      ) : (
                        <CheckCircle2 className="text-mint size-3.5 shrink-0" />
                      )}
                      <span className="text-ink-muted truncate text-xs">{result.name}</span>
                      <span className="text-ink-subtle ml-auto shrink-0 font-mono text-[10px]">
                        {result.durationMs}ms
                      </span>
                      <StatusBadge status={result.status} />
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {!response ? (
              <EmptyState
                icon={<Send />}
                title="No response yet"
                description="Send the request to inspect the status, headers, body and assertion results."
              />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={response.status} />
                  <span className="text-ink-muted text-xs">{response.statusText}</span>
                  <span className="text-ink-subtle font-mono text-[11px]">
                    {response.durationMs}ms
                  </span>
                  <span className="text-ink-subtle font-mono text-[11px]">
                    {response.sizeBytes}B
                  </span>
                  <CopyButton value={response.body} className="ml-auto" />
                </div>

                {response.assertions.length > 0 ? (
                  <ul className="space-y-1">
                    {response.assertions.map((assertion) => (
                      <li
                        key={assertion.assertionId}
                        className="flex items-start gap-2 text-[11px]"
                      >
                        {assertion.passed ? (
                          <CheckCircle2 className="text-mint mt-0.5 size-3 shrink-0" />
                        ) : (
                          <XCircle className="text-rose mt-0.5 size-3 shrink-0" />
                        )}
                        <span className={assertion.passed ? "text-ink-muted" : "text-rose"}>
                          {assertion.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <PanelBody className="border-line rounded-lg border p-0">
                  <pre className="text-ink-muted max-h-[22rem] overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed">
                    <code>{prettify(response.body)}</code>
                  </pre>
                </PanelBody>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function toHeaderText(headers: Readonly<Record<string, string>>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function fromHeaderText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function safeJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function prettify(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
