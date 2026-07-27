import { describe, expect, it } from "vitest";
import { analyzeSecurity, securityDiagnostics } from "@/lib/core/security/analyze";
import { cloneDocument } from "@/lib/core/openapi/document";
import type { OpenApiDocument } from "@/lib/core/openapi/types";
import { petstore } from "../fixtures";

const ids = (document: OpenApiDocument): string[] =>
  analyzeSecurity(document).findings.map((finding) => finding.id);

describe("analyzeSecurity", () => {
  it("grades a well-secured API highly", () => {
    const report = analyzeSecurity(petstore());
    expect(report.summary.critical).toBe(0);
    expect(report.summary.high).toBe(0);
    expect(["A", "B"]).toContain(report.grade);
  });

  it("flags an API with no authentication at all", () => {
    const document = cloneDocument(petstore());
    delete document.security;
    delete document.components?.securitySchemes;

    const report = analyzeSecurity(document);
    expect(report.findings.some((finding) => finding.id === "no-authentication-declared")).toBe(
      true,
    );
    expect(report.summary.critical).toBeGreaterThan(0);
    expect(report.grade).not.toBe("A");
  });

  it("flags unauthenticated write operations", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets"]!.post!.security = [];
    expect(ids(document)).toContain("unsecured-write-operation");
  });

  it("flags API keys carried in the query string", () => {
    const document = cloneDocument(petstore());
    document.components!.securitySchemes!.legacy = { type: "apiKey", in: "query", name: "api_key" };
    expect(ids(document)).toContain("weak-security-scheme");
  });

  it("flags the OAuth implicit flow", () => {
    const document = cloneDocument(petstore());
    document.components!.securitySchemes!.oauth = {
      type: "oauth2",
      flows: {
        implicit: { authorizationUrl: "https://example.com/auth", scopes: { read: "Read" } },
      },
    };
    const report = analyzeSecurity(document);
    expect(report.findings.some((finding) => /implicit/.test(finding.detail))).toBe(true);
  });

  it("flags plaintext HTTP servers but not localhost", () => {
    const insecure = cloneDocument(petstore());
    insecure.servers = [{ url: "http://api.example.com/v1" }];
    expect(ids(insecure)).toContain("insecure-transport");

    const local = cloneDocument(petstore());
    local.servers = [{ url: "http://localhost:3000" }];
    expect(ids(local)).not.toContain("insecure-transport");
  });

  it("flags credentials embedded in a server URL", () => {
    const document = cloneDocument(petstore());
    document.servers = [{ url: "https://user:pass@api.example.com" }];
    expect(ids(document)).toContain("credentials-in-server-url");
  });

  it("flags mass-assignment exposure on write bodies", () => {
    const document = cloneDocument(petstore());
    const body = document.paths!["/pets"]!.post!.requestBody as {
      content: Record<string, { schema: { additionalProperties?: boolean } }>;
    };
    delete body.content["application/json"]!.schema.additionalProperties;
    expect(ids(document)).toContain("mass-assignment-risk");
  });

  it("flags sensitive fields that are readable", () => {
    const document = cloneDocument(petstore());
    document.components!.schemas!.Pet!.properties!.password = {
      type: "string",
      description: "Owner password.",
    };
    expect(ids(document)).toContain("sensitive-field-readable");
  });

  it("does not treat 'shippingAddress' as a sensitive PIN field", () => {
    const document = cloneDocument(petstore());
    document.components!.schemas!.Pet!.properties!.shippingAddress = {
      type: "string",
      description: "Where the pet ships.",
      maxLength: 200,
    };
    expect(ids(document)).not.toContain("sensitive-field-readable");
  });

  it("flags sensitive data carried in the URL", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets"]!.get!.parameters = [
      { name: "api_key", in: "query", description: "Key.", schema: { type: "string" } },
    ];
    expect(ids(document)).toContain("sensitive-data-exposure");
  });

  it("flags a missing rate-limit contract", () => {
    const document = cloneDocument(petstore());
    for (const path of Object.values(document.paths ?? {})) {
      for (const operation of Object.values(path)) {
        if (operation && typeof operation === "object" && "responses" in operation) {
          delete (operation.responses as Record<string, unknown>)["429"];
        }
      }
    }
    expect(ids(document)).toContain("no-rate-limiting-documented");
  });

  it("flags webhooks without signature verification", () => {
    const document = cloneDocument(petstore());
    document.webhooks = {
      "pet.created": {
        post: { operationId: "onPetCreated", responses: { "200": { description: "ok" } } },
      },
    };
    expect(ids(document)).toContain("webhook-without-verification");
  });

  it("survives a malformed document without throwing", () => {
    expect(() => analyzeSecurity({ paths: { "/a": null } } as never)).not.toThrow();
  });

  it("maps findings onto editor diagnostics", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets"]!.post!.security = [];

    const diagnostics = securityDiagnostics(analyzeSecurity(document));
    const critical = diagnostics.find((item) => item.rule === "unsecured-write-operation");
    expect(critical?.severity).toBe("error");
    expect(critical?.source).toBe("security");
    expect(critical?.hint).toBeTruthy();
  });

  it("applies diminishing returns so many low findings cannot alone force an F", () => {
    const document: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "A", version: "1.0.0" },
      security: [{ bearerAuth: [] }],
      servers: [{ url: "https://api.example.com" }],
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      },
      paths: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `/thing-${index}`,
          {
            post: {
              operationId: `create${index}`,
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        note: { type: "string", description: "Unbounded on purpose." },
                      },
                    },
                  },
                },
              },
              responses: { "200": { description: "ok" }, "429": { description: "limited" } },
            },
          },
        ]),
      ),
    };

    const report = analyzeSecurity(document);
    expect(report.summary.low).toBeGreaterThan(8);
    expect(report.score).toBeGreaterThan(45);
  });
});
