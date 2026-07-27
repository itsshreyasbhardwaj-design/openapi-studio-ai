"use client";

import * as React from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { listOperations } from "@/lib/core/openapi/navigate";
import { stringifySpec } from "@/lib/core/openapi/document";
import {
  HTTP_METHODS,
  type OpenApiDocument,
  type Operation,
  type PathItem,
} from "@/lib/core/openapi/types";
import type { SpecFormat } from "@/lib/domain/types";
import { Badge, MethodBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";

/**
 * The visual half of the designer.
 *
 * Edits mutate a structural clone of the parsed document and hand the
 * re-serialised source back to the parent, which keeps the raw editor as the
 * single source of truth — there is exactly one representation of the document
 * in the app, so the two views can never drift apart.
 */
export function VisualEditor({
  document,
  format,
  onChange,
}: {
  document: OpenApiDocument;
  format: SpecFormat;
  onChange: (source: string) => void;
}) {
  const operations = React.useMemo(() => listOperations(document), [document]);
  const [selected, setSelected] = React.useState<string | null>(null);

  const current =
    operations.find((entry) => `${entry.method} ${entry.path}` === selected) ?? operations[0];

  const commit = (mutate: (draft: OpenApiDocument) => void): void => {
    const draft = structuredClone(document);
    mutate(draft);
    onChange(stringifySpec(draft, format));
  };

  const updateInfo = (field: "title" | "version" | "description", value: string): void => {
    commit((draft) => {
      draft.info ??= {};
      draft.info[field] = value;
    });
  };

  const updateOperation = (path: string, method: string, patch: Partial<Operation>): void => {
    commit((draft) => {
      const pathItem = draft.paths?.[path] as PathItem | undefined;
      const operation = pathItem?.[method as keyof PathItem] as Operation | undefined;
      if (!operation) return;
      Object.assign(operation, patch);
    });
  };

  const addPath = (): void => {
    const raw = window.prompt("New path (e.g. /invoices)", "/resources");
    if (!raw) return;
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    commit((draft) => {
      draft.paths ??= {};
      if (draft.paths[path]) return;
      draft.paths[path] = {
        get: {
          operationId: `list${path.replace(/[^a-zA-Z0-9]/g, "")}`,
          summary: `List ${path.replace(/^\//, "")}`,
          description: "Describe what this operation returns.",
          tags: ["Default"],
          responses: {
            "200": {
              description: "A successful response.",
              content: {
                "application/json": { schema: { type: "array", items: { type: "object" } } },
              },
            },
            "401": { description: "Authentication is required." },
            "429": { description: "Too many requests." },
          },
        },
      };
    });
    setSelected(`get ${path}`);
  };

  const addMethod = (path: string, method: string): void => {
    commit((draft) => {
      const pathItem = draft.paths?.[path];
      if (!pathItem || pathItem[method as keyof PathItem]) return;
      (pathItem as Record<string, unknown>)[method] = {
        operationId: `${method}${path.replace(/[^a-zA-Z0-9]/g, "")}`,
        summary: `${method.toUpperCase()} ${path}`,
        description: "Describe this operation.",
        tags: ["Default"],
        responses: {
          "200": { description: "A successful response." },
          "400": { description: "The request was invalid." },
          "500": { description: "Unexpected server error." },
        },
      } satisfies Operation;
    });
    setSelected(`${method} ${path}`);
  };

  const removeOperation = (path: string, method: string): void => {
    if (!window.confirm(`Remove ${method.toUpperCase()} ${path}?`)) return;
    commit((draft) => {
      const pathItem = draft.paths?.[path];
      if (!pathItem) return;
      delete (pathItem as Record<string, unknown>)[method];
      const remaining = HTTP_METHODS.filter((candidate) => pathItem[candidate]);
      if (remaining.length === 0) delete draft.paths?.[path];
    });
    setSelected(null);
  };

  const grouped = React.useMemo(() => {
    const map = new Map<string, typeof operations>();
    for (const entry of operations) {
      const bucket = map.get(entry.path) ?? [];
      bucket.push(entry);
      map.set(entry.path, bucket);
    }
    return [...map.entries()];
  }, [operations]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:grid-rows-1">
      <div className="border-line flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
        <div className="border-line space-y-3 border-b p-4">
          <Field label="Title">
            <Input
              value={document.info?.title ?? ""}
              onChange={(event) => updateInfo("title", event.target.value)}
              placeholder="My API"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Version">
              <Input
                value={document.info?.version ?? ""}
                onChange={(event) => updateInfo("version", event.target.value)}
                placeholder="1.0.0"
              />
            </Field>
            <Field label="OpenAPI">
              <Input value={document.openapi ?? ""} readOnly className="opacity-70" />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-ink-subtle text-[11px] tracking-wider uppercase">
            Operations · {operations.length}
          </span>
          <Button variant="ghost" size="sm" onClick={addPath}>
            <Plus />
            Path
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {grouped.length === 0 ? (
            <EmptyState
              icon={<Plus />}
              title="No operations"
              description="Add a path to begin designing this API."
            />
          ) : (
            grouped.map(([path, entries]) => (
              <div key={path} className="mb-3">
                <p
                  className="text-ink-subtle truncate px-2 py-1 font-mono text-[11px]"
                  title={path}
                >
                  {path}
                </p>
                {entries.map((entry) => {
                  const key = `${entry.method} ${entry.path}`;
                  const active = current && `${current.method} ${current.path}` === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelected(key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                        active ? "bg-surface-strong" : "hover:bg-surface/60",
                      )}
                    >
                      <MethodBadge method={entry.method} />
                      <span className="text-ink-muted min-w-0 flex-1 truncate text-xs">
                        {entry.operation.summary ?? entry.operationId}
                      </span>
                      <ChevronRight className="text-ink-subtle size-3 shrink-0" />
                    </button>
                  );
                })}
                <div className="mt-1 flex flex-wrap gap-1 px-2">
                  {HTTP_METHODS.filter(
                    (method) => !(document.paths?.[path] as PathItem | undefined)?.[method],
                  )
                    .slice(0, 4)
                    .map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => addMethod(path, method)}
                        className="border-line text-ink-subtle hover:border-accent/50 hover:text-ink rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase transition-colors"
                      >
                        + {method}
                      </button>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-5">
        {!current ? (
          <EmptyState
            icon={<Plus />}
            title="Select an operation"
            description="Choose an operation on the left to edit its summary, description, tags and responses."
          />
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <MethodBadge method={current.method} />
              <code className="text-ink font-mono text-sm">{current.path}</code>
              {current.deprecated ? <Badge tone="warn">deprecated</Badge> : null}
              <Button
                variant="ghost"
                size="sm"
                className="text-rose ml-auto"
                onClick={() => removeOperation(current.path, current.method)}
              >
                <Trash2 />
                Remove
              </Button>
            </div>

            <Field label="Operation ID" hint="Drives generated SDK method names — keep it stable.">
              <Input
                value={current.operation.operationId ?? ""}
                onChange={(event) =>
                  updateOperation(current.path, current.method, { operationId: event.target.value })
                }
              />
            </Field>

            <Field label="Summary">
              <Input
                value={current.operation.summary ?? ""}
                onChange={(event) =>
                  updateOperation(current.path, current.method, { summary: event.target.value })
                }
                placeholder="Create an order"
              />
            </Field>

            <Field label="Description" hint="Markdown is rendered in the published documentation.">
              <Textarea
                rows={4}
                value={current.operation.description ?? ""}
                onChange={(event) =>
                  updateOperation(current.path, current.method, { description: event.target.value })
                }
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tags" hint="Comma separated.">
                <Input
                  value={(current.operation.tags ?? []).join(", ")}
                  onChange={(event) =>
                    updateOperation(current.path, current.method, {
                      tags: event.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label="Lifecycle">
                <Select
                  value={current.operation.deprecated ? "deprecated" : "active"}
                  onChange={(event) =>
                    updateOperation(current.path, current.method, {
                      deprecated: event.target.value === "deprecated",
                    })
                  }
                >
                  <option value="active">Active</option>
                  <option value="deprecated">Deprecated</option>
                </Select>
              </Field>
            </div>

            <div>
              <p className="text-ink-muted mb-2 text-xs font-medium">Parameters</p>
              {current.parameters.length === 0 ? (
                <p className="border-line text-ink-subtle rounded-lg border border-dashed px-3 py-4 text-center text-xs">
                  No parameters declared.
                </p>
              ) : (
                <ul className="divide-line/70 border-line divide-y rounded-lg border">
                  {current.parameters.map((parameter) => (
                    <li
                      key={`${parameter.in}-${parameter.name}`}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <Badge tone="neutral" className="text-[10px]">
                        {parameter.in}
                      </Badge>
                      <code className="text-ink font-mono text-xs">{parameter.name}</code>
                      {parameter.required ? <Badge tone="accent">required</Badge> : null}
                      <span className="text-ink-subtle ml-auto truncate text-[11px]">
                        {parameter.description ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-ink-muted mb-2 text-xs font-medium">Responses</p>
              <ul className="divide-line/70 border-line divide-y rounded-lg border">
                {Object.entries(current.operation.responses ?? {}).map(([code, response]) => (
                  <li key={code} className="flex items-start gap-3 px-3 py-2">
                    <code
                      className={cn(
                        "font-mono text-xs font-semibold",
                        code.startsWith("2")
                          ? "text-mint"
                          : code.startsWith("4")
                            ? "text-amber"
                            : "text-rose",
                      )}
                    >
                      {code}
                    </code>
                    <span className="text-ink-muted text-[11px] leading-relaxed">
                      {(response as { description?: string }).description ?? "No description."}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-ink-subtle mt-2 text-[11px]">
                Response bodies and schemas are edited in the code view — switch tabs to shape them.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
