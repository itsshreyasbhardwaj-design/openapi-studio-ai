"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./button";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="glass-strong text-ink z-50 max-w-xs rounded-lg px-2.5 py-1.5 text-xs"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-[var(--color-line-strong)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  id?: string;
}) {
  const generated = React.useId();
  const controlId = id ?? generated;
  return (
    <div className="flex items-center gap-2.5">
      <SwitchPrimitive.Root
        id={controlId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="border-line-strong bg-canvas-raised data-[state=checked]:border-accent/60 data-[state=checked]:bg-accent/70 relative h-5 w-9 shrink-0 rounded-full border transition-colors"
      >
        <SwitchPrimitive.Thumb className="bg-ink-muted block size-3.5 translate-x-0.5 rounded-full transition-transform data-[state=checked]:translate-x-[1.15rem] data-[state=checked]:bg-white" />
      </SwitchPrimitive.Root>
      <label htmlFor={controlId} className="text-ink-muted cursor-pointer text-xs">
        {label}
      </label>
    </div>
  );
}

/** Copy-to-clipboard button with transient confirmation. */
export function CopyButton({
  value,
  className,
  label = "Copy",
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("gap-1.5 text-xs", className)}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <Check className="text-mint" /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse-soft from-surface via-surface-strong to-surface rounded-md bg-gradient-to-r bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

/**
 * Empty-state placeholder.
 *
 * `icon` is a rendered element rather than a component type: React Server
 * Components cannot pass a function (and a component *is* a function) across
 * the boundary into a client component.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="border-line bg-surface-strong/60 [&_svg]:text-accent-soft rounded-2xl border p-3 [&_svg]:size-6">
        {icon}
      </div>
      <div>
        <p className="text-ink text-sm font-medium">{title}</p>
        <p className="text-ink-muted mx-auto mt-1 max-w-sm text-xs leading-relaxed">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

/** A labelled statistic used across the dashboards. */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "neutral" | "ok" | "warn" | "danger" | "accent";
}) {
  const toneClass = {
    neutral: "text-ink",
    ok: "text-mint",
    warn: "text-amber",
    danger: "text-rose",
    accent: "text-accent-soft",
  }[tone];

  return (
    <div className="border-line bg-canvas-raised/50 flex flex-col gap-1 rounded-xl border px-4 py-3">
      <span className="text-ink-subtle text-[11px] tracking-wider uppercase">{label}</span>
      <span className={cn("font-mono text-xl font-semibold tabular-nums", toneClass)}>{value}</span>
      {hint ? <span className="text-ink-subtle text-[11px]">{hint}</span> : null}
    </div>
  );
}
