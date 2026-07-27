import { describe, expect, it } from "vitest";
import { buildOverview, latencyPercentiles, percentile } from "@/lib/core/telemetry/metrics";
import { buildOperation, graphqlStats, parseSdl } from "@/lib/core/graphql/sdl";
import type { MetricSample } from "@/lib/domain/types";

const sample = (overrides: Partial<MetricSample>): MetricSample => ({
  id: "m",
  specId: "spec_1",
  timestamp: "2025-01-15T10:00:00.000Z",
  method: "GET",
  path: "/orders",
  status: 200,
  durationMs: 100,
  source: "mock",
  ...overrides,
});

describe("percentiles", () => {
  it("uses nearest-rank", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(100);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("computes the full set", () => {
    const result = latencyPercentiles([5, 10, 15, 20]);
    expect(result.p50).toBe(10);
    expect(result.max).toBe(20);
  });
});

describe("buildOverview", () => {
  it("returns an empty but valid overview with no samples", () => {
    const overview = buildOverview([]);
    expect(overview.requests).toBe(0);
    expect(overview.availability).toBe(100);
    expect(overview.errorRate).toBe(0);
    expect(overview.buckets).toEqual([]);
  });

  it("computes error rate and availability separately", () => {
    const overview = buildOverview([
      sample({ id: "1", status: 200 }),
      sample({ id: "2", status: 404 }),
      sample({ id: "3", status: 500 }),
      sample({ id: "4", status: 200 }),
    ]);

    expect(overview.requests).toBe(4);
    expect(overview.errors).toBe(2);
    expect(overview.errorRate).toBe(50);
    // A 404 is a client error, not an outage — availability counts only 5xx.
    expect(overview.availability).toBe(75);
  });

  it("buckets samples over time", () => {
    const overview = buildOverview(
      [
        sample({ id: "1", timestamp: "2025-01-15T10:05:00.000Z" }),
        sample({ id: "2", timestamp: "2025-01-15T10:45:00.000Z" }),
        sample({ id: "3", timestamp: "2025-01-15T11:15:00.000Z" }),
      ],
      { bucketMs: 3_600_000 },
    );
    expect(overview.buckets).toHaveLength(2);
    expect(overview.buckets[0]?.requests).toBe(2);
    expect(overview.busiestHour).toBe("2025-01-15T10:00:00.000Z");
  });

  it("ranks endpoints by traffic", () => {
    const overview = buildOverview([
      sample({ id: "1", path: "/orders" }),
      sample({ id: "2", path: "/orders" }),
      sample({ id: "3", path: "/pets", status: 500 }),
    ]);

    expect(overview.endpoints[0]?.path).toBe("/orders");
    expect(overview.endpoints[0]?.requests).toBe(2);
    expect(overview.endpoints[1]?.errorRate).toBe(100);
  });

  it("groups status codes by class", () => {
    const overview = buildOverview([
      sample({ id: "1", status: 201 }),
      sample({ id: "2", status: 404 }),
      sample({ id: "3", status: 503 }),
    ]);
    expect(overview.statusDistribution).toEqual([
      { status: "2xx", count: 1 },
      { status: "4xx", count: 1 },
      { status: "5xx", count: 1 },
    ]);
  });
});

const SDL = `
"""A pet in the store."""
type Pet {
  id: ID!
  name: String!
  status: PetStatus
  owner: Owner
}

type Owner {
  id: ID!
  email: String!
}

enum PetStatus {
  AVAILABLE
  SOLD
}

input PetFilter {
  status: PetStatus
  limit: Int = 25
}

type Query {
  "Fetch a single pet."
  pet(id: ID!): Pet
  pets(filter: PetFilter, limit: Int = 10): [Pet!]!
}

type Mutation {
  createPet(name: String!, ownerId: ID!): Pet
  deletePet(id: ID!): Boolean @deprecated(reason: "Use archivePet")
}
`;

describe("parseSdl", () => {
  it("extracts types, enums and inputs", () => {
    const model = parseSdl(SDL);
    const names = model.types.map((type) => type.name);
    expect(names).toEqual(
      expect.arrayContaining(["Pet", "Owner", "PetStatus", "PetFilter", "Query", "Mutation"]),
    );
    expect(model.types.find((type) => type.name === "PetStatus")?.members).toEqual([
      "AVAILABLE",
      "SOLD",
    ]);
  });

  it("captures descriptions and fields", () => {
    const pet = parseSdl(SDL).types.find((type) => type.name === "Pet");
    expect(pet?.description).toBe("A pet in the store.");
    expect(pet?.fields.map((field) => field.name)).toEqual(["id", "name", "status", "owner"]);
    expect(pet?.fields.find((field) => field.name === "id")?.type).toBe("ID!");
  });

  it("parses arguments with defaults", () => {
    const pets = parseSdl(SDL).queries.find((field) => field.name === "pets");
    expect(pets?.args.map((argument) => argument.name)).toEqual(["filter", "limit"]);
    expect(pets?.args.find((argument) => argument.name === "limit")?.defaultValue).toBe("10");
  });

  it("detects deprecations", () => {
    const remove = parseSdl(SDL).mutations.find((field) => field.name === "deletePet");
    expect(remove?.deprecated).toBe(true);
  });

  it("separates root operation types", () => {
    const model = parseSdl(SDL);
    expect(model.queries.map((field) => field.name)).toEqual(["pet", "pets"]);
    expect(model.mutations.map((field) => field.name)).toEqual(["createPet", "deletePet"]);
    expect(model.subscriptions).toEqual([]);
  });

  it("summarises the schema", () => {
    const stats = graphqlStats(parseSdl(SDL));
    expect(stats.queries).toBe(2);
    expect(stats.mutations).toBe(2);
    expect(stats.types).toBeGreaterThanOrEqual(6);
  });

  it("handles an empty document", () => {
    const model = parseSdl("");
    expect(model.types).toEqual([]);
    expect(model.queries).toEqual([]);
  });
});

describe("buildOperation", () => {
  it("builds a runnable query with variables and a selection set", () => {
    const model = parseSdl(SDL);
    const field = model.queries.find((entry) => entry.name === "pet")!;
    const { document, variables } = buildOperation(model, field, "query");

    expect(document).toContain("query Pet($id: ID!)");
    expect(document).toContain("pet(id: $id)");
    expect(document).toContain("name");
    expect(JSON.parse(variables)).toEqual({ id: "1" });
  });

  it("builds mutations", () => {
    const model = parseSdl(SDL);
    const field = model.mutations.find((entry) => entry.name === "createPet")!;
    const { document } = buildOperation(model, field, "mutation");
    expect(document.startsWith("mutation CreatePet(")).toBe(true);
  });
});
