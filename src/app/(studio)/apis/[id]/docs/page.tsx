import { notFound } from "next/navigation";
import { ApiDocs } from "@/components/studio/docs/api-docs";
import { parseSpec } from "@/lib/core/openapi/document";
import { currentIdentity } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { SpecService } from "@/lib/services/spec-service";

export const dynamic = "force-dynamic";

export default async function DocsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await currentIdentity();
  const { source } = await SpecService.sourceFor(identity, id);

  const parsed = parseSpec(source);
  if (!parsed.ok) notFound();

  const mockBaseUrl = `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/mock/${id}`;
  return <ApiDocs document={parsed.value.document} mockBaseUrl={mockBaseUrl} />;
}
