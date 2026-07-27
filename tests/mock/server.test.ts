import { describe, expect, it } from "vitest";
import { mockResponse } from "@/lib/core/mock/server";
import { examplePathFor, matchOperation } from "@/lib/core/mock/match";
import { listOperations } from "@/lib/core/openapi/navigate";
import { cloneDocument } from "@/lib/core/openapi/document";
import { petstore } from "../fixtures";

const authed = { authorization: "Bearer test-token" };

const request = (overrides: Partial<Parameters<typeof mockResponse>[1]> = {}) => ({
  method: "GET",
  path: "/pets",
  query: {},
  headers: authed,
  body: null,
  ...overrides,
});

describe("matchOperation", () => {
  it("matches templated paths and extracts parameters", () => {
    const match = matchOperation(petstore(), "GET", "/pets/pet_42");
    expect(match?.entry.operationId).toBe("getPet");
    expect(match?.pathParams).toEqual({ petId: "pet_42" });
  });

  it("prefers literal segments over templates", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets/featured"] = {
      get: { operationId: "featured", responses: { "200": { description: "ok" } } },
    };
    expect(matchOperation(document, "GET", "/pets/featured")?.entry.operationId).toBe("featured");
  });

  it("returns null when nothing matches", () => {
    expect(matchOperation(petstore(), "GET", "/unknown")).toBeNull();
    expect(matchOperation(petstore(), "DELETE", "/pets")).toBeNull();
  });

  it("builds a concrete example path", () => {
    const entry = listOperations(petstore()).find((item) => item.operationId === "getPet")!;
    expect(examplePathFor(entry)).toBe("/pets/123");
  });
});

describe("mockResponse", () => {
  it("returns the documented success response", () => {
    const result = mockResponse(petstore(), request());
    expect(result.status).toBe(200);
    expect(result.matched).toBe(true);
    expect(result.operationId).toBe("listPets");
    expect(result.headers["content-type"]).toContain("application/json");
    expect(() => JSON.parse(result.body)).not.toThrow();
  });

  it("404s an unmatched path", () => {
    const result = mockResponse(petstore(), request({ path: "/nope" }));
    expect(result.status).toBe(404);
    expect(result.matched).toBe(false);
  });

  it("401s when the security requirement is not satisfied", () => {
    const result = mockResponse(petstore(), request({ headers: {} }));
    expect(result.status).toBe(401);
    expect(result.headers["www-authenticate"]).toContain("Bearer");
  });

  it("skips the auth check when enforcement is disabled", () => {
    const result = mockResponse(petstore(), request({ headers: {} }), { enforceAuth: false });
    expect(result.status).toBe(200);
  });

  it("400s when a required parameter is absent", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets"]!.get!.parameters = [
      { name: "tenant", in: "query", required: true, schema: { type: "string" } },
    ];
    const result = mockResponse(document, request());
    expect(result.status).toBe(400);
    expect(result.body).toContain("query.tenant");
  });

  it("400s when a required body is missing", () => {
    const result = mockResponse(petstore(), request({ method: "POST", path: "/pets" }));
    expect(result.status).toBe(400);
    expect(result.body).toContain("body");
  });

  it("honours an explicitly requested status", () => {
    const result = mockResponse(petstore(), request(), { statusCode: "429" });
    expect(result.status).toBe(429);
  });

  it("returns a documented failure in the error scenario", () => {
    const result = mockResponse(petstore(), request(), { scenario: "error" });
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  it("prefers declared examples over generated data", () => {
    const result = mockResponse(petstore(), request({ path: "/pets/pet_1" }));
    expect(JSON.parse(result.body)).toMatchObject({ id: "pet_1", name: "Rex" });
  });

  it("is deterministic for the same seed", () => {
    const first = mockResponse(petstore(), request(), {
      seed: "fixed",
      preferDeclaredExamples: false,
    });
    const second = mockResponse(petstore(), request(), {
      seed: "fixed",
      preferDeclaredExamples: false,
    });
    expect(first.body).toBe(second.body);
  });

  it("carries the requested delay through to the caller", () => {
    const result = mockResponse(petstore(), request(), { delayMs: 250 });
    expect(result.delayMs).toBe(250);
  });

  it("explains why the response was chosen", () => {
    expect(mockResponse(petstore(), request()).explanation).toBeTruthy();
  });
});
