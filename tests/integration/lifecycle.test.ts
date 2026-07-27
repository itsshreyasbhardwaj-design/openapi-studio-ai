import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/repository/memory";
import { __setRepository } from "@/lib/repository";
import { SpecService } from "@/lib/services/spec-service";
import { LOCAL_IDENTITY, ForbiddenError, type Identity } from "@/lib/server/auth";
import { synthesiseSpec } from "@/lib/core/ai/offline";
import { stringifySpec } from "@/lib/core/openapi/document";
import { generateSdk } from "@/lib/core/sdk";
import { mockResponse } from "@/lib/core/mock/server";
import { collectionFromSpec } from "@/lib/core/testing/from-spec";
import { runCollection } from "@/lib/core/testing/runner";
import { buildOverview } from "@/lib/core/telemetry/metrics";
import { parseSpec } from "@/lib/core/openapi/document";
import { newId } from "@/lib/utils/id";

const other: Identity = { ...LOCAL_IDENTITY, userId: "someone-else" };

let repository: MemoryRepository;

beforeEach(() => {
  repository = new MemoryRepository();
  __setRepository(repository);
});

const source = (): string =>
  stringifySpec(synthesiseSpec("Design an e-commerce order API").document, "yaml");

describe("specification lifecycle", () => {
  it("creates, versions, diffs and rolls back", async () => {
    const created = await SpecService.create(LOCAL_IDENTITY, { name: "Orders", source: source() });
    expect(created.project.currentVersionId).toBe(created.version?.id);

    // A no-op save is rejected rather than creating a duplicate version.
    await expect(
      SpecService.saveVersion(LOCAL_IDENTITY, created.project.id, { source: source() }),
    ).rejects.toThrow(/identical/);

    const parsed = parseSpec(created.version!.document);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Remove an endpoint: a breaking change should bump the major version.
    const breaking = structuredClone(parsed.value.document);
    delete breaking.paths?.["/orders/{orderId}"];

    const second = await SpecService.saveVersion(LOCAL_IDENTITY, created.project.id, {
      source: stringifySpec(breaking, "yaml"),
      message: "Remove the order detail endpoint",
    });

    expect(second.diff?.impact).toBe("major");
    expect(second.diff?.breakingCount).toBeGreaterThan(0);
    expect(second.version.label).toBe("2.0.0");

    const versions = await SpecService.listVersions(LOCAL_IDENTITY, created.project.id);
    expect(versions).toHaveLength(2);

    // Rolling back appends a new version rather than rewriting history.
    const restored = await SpecService.rollback(
      LOCAL_IDENTITY,
      created.project.id,
      created.version!.id,
    );
    expect(restored.document).toBe(created.version!.document);
    expect(await SpecService.listVersions(LOCAL_IDENTITY, created.project.id)).toHaveLength(3);

    const current = await SpecService.get(LOCAL_IDENTITY, created.project.id);
    expect(current.version?.id).toBe(restored.id);
  });

  it("refuses to parse an invalid document", async () => {
    await expect(
      SpecService.create(LOCAL_IDENTITY, {
        name: "Bad",
        source: "openapi: 3.1.0\n  bad:\n indent\n",
      }),
    ).rejects.toThrow(/could not be parsed/);
  });

  it("enforces ownership", async () => {
    const created = await SpecService.create(LOCAL_IDENTITY, { name: "Orders", source: source() });
    await expect(SpecService.get(other, created.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(SpecService.remove(other, created.project.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("deletes a project and its history", async () => {
    const created = await SpecService.create(LOCAL_IDENTITY, { name: "Orders", source: source() });
    await SpecService.remove(LOCAL_IDENTITY, created.project.id);
    expect(await repository.getProject(created.project.id)).toBeNull();
    expect(await repository.listVersions(created.project.id)).toEqual([]);
  });

  it("analyses a stored document", async () => {
    const analysis = await SpecService.analyze(source());
    expect(analysis.valid).toBe(true);
    expect(analysis.stats.operations).toBeGreaterThan(0);
  });
});

describe("design → mock → test → observe", () => {
  it("runs an imported collection against the mock engine and records metrics", async () => {
    const created = await SpecService.create(LOCAL_IDENTITY, { name: "Orders", source: source() });
    const parsed = parseSpec(created.version!.document);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const document = parsed.value.document;

    const workspace = await repository.ensureWorkspace(LOCAL_IDENTITY.userId);
    const collection = collectionFromSpec(document, {
      workspaceId: workspace.id,
      specId: created.project.id,
      baseUrl: "https://mock.test",
    });
    await repository.saveCollection(collection);
    expect(collection.requests.length).toBeGreaterThan(3);

    // The transport answers from the mock engine instead of the network.
    const run = await runCollection(
      collection,
      async (request) => {
        const url = new URL(request.url);
        const result = mockResponse(
          document,
          {
            method: request.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            headers: request.headers,
            body: request.body,
          },
          { enforceAuth: false, validateRequest: false },
        );
        await repository.recordMetric({
          id: newId("mtr"),
          specId: created.project.id,
          timestamp: new Date("2025-01-15T10:00:00.000Z").toISOString(),
          method: request.method,
          path: url.pathname,
          status: result.status,
          durationMs: 12,
          source: "mock",
        });
        return {
          status: result.status,
          statusText: "OK",
          headers: result.headers,
          body: result.body,
          durationMs: 12,
          sizeBytes: result.body.length,
          error: null,
        };
      },
      { variables: { orderId: "ord_1", productId: "prd_1", accessToken: "token" }, now: () => 0 },
    );

    expect(run.results.length).toBe(collection.requests.length);
    expect(run.results.every((result) => result.error === null)).toBe(true);
    expect(run.passed).toBeGreaterThan(0);

    const samples = await repository.listMetrics(created.project.id, "2025-01-01T00:00:00.000Z");
    const overview = buildOverview(samples);
    expect(overview.requests).toBe(collection.requests.length);
    expect(overview.endpoints.length).toBeGreaterThan(0);
  });

  it("generates an SDK from a stored version", async () => {
    const created = await SpecService.create(LOCAL_IDENTITY, { name: "Orders", source: source() });
    const { source: stored } = await SpecService.sourceFor(LOCAL_IDENTITY, created.project.id);
    const parsed = parseSpec(stored);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const sdk = generateSdk(parsed.value.document, "typescript", { packageName: "orders-client" });
    const client = sdk.files.find((file) => file.path === "src/client.ts")!.contents;
    expect(client).toContain("listOrders");
    expect(client).toContain("createOrder");
  });
});

describe("collaboration", () => {
  it("gates merging behind approval", async () => {
    const created = await SpecService.create(LOCAL_IDENTITY, { name: "Orders", source: source() });
    const now = new Date().toISOString();

    const review = await repository.createReview({
      id: newId("rev"),
      specId: created.project.id,
      versionId: created.version!.id,
      baseVersionId: null,
      title: "Ship it",
      description: "",
      status: "open",
      requestedBy: LOCAL_IDENTITY.userId,
      requestedByName: LOCAL_IDENTITY.displayName,
      reviewers: [],
      decisions: [],
      createdAt: now,
      updatedAt: now,
    });

    const blocked = await repository.updateReview(review.id, {
      decisions: [
        {
          reviewerId: "r1",
          reviewerName: "Reviewer",
          decision: "changes_requested",
          note: "Needs pagination",
          createdAt: now,
        },
      ],
      status: "changes_requested",
    });
    expect(blocked.status).toBe("changes_requested");

    const comment = await repository.createComment({
      id: newId("cmt"),
      specId: created.project.id,
      versionId: created.version!.id,
      pointer: "/paths/~1orders/get",
      body: "Document the cursor semantics.",
      authorId: LOCAL_IDENTITY.userId,
      authorName: LOCAL_IDENTITY.displayName,
      resolved: false,
      createdAt: now,
    });
    expect((await repository.listComments(created.project.id))[0]?.id).toBe(comment.id);

    const resolved = await repository.updateComment(comment.id, { resolved: true });
    expect(resolved.resolved).toBe(true);
  });
});
