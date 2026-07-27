import { describe, expect, it } from "vitest";
import { lintDocument } from "@/lib/core/openapi/lint";
import {
  documentStats,
  groupByTag,
  listOperations,
  synthesiseOperationId,
} from "@/lib/core/openapi/navigate";
import {
  exampleFromSchema,
  exampleJson,
  createRandom,
  hashSeed,
} from "@/lib/core/openapi/examples";
import {
  extend,
  parsePointer,
  pointer,
  describePointer,
  resolvePointer,
} from "@/lib/core/openapi/pointer";
import { cloneDocument } from "@/lib/core/openapi/document";
import type { OpenApiDocument } from "@/lib/core/openapi/types";
import { petstore } from "../fixtures";

const ruleIds = (document: OpenApiDocument): string[] =>
  lintDocument(document).map((diagnostic) => diagnostic.rule);

describe("lintDocument", () => {
  it("does not complain about a well-documented API's essentials", () => {
    const found = ruleIds(petstore());
    expect(found).not.toContain("operation-summary-missing");
    expect(found).not.toContain("operation-id-missing");
    expect(found).not.toContain("servers-missing");
  });

  it("flags missing summaries, operationIds and tags", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
    };
    const found = ruleIds(document);
    expect(found).toContain("operation-summary-missing");
    expect(found).toContain("operation-id-missing");
    expect(found).toContain("operation-tags-missing");
    expect(found).toContain("servers-missing");
  });

  it("flags operations with no error responses", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: { "/a": { get: { operationId: "a", responses: { "200": { description: "ok" } } } } },
    };
    const found = ruleIds(document);
    expect(found).toContain("operation-missing-4xx");
    expect(found).toContain("operation-missing-5xx");
  });

  it("flags unbounded collection endpoints", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            operationId: "listItems",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": { schema: { type: "array", items: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    };
    expect(ruleIds(document)).toContain("collection-missing-pagination");
  });

  it("does not flag paginated collections", () => {
    expect(ruleIds(petstore())).not.toContain("collection-missing-pagination");
  });

  it("flags inconsistent path naming", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pet-groups"] = {
      get: { operationId: "a", responses: { "200": { description: "ok" } } },
    };
    document.paths!["/petGroups"] = {
      get: { operationId: "b", responses: { "200": { description: "ok" } } },
    };
    expect(ruleIds(document)).toContain("path-naming-inconsistent");
  });

  it("flags trailing slashes", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets/"] = {
      get: { operationId: "z", responses: { "200": { description: "ok" } } },
    };
    expect(ruleIds(document)).toContain("path-trailing-slash");
  });

  it("flags unused components", () => {
    const document = cloneDocument(petstore());
    document.components!.schemas!.Orphan = { type: "object", description: "Unused." };
    expect(ruleIds(document)).toContain("component-unused");
  });

  it("flags a non-semver version", () => {
    const document = cloneDocument(petstore());
    document.info!.version = "v2";
    expect(ruleIds(document)).toContain("info-version-not-semver");
  });
});

describe("navigate", () => {
  it("flattens operations with merged path-level parameters", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets"]!.parameters = [
      { name: "tenant", in: "header", required: true, schema: { type: "string" } },
    ];

    const operations = listOperations(document);
    const list = operations.find((entry) => entry.operationId === "listPets");
    expect(list?.parameters.map((parameter) => parameter.name)).toContain("tenant");
    expect(list?.parameters.map((parameter) => parameter.name)).toContain("limit");
  });

  it("lets operation-level parameters win over path-level ones", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets"]!.parameters = [
      {
        name: "limit",
        in: "query",
        required: true,
        description: "inherited",
        schema: { type: "integer" },
      },
    ];
    const list = listOperations(document).find((entry) => entry.operationId === "listPets");
    const limit = list?.parameters.find((parameter) => parameter.name === "limit");
    expect(limit?.description).toBe("Page size.");
  });

  it("synthesises stable operation ids", () => {
    expect(synthesiseOperationId("get", "/orders/{orderId}/items")).toBe("getOrdersByOrderIdItems");
    expect(synthesiseOperationId("post", "/")).toBe("postRoot");
  });

  it("groups by tag with a Default bucket", () => {
    const document = cloneDocument(petstore());
    document.paths!["/untagged"] = {
      get: { operationId: "u", responses: { "200": { description: "ok" } } },
    };
    const groups = groupByTag(listOperations(document));
    expect(groups.map((group) => group.tag)).toContain("Default");
    expect(groups.map((group) => group.tag)).toContain("Pets");
  });

  it("computes document statistics", () => {
    const stats = documentStats(petstore());
    expect(stats.operations).toBe(3);
    expect(stats.paths).toBe(2);
    expect(stats.schemas).toBe(1);
    expect(stats.securitySchemes).toBe(1);
    expect(stats.documentedOperations).toBe(3);
  });
});

describe("pointer", () => {
  it("escapes and unescapes tokens", () => {
    expect(pointer("paths", "/pets", "get")).toBe("/paths/~1pets/get");
    expect(parsePointer("/paths/~1pets/get")).toEqual(["paths", "/pets", "get"]);
  });

  it("extends pointers", () => {
    expect(extend(pointer("paths"), "/pets", "get")).toBe("/paths/~1pets/get");
    expect(extend("", "info")).toBe("/info");
  });

  it("resolves pointers into a document", () => {
    expect(resolvePointer(petstore(), "/info/title")).toBe("Petstore");
    expect(resolvePointer(petstore(), "/paths/~1pets/get/operationId")).toBe("listPets");
    expect(resolvePointer(petstore(), "/nope/nope")).toBeUndefined();
  });

  it("describes pointers for humans", () => {
    expect(describePointer("")).toBe("document root");
    expect(describePointer("/paths/~1pets/get")).toBe("paths › /pets › get");
  });
});

describe("examples", () => {
  it("is deterministic for a given seed", () => {
    const document = petstore();
    const schema = document.components!.schemas!.Pet!;
    expect(exampleJson(schema, document, { seed: "a" })).toBe(
      exampleJson(schema, document, { seed: "a" }),
    );
  });

  it("respects enums, formats and declared examples", () => {
    const document = petstore();
    const value = exampleFromSchema(document.components!.schemas!.Pet, document, {
      seed: "x",
    }) as Record<string, unknown>;
    expect(["available", "pending", "sold"]).toContain(value.status);
    expect(typeof value.id).toBe("string");
  });

  it("honours minItems and maxItems", () => {
    const document: OpenApiDocument = { openapi: "3.1.0" };
    const value = exampleFromSchema(
      { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
      document,
    );
    expect(Array.isArray(value) && value.length).toBe(3);
  });

  it("clamps numbers into range", () => {
    const value = exampleFromSchema(
      { type: "integer", minimum: 5, maximum: 7 },
      { openapi: "3.1.0" },
    );
    expect(Number(value)).toBeGreaterThanOrEqual(5);
    expect(Number(value)).toBeLessThanOrEqual(7);
  });

  it("terminates on recursive schemas", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              child: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    };
    expect(() =>
      exampleFromSchema({ $ref: "#/components/schemas/Node" }, document, { maxDepth: 4 }),
    ).not.toThrow();
  });

  it("produces a stable pseudo-random sequence", () => {
    const a = createRandom(hashSeed("seed"));
    const b = createRandom(hashSeed("seed"));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
