import { describe, expect, it } from "vitest";
import { diffDocuments, nextVersionLabel } from "@/lib/core/openapi/diff";
import { cloneDocument } from "@/lib/core/openapi/document";
import type { OpenApiDocument, Schema } from "@/lib/core/openapi/types";
import { petstore } from "../fixtures";

const describeChanges = (before: OpenApiDocument, after: OpenApiDocument): string[] =>
  diffDocuments(before, after).changes.map((change) => change.description);

describe("diffDocuments", () => {
  it("reports no changes for identical documents", () => {
    const result = diffDocuments(petstore(), petstore());
    expect(result.totalCount).toBe(0);
    expect(result.impact).toBe("none");
    expect(result.summary).toMatch(/No semantic differences/);
  });

  it("treats a removed endpoint as breaking", () => {
    const after = cloneDocument(petstore());
    delete after.paths?.["/pets/{petId}"];

    const result = diffDocuments(petstore(), after);
    expect(result.breakingCount).toBeGreaterThan(0);
    expect(result.impact).toBe("major");
    expect(describeChanges(petstore(), after).join(" ")).toMatch(
      /GET \/pets\/\{petId\} was removed/,
    );
  });

  it("treats an added endpoint as a minor change", () => {
    const after = cloneDocument(petstore());
    after.paths!["/pets/{petId}/photos"] = {
      get: { operationId: "listPhotos", responses: { "200": { description: "ok" } } },
    };

    const result = diffDocuments(petstore(), after);
    expect(result.breakingCount).toBe(0);
    expect(result.impact).toBe("minor");
  });

  it("treats a newly required parameter as breaking", () => {
    const after = cloneDocument(petstore());
    const parameters = after.paths?.["/pets"]?.get?.parameters as {
      name: string;
      required?: boolean;
    }[];
    parameters[0]!.required = true;

    const result = diffDocuments(petstore(), after);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0]?.description).toMatch(/became required/);
  });

  it("treats a removed response property as breaking for readers", () => {
    const after = cloneDocument(petstore());
    delete (after.components!.schemas!.Pet as Schema).properties!.status;

    const result = diffDocuments(petstore(), after);
    expect(
      result.changes.some(
        (change) => change.breaking && /"status" was removed/.test(change.description),
      ),
    ).toBe(true);
  });

  it("treats a new optional response property as additive", () => {
    const after = cloneDocument(petstore());
    (after.components!.schemas!.Pet as Schema).properties!.nickname = {
      type: "string",
      description: "Nickname.",
    };

    const result = diffDocuments(petstore(), after);
    expect(result.breakingCount).toBe(0);
    expect(result.impact).toBe("minor");
  });

  it("treats a new required request property as breaking for writers", () => {
    const before = cloneDocument(petstore());
    const after = cloneDocument(petstore());
    const schema = after.paths!["/pets"]!.post!.requestBody as {
      content: Record<string, { schema: Schema }>;
    };
    schema.content["application/json"]!.schema.properties!.species = {
      type: "string",
      description: "Species.",
    };
    schema.content["application/json"]!.schema.required = ["name", "species"];

    const result = diffDocuments(before, after);
    expect(result.breakingCount).toBeGreaterThan(0);
  });

  it("treats removing an enum value as breaking and adding one as breaking for responses", () => {
    const after = cloneDocument(petstore());
    (after.components!.schemas!.Pet as Schema).properties!.status!.enum = [
      "available",
      "sold",
      "reserved",
    ];

    const result = diffDocuments(petstore(), after);
    const removed = result.changes.find((change) => /pending/.test(change.description));
    const added = result.changes.find((change) => /reserved/.test(change.description));
    expect(removed?.breaking).toBe(true);
    expect(added?.breaking).toBe(true);
  });

  it("treats introducing global authentication as breaking", () => {
    const before = cloneDocument(petstore());
    delete before.security;

    const result = diffDocuments(before, petstore());
    const change = result.changes.find((entry) => entry.category === "security");
    expect(change?.breaking).toBe(true);
  });

  it("treats removing a server as breaking", () => {
    const after = cloneDocument(petstore());
    after.servers = [];

    const result = diffDocuments(petstore(), after);
    expect(result.changes.some((change) => change.category === "server" && change.breaking)).toBe(
      true,
    );
  });

  it("flags an operationId rename as breaking for generated SDKs", () => {
    const after = cloneDocument(petstore());
    after.paths!["/pets"]!.get!.operationId = "getAllPets";

    const result = diffDocuments(petstore(), after);
    expect(
      result.changes.some(
        (change) => change.breaking && /operationId changed/.test(change.description),
      ),
    ).toBe(true);
  });

  it("classifies a documentation-only edit as a patch", () => {
    const after = cloneDocument(petstore());
    after.info!.description = "Updated prose.";

    const result = diffDocuments(petstore(), after);
    expect(result.impact).toBe("patch");
    expect(result.breakingCount).toBe(0);
  });
});

describe("nextVersionLabel", () => {
  it("bumps according to impact", () => {
    expect(nextVersionLabel("1.4.2", "major")).toBe("2.0.0");
    expect(nextVersionLabel("1.4.2", "minor")).toBe("1.5.0");
    expect(nextVersionLabel("1.4.2", "patch")).toBe("1.4.3");
    expect(nextVersionLabel("1.4.2", "none")).toBe("1.4.2");
  });

  it("leaves non-semver labels untouched", () => {
    expect(nextVersionLabel("2024-05-01", "major")).toBe("2024-05-01");
  });
});
