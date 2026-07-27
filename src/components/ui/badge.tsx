import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5 tracking-wide",
  {
    variants: {
      tone: {
        neutral: "border-line-strong bg-surface-strong/70 text-ink-muted",
        accent: "border-accent/40 bg-accent/12 text-accent-soft",
        ok: "border-mint/35 bg-mint/12 text-mint",
        warn: "border-amber/35 bg-amber/12 text-amber",
        danger: "border-rose/35 bg-rose/12 text-rose",
        info: "border-cyan/35 bg-cyan/12 text-cyan",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const METHOD_TONE: Record<string, string> = {
  GET: "border-cyan/40 bg-cyan/12 text-cyan",
  POST: "border-mint/40 bg-mint/12 text-mint",
  PUT: "border-amber/40 bg-amber/12 text-amber",
  PATCH: "border-accent/40 bg-accent/12 text-accent-soft",
  DELETE: "border-rose/40 bg-rose/12 text-rose",
  HEAD: "border-line-strong bg-surface-strong text-ink-muted",
  OPTIONS: "border-line-strong bg-surface-strong text-ink-muted",
  TRACE: "border-line-strong bg-surface-strong text-ink-muted",
};

/** HTTP method chip with a consistent colour language across the whole app. */
export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const upper = method.toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex w-[4.25rem] shrink-0 items-center justify-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest",
        METHOD_TONE[upper] ?? METHOD_TONE.OPTIONS,
        className,
      )}
    >
      {upper}
    </span>
  );
}

/** HTTP status chip coloured by class. */
export function StatusBadge({ status, className }: { status: number; className?: string }) {
  const tone =
    status === 0
      ? "border-line-strong bg-surface-strong text-ink-muted"
      : status < 300
        ? "border-mint/40 bg-mint/12 text-mint"
        : status < 400
          ? "border-cyan/40 bg-cyan/12 text-cyan"
          : status < 500
            ? "border-amber/40 bg-amber/12 text-amber"
            : "border-rose/40 bg-rose/12 text-rose";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold",
        tone,
        className,
      )}
    >
      {status === 0 ? "ERR" : status}
    </span>
  );
}
