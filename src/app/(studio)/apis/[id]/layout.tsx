import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/repository/types";
import { currentIdentity } from "@/lib/server/auth";
import { SpecService, type SpecWithVersion } from "@/lib/services/spec-service";
import { SpecTabs } from "@/components/studio/spec-tabs";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Load the project, translating a missing record into a 404.
 *
 * The lookup is deliberately separated from rendering: wrapping JSX in a
 * try/catch would not catch render-time errors anyway, and would silently
 * convert genuine failures into "not found".
 */
async function loadSpec(id: string): Promise<SpecWithVersion> {
  const identity = await currentIdentity();
  try {
    return await SpecService.get(identity, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function SpecLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { project, version } = await loadSpec(id);

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-line/70 flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <div className="min-w-0">
          <Link
            href="/dashboard"
            className="text-ink-subtle hover:text-ink text-[11px] transition-colors"
          >
            APIs
          </Link>
          <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone={project.status === "published" ? "ok" : "neutral"}>{project.status}</Badge>
          {version ? <Badge tone="accent">v{version.label}</Badge> : null}
        </div>
        <SpecTabs specId={id} className="ml-auto" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
