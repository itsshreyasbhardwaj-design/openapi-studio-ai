import { describe, expect, it } from "vitest";
import { validateDocument } from "@/lib/core/openapi/validate";
import { summarise } from "@/lib/core/openapi/diagnostics";
import type { OpenApiDocument } from "@/lib/core/openapi/types";
import { broken, petstore } from "../fixtures";

const rules = (document: OpenApiDocument): string[] =>
  validateDocument(document).map((diagnostic) => diagnostic.rule);

describe("validateDocument", () => {
  it("accepts a well-formed document", () => {
    const diagnostics = validateDocument(petstore());
    expect(summarise(diagnostics).errors).toBe(0);
  });

  it("requires the openapi version", () => {
    expect(rules({ info: { title: "A", version: "1" }, paths: {} })).toContain(
      "openapi-version-missing",
    );
  });

  it("rejects unsupported versions", () => {
    expect(
      rules({ openapi: "2.0", info: { title: "A", version: "1" }, paths: { "/a": {} } }),
    ).toContain("openapi-version-unsupported");
  });

  it("requires info.title and info.version", () => {
    const found = rules({
      openapi: "3.1.0",
      info: {},
      paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
    });
    expect(found).toContain("info-title-missing");
    expect(found).toContain("info-version-missing");
  });

  it("flags paths that do not start with a slash and missing responses", () => {
    const found = rules(broken());
    expect(found).toContain("path-missing-leading-slash");
    expect(found).toContain("operation-responses-missing");
  });

  it("detects duplicate operationIds", () => {
    expect(rules(broken())).toContain("operation-id-duplicate");
  });

  it("rejects invalid response codes", () => {
    expect(rules(broken())).toContain("response-code-invalid");
  });

  it("requires a description on every response", () => {
    expect(rules(broken())).toContain("response-description-missing");
  });

  it("requires path parameters to be declared and required", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: {
        "/orders/{orderId}": {
          get: {
            responses: { "200": { description: "ok" } },
            parameters: [
              { name: "other", in: "path", required: false, schema: { type: "string" } },
            ],
          },
        },
      },
    };
    const found = rules(document);
    expect(found).toContain("path-parameter-undeclared");
    expect(found).toContain("path-parameter-not-required");
    expect(found).toContain("path-parameter-unused");
  });

  it("detects duplicate parameters", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: {
        "/a": {
          get: {
            responses: { "200": { description: "ok" } },
            parameters: [
              { name: "q", in: "query", schema: { type: "string" } },
              { name: "q", in: "query", schema: { type: "string" } },
            ],
          },
        },
      },
    };
    expect(rules(document)).toContain("parameter-duplicate");
  });

  it("reports unresolvable references", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: {
        "/a": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/Missing" } },
                },
              },
            },
          },
        },
      },
    };
    expect(rules(document)).toContain("reference-unresolvable");
  });

  it("warns about external references instead of fetching them", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: {
        "/a": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": { schema: { $ref: "https://example.com/schema.json" } },
                },
              },
            },
          },
        },
      },
    };
    const diagnostics = validateDocument(document);
    const external = diagnostics.find((item) => item.rule === "external-reference");
    expect(external?.severity).toBe("warning");
  });

  it("requires declared security schemes to exist", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      security: [{ nope: [] }],
      paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
    };
    expect(rules(document)).toContain("security-requirement-undefined");
  });

  it("validates security scheme shapes", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
      components: {
        securitySchemes: {
          key: { type: "apiKey" },
          basic: { type: "http" },
          oauth: { type: "oauth2" },
        },
      },
    };
    const found = rules(document);
    expect(found).toContain("security-scheme-apikey-incomplete");
    expect(found).toContain("security-scheme-http-incomplete");
    expect(found).toContain("security-scheme-oauth2-incomplete");
  });

  it("rejects invalid schema constructs", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
      components: {
        schemas: {
          Bad: {
            type: "widget" as never,
            required: ["missing"],
            properties: { present: { type: "string" } },
            minimum: 10,
            maximum: 1,
            pattern: "([",
          },
        },
      },
    };
    const found = rules(document);
    expect(found).toContain("schema-type-invalid");
    expect(found).toContain("schema-required-unknown-property");
    expect(found).toContain("schema-range-inverted");
    expect(found).toContain("schema-pattern-invalid");
  });

  it("rejects webhooks in 3.0 documents", () => {
    const document: OpenApiDocument = {
      openapi: "3.0.3",
      info: { title: "A", version: "1.0.0" },
      paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
      webhooks: { event: { post: { responses: { "200": { description: "ok" } } } } },
    };
    expect(rules(document)).toContain("webhooks-unsupported-in-30");
  });

  it("carries machine-applicable fixes on common findings", () => {
    const diagnostics = validateDocument({ openapi: "3.1.0", info: {}, paths: {} });
    const titleFix = diagnostics.find((item) => item.rule === "info-title-missing");
    expect(titleFix?.fix?.pointer).toBe("/info/title");
    expect(titleFix?.fix?.value).toBe("Untitled API");
  });
});
