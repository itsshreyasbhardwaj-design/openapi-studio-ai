import type { Metadata } from "next";
import { ApiClient } from "@/components/studio/api-client";
import { getRepository } from "@/lib/repository";
import { currentIdentity } from "@/lib/server/auth";
import { SpecService } from "@/lib/services/spec-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API client",
  description:
    "Send REST and GraphQL requests, assert on responses, and run collections as test suites.",
};

export default async function ClientPage() {
  const identity = await currentIdentity();
  const repository = await getRepository();
  const workspace = await repository.ensureWorkspace(identity.userId);

  const [collections, specs] = await Promise.all([
    repository.listCollections(workspace.id),
    SpecService.list(identity),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ApiClient collections={collections} specs={specs.map((entry) => entry.project)} />
    </div>
  );
}
