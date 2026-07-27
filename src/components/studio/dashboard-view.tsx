"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowUpRight, FileUp, Loader2, Plus, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { DashboardSpec } from "@/app/(studio)/dashboard/page";
import type { Capabilities } from "@/lib/server/env";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/studio/shell";
import { STARTER_TEMPLATES } from "@/lib/core/samples";
import { streamGeneration, studioApi } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

export function DashboardView({
  specs,
  capabilities,
}: {
  specs: DashboardSpec[];
  capabilities: Capabilities;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  // `?demo=1` from the landing page opens the composer straight away. This is
  // derived from the URL during render, not synced through an effect.
  const [open, setOpen] = React.useState(() => params.get("demo") === "1");

  const filtered = specs.filter(
    (spec) =>
      spec.name.toLowerCase().includes(query.toLowerCase()) ||
      spec.description.toLowerCase().includes(query.toLowerCase()),
  );

  const totals = {
    apis: specs.length,
    operations: specs.reduce((sum, spec) => sum + spec.operations, 0),
    errors: specs.reduce((sum, spec) => sum + spec.errors, 0),
    averageScore:
      specs.length === 0
        ? 0
        : Math.round(specs.reduce((sum, spec) => sum + (spec.score ?? 0), 0) / specs.length),
  };

  const remove = async (spec: DashboardSpec): Promise<void> => {
    if (
      !window.confirm(
        `Delete "${spec.name}" and its entire version history? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await studioApi.deleteSpec(spec.id);
      toast.success(`Deleted ${spec.name}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete the API.");
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="APIs"
        description="Design, validate, mock and ship. Every project is scored the moment you save it."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="primary">
                <Plus />
                New API
              </Button>
            </DialogTrigger>
            <DialogContent
              title="Create an API"
              description="Describe it in a sentence, start from a template, or import an existing document."
            >
              <CreateApiForm
                capabilities={capabilities}
                busy={creating}
                setBusy={setCreating}
                onCreated={(id) => {
                  setOpen(false);
                  router.push(`/apis/${id}`);
                }}
              />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex-1 space-y-6 p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="APIs" value={totals.apis} />
          <Stat label="Operations" value={totals.operations} />
          <Stat
            label="Average score"
            value={totals.apis === 0 ? "—" : totals.averageScore}
            tone={totals.averageScore >= 85 ? "ok" : totals.averageScore >= 65 ? "warn" : "danger"}
          />
          <Stat
            label="Blocking errors"
            value={totals.errors}
            tone={totals.errors === 0 ? "ok" : "danger"}
            hint={
              totals.errors === 0
                ? "All documents are structurally valid"
                : "Open the designer to fix"
            }
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="text-ink-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter APIs"
              className="pl-9"
              aria-label="Filter APIs"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Sparkles />}
              title={specs.length === 0 ? "No APIs yet" : "Nothing matches that filter"}
              description={
                specs.length === 0
                  ? "Describe an API in plain English and the design engine will produce a complete, validated OpenAPI 3.1 document — no provider key required."
                  : "Try a different search term."
              }
              action={
                specs.length === 0 ? (
                  <Button variant="primary" onClick={() => setOpen(true)}>
                    <Wand2 />
                    Design my first API
                  </Button>
                ) : null
              }
            />
          </Panel>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((spec, index) => (
              <motion.div
                key={spec.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(index, 8) * 0.03 }}
              >
                <SpecCard spec={spec} onDelete={() => void remove(spec)} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SpecCard({ spec, onDelete }: { spec: DashboardSpec; onDelete: () => void }) {
  const scoreTone =
    spec.score === null
      ? "neutral"
      : spec.score >= 85
        ? "ok"
        : spec.score >= 65
          ? "warn"
          : "danger";

  return (
    <Panel className="group hover:border-accent/40 h-full p-5 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/apis/${spec.id}`} className="block">
            <h3 className="text-ink group-hover:text-accent-soft truncate text-sm font-semibold transition-colors">
              {spec.name}
            </h3>
          </Link>
          <p className="text-ink-muted mt-1 line-clamp-2 text-xs leading-relaxed">
            {spec.description || "No description yet."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onDelete}
          aria-label={`Delete ${spec.name}`}
        >
          <Trash2 className="text-rose" />
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge tone={spec.status === "published" ? "ok" : "neutral"}>{spec.status}</Badge>
        <Badge tone="neutral">{spec.kind}</Badge>
        {spec.versionLabel ? <Badge tone="accent">v{spec.versionLabel}</Badge> : null}
        {spec.errors > 0 ? <Badge tone="danger">{spec.errors} errors</Badge> : null}
      </div>

      <dl className="border-line mt-4 grid grid-cols-3 gap-2 border-t pt-4 text-center">
        <div>
          <dt className="text-ink-subtle text-[10px] tracking-wider uppercase">Ops</dt>
          <dd className="text-ink font-mono text-sm">{spec.operations}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle text-[10px] tracking-wider uppercase">Score</dt>
          <dd
            className={cn(
              "font-mono text-sm",
              scoreTone === "ok"
                ? "text-mint"
                : scoreTone === "warn"
                  ? "text-amber"
                  : scoreTone === "danger"
                    ? "text-rose"
                    : "text-ink",
            )}
          >
            {spec.score ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-subtle text-[10px] tracking-wider uppercase">Security</dt>
          <dd className="text-ink font-mono text-sm">{spec.securityGrade ?? "—"}</dd>
        </div>
      </dl>

      <Button variant="ghost" size="sm" className="mt-4 w-full justify-between" asChild>
        <Link href={`/apis/${spec.id}`}>
          Open designer
          <ArrowUpRight />
        </Link>
      </Button>
    </Panel>
  );
}

function CreateApiForm({
  capabilities,
  busy,
  setBusy,
  onCreated,
}: {
  capabilities: Capabilities;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [mode, setMode] = React.useState<"describe" | "template" | "import">("describe");
  const [brief, setBrief] = React.useState("");
  const [name, setName] = React.useState("");
  const [style, setStyle] = React.useState("standard");
  const [template, setTemplate] = React.useState<string>(STARTER_TEMPLATES[0].id);
  const [source, setSource] = React.useState("");
  const [status, setStatus] = React.useState<string | null>(null);

  const create = async (specName: string, specSource: string): Promise<void> => {
    const created = await studioApi.createSpec({ name: specName, source: specSource });
    toast.success(`Created ${created.project.name}`);
    onCreated(created.project.id);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    try {
      if (mode === "describe") {
        if (brief.trim().length < 8) {
          toast.error("Describe the API in a little more detail.");
          return;
        }
        let generated = "";
        await streamGeneration(
          { request: brief, style, ...(name ? { title: name } : {}) },
          {
            onStatus: setStatus,
            onDone: (result) => {
              generated = result.source;
              setStatus(`Generated with the ${result.engine} engine.`);
            },
            onError: (message) => toast.error(message),
          },
        );
        if (!generated) throw new Error("The generator returned nothing.");
        await create(name || brief.slice(0, 60), generated);
        return;
      }

      if (mode === "template") {
        setStatus("Rendering the template…");
        const { starterSpec } = await import("@/lib/core/samples");
        const starter = starterSpec(template as never);
        await create(name || starter.name, starter.source);
        return;
      }

      if (!source.trim()) {
        toast.error("Paste an OpenAPI document first.");
        return;
      }
      await create(name || "Imported API", source);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the API.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <div className="border-line bg-canvas-raised/60 grid grid-cols-3 gap-1 rounded-xl border p-1">
        {(
          [
            ["describe", "Describe", Wand2],
            ["template", "Template", Sparkles],
            ["import", "Import", FileUp],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              mode === value ? "bg-surface-strong text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <Field label="Name" hint="Optional — inferred from the document when left blank.">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Orders API"
        />
      </Field>

      {mode === "describe" && (
        <>
          <Field
            label="What should this API do?"
            hint={
              capabilities.ai === "openrouter"
                ? "Streams from your configured OpenRouter model, then validates and repairs the result."
                : "No provider key configured — the deterministic design engine will produce the document (free)."
            }
          >
            <Textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={4}
              placeholder="Design an e-commerce order API with carts, payments, refunds and delivery webhooks."
            />
          </Field>
          <Field label="Depth">
            <Select value={style} onChange={(event) => setStyle(event.target.value)}>
              <option value="minimal">Minimal — core resource only</option>
              <option value="standard">Standard — full CRUD plus domain actions</option>
              <option value="comprehensive">Comprehensive — related resources and webhooks</option>
            </Select>
          </Field>
        </>
      )}

      {mode === "template" && (
        <Field label="Starter template">
          <Select value={template} onChange={(event) => setTemplate(event.target.value)}>
            {STARTER_TEMPLATES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} — {entry.description}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {mode === "import" && (
        <Field
          label="OpenAPI document"
          hint="Paste YAML or JSON. It is validated before the project is created."
        >
          <Textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            rows={10}
            className="font-mono text-xs"
            placeholder="openapi: 3.1.0&#10;info:&#10;  title: My API"
          />
        </Field>
      )}

      {status ? (
        <p className="border-line bg-canvas-raised/60 text-ink-muted flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <Loader2 className="text-accent-soft size-3.5 animate-spin" />
          {status}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}
          Create API
        </Button>
      </div>
    </form>
  );
}
