import { VersionsView } from "@/components/studio/versions-view";
import { currentIdentity } from "@/lib/server/auth";
import { SpecService } from "@/lib/services/spec-service";

export const dynamic = "force-dynamic";

export default async function VersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await currentIdentity();
  const versions = await SpecService.listVersions(identity, id);

  return (
    <VersionsView
      specId={id}
      versions={versions.map((version) => ({
        ...version,
        document: "",
        sizeBytes: version.document.length,
      }))}
    />
  );
}
