"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Boxes,
  GitCompareArrows,
  MessagesSquare,
  PenLine,
  Server,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { segment: "", label: "Design", icon: PenLine },
  { segment: "docs", label: "Docs", icon: BookOpen },
  { segment: "security", label: "Security", icon: ShieldCheck },
  { segment: "mock", label: "Mock", icon: Server },
  { segment: "sdk", label: "SDKs", icon: Boxes },
  { segment: "versions", label: "Versions", icon: GitCompareArrows },
  { segment: "review", label: "Review", icon: MessagesSquare },
];

export function SpecTabs({ specId, className }: { specId: string; className?: string }) {
  const pathname = usePathname();
  const base = `/apis/${specId}`;

  return (
    <nav className={cn("flex flex-wrap items-center gap-1", className)} aria-label="API sections">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = tab.segment ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={tab.segment || "design"}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-surface-strong text-ink shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]"
                : "text-ink-muted hover:bg-surface/60 hover:text-ink",
            )}
          >
            <tab.icon className="size-3.5" />
            <span className="hidden sm:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
