"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Gauge,
  LayoutGrid,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  TerminalSquare,
} from "lucide-react";
import type { Capabilities } from "@/lib/server/env";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/misc";
import { usePersisted } from "@/hooks/use-persisted";
import { cn } from "@/lib/utils/cn";

const NAV = [
  { href: "/dashboard", label: "APIs", icon: LayoutGrid },
  { href: "/client", label: "API client", icon: TerminalSquare },
  { href: "/monitor", label: "Monitoring", icon: Gauge },
];

export function StudioShell({
  capabilities,
  identityName,
  children,
}: {
  capabilities: Capabilities;
  identityName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [theme, setTheme] = usePersisted("osa-theme", "dark");
  const [navState, setNavState] = usePersisted("osa-nav-collapsed", "0");
  const collapsed = navState === "1";

  // The theme lives on <html>, which React does not own — keep it in sync.
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  }, [theme]);

  const toggleTheme = (): void => setTheme(theme === "dark" ? "light" : "dark");
  const toggleNav = (): void => setNavState(collapsed ? "0" : "1");

  return (
    <div className="flex min-h-screen flex-1">
      <aside
        className={cn(
          "border-line/70 bg-canvas-raised/40 sticky top-0 hidden h-screen shrink-0 flex-col border-r backdrop-blur-xl transition-[width] duration-200 md:flex",
          collapsed ? "w-[4.25rem]" : "w-60",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="OpenAPI Studio AI home">
            <span className="from-accent to-cyan text-canvas grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-[13px] font-black">
              A
            </span>
            {!collapsed && <span className="text-sm font-semibold tracking-tight">Studio AI</span>}
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-surface-strong text-ink shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]"
                    : "text-ink-muted hover:bg-surface/60 hover:text-ink",
                  collapsed && "justify-center px-0",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href} label={item.label}>
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </nav>

        <div className="border-line/70 border-t p-3">
          {!collapsed && (
            <div className="border-line bg-canvas/60 mb-3 space-y-1.5 rounded-lg border p-3">
              <p className="text-ink-subtle text-[10px] tracking-wider uppercase">Runtime</p>
              <CapabilityRow label="Storage" value={capabilities.persistence} />
              <CapabilityRow label="Auth" value={capabilities.auth} />
              <CapabilityRow label="AI" value={capabilities.ai} />
            </div>
          )}
          <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              aria-label="Toggle colour theme"
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleNav}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
            {!collapsed && (
              <span className="text-ink-subtle ml-auto truncate text-[11px]" title={identityName}>
                {identityName}
              </span>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line/70 bg-canvas/70 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-xl md:hidden">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="from-accent to-cyan text-canvas grid size-7 place-items-center rounded-lg bg-gradient-to-br text-[13px] font-black">
              A
            </span>
            <span className="text-sm font-semibold">Studio AI</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            {NAV.map((item) => (
              <Button
                key={item.href}
                variant="ghost"
                size="icon-sm"
                asChild
                aria-label={item.label}
              >
                <Link href={item.href}>
                  <item.icon />
                </Link>
              </Button>
            ))}
          </nav>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function CapabilityRow({ label, value }: { label: string; value: string }) {
  const hosted = ["postgres", "clerk", "openrouter"].includes(value);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-muted text-[11px]">{label}</span>
      <Badge tone={hosted ? "accent" : "neutral"} className="px-2 py-0 text-[10px]">
        {value}
      </Badge>
    </div>
  );
}

/** Page-level header used by every studio screen. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="border-line/70 flex flex-wrap items-end justify-between gap-4 border-b px-6 py-5">
      <div className="min-w-0">
        {breadcrumb}
        <h1 className="text-ink truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-ink-muted mt-1 max-w-2xl text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function LiveDot({ label }: { label: string }) {
  return (
    <span className="text-ink-muted inline-flex items-center gap-1.5 text-[11px]">
      <Activity className="animate-pulse-soft text-mint size-3" />
      {label}
    </span>
  );
}
