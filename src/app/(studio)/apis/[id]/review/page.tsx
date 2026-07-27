import { ReviewView } from "@/components/studio/review-view";
import { parseSpec } from "@/lib/core/openapi/document";
import { listOperations } from "@/lib/core/openapi/navigate";
import { getRepository } from "@/lib/repository";
import { currentIdentity } from "@/lib/server/auth";
import { SpecService } from "@/lib/services/spec-service";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await currentIdentity();
  const [{ source }, versions, repository] = await Promise.all([
    SpecService.sourceFor(identity, id),
    SpecService.listVersions(identity, id),
    getRepository(),
  ]);

  const [comments, reviews] = await Promise.all([
    repository.listComments(id),
    repository.listReviews(id),
  ]);

  const parsed = parseSpec(source);
  const pointers = [
    { pointer: "", label: "Whole document" },
    { pointer: "/info", label: "info" },
    ...(parsed.ok
      ? listOperations(parsed.value.document).map((entry) => ({
          pointer: entry.pointer,
          label: `${entry.method.toUpperCase()} ${entry.path}`,
        }))
      : []),
  ];

  return (
    <ReviewView
      specId={id}
      versions={versions}
      comments={comments}
      reviews={reviews}
      pointers={pointers}
    />
  );
}
