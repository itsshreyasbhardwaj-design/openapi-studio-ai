import { describe, expect, it } from "vitest";
import { synthesiseSpec } from "@/lib/core/ai/offline";
import { selectBlueprints } from "@/lib/core/ai/blueprint";
import { applyFixes, fixableCount, setAtPointer } from "@/lib/core/ai/autofix";
import { extractAndValidate, extractSpecSource } from "@/lib/core/ai/extract";
import { analyzeDocument, analyzeSource } from "@/lib/core/analysis";
import { stringifySpec } from "@/lib/core/openapi/document";
import { listOperations } from "@/lib/core/openapi/navigate";

describe("selectBlueprints", () => {
  it("matches domains by keyword", () => {
    expect(selectBlueprints("design an e-commerce order api").map((entry) => entry.id)).toContain(
      "orders",
    );
    expect(selectBlueprints("build a login and signup service").map((entry) => entry.id)).toContain(
      "auth",
    );
    expect(selectBlueprints("payment processing with refunds").map((entry) => entry.id)).toContain(
      "payments",
    );
  });

  it("falls back to a generic resource API", () => {
    expect(selectBlueprints("something entirely unrelated").map((entry) => entry.id)).toEqual([
      "generic",
    ]);
  });
});

describe("synthesiseSpec", () => {
  it("produces a structurally valid document with no provider key", () => {
    const { document } = synthesiseSpec("Design an e-commerce order API");
    const analysis = analyzeDocument(document);
    expect(analysis.valid).toBe(true);
    expect(analysis.summary.errors).toBe(0);
  });

  it("scores well on quality and security", () => {
    const { document } = synthesiseSpec("Design an e-commerce order API with payments");
    const analysis = analyzeDocument(document);
    expect(analysis.score).toBeGreaterThanOrEqual(80);
    expect(["A", "B"]).toContain(analysis.security.grade);
  });

  it("round-trips through YAML", () => {
    const { document } = synthesiseSpec("Create an authentication API");
    const result = analyzeSource(stringifySpec(document, "yaml"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.valid).toBe(true);
  });

  it("models CRUD plus domain actions", () => {
    const { document } = synthesiseSpec("Design an e-commerce order API");
    const operations = listOperations(document).map((entry) => `${entry.method} ${entry.path}`);
    expect(operations).toContain("get /orders");
    expect(operations).toContain("post /orders");
    expect(operations).toContain("get /orders/{orderId}");
    expect(operations).toContain("post /orders/{orderId}/refund");
  });

  it("applies platform conventions: auth, pagination, idempotency, rate limits", () => {
    const { document } = synthesiseSpec("Design an e-commerce order API");
    expect(document.security?.length).toBeGreaterThan(0);
    expect(document.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(document.components?.parameters?.Limit).toBeDefined();
    expect(document.components?.parameters?.IdempotencyKey).toBeDefined();
    expect(document.components?.responses?.rate_limited).toBeDefined();

    const create = document.paths?.["/orders"]?.post;
    expect(JSON.stringify(create?.parameters)).toContain("IdempotencyKey");
    expect(Object.keys(create?.responses ?? {})).toContain("429");
  });

  it("adds signed webhooks for domains that emit events", () => {
    const { document } = synthesiseSpec("Design an e-commerce order API");
    const webhook = document.webhooks?.["order.status_changed"];
    expect(webhook).toBeDefined();
    expect(JSON.stringify(webhook)).toContain("X-Signature");
  });

  it("issues auth endpoints for the authentication domain", () => {
    const { document } = synthesiseSpec("Create an authentication API with tokens");
    expect(document.paths?.["/auth/token"]).toBeDefined();
    expect(document.paths?.["/auth/token/refresh"]).toBeDefined();
    // Sign-in must be reachable without a token.
    expect(document.paths?.["/auth/token"]?.post?.security).toEqual([]);
  });

  it("derives a title from the brief and honours an explicit one", () => {
    expect(synthesiseSpec('Build the "Ledger Service" API').document.info?.title).toBe(
      "Ledger Service",
    );
    expect(synthesiseSpec("orders", { title: "Custom" }).document.info?.title).toBe("Custom");
  });

  it("is deterministic", () => {
    const first = stringifySpec(synthesiseSpec("Design a payments API").document, "yaml");
    const second = stringifySpec(synthesiseSpec("Design a payments API").document, "yaml");
    expect(first).toBe(second);
  });
});

describe("autofix", () => {
  it("writes values at a JSON Pointer, creating containers", () => {
    const target: Record<string, unknown> = {};
    expect(setAtPointer(target, "/info/contact/email", "a@example.com")).toBe(true);
    expect(target).toEqual({ info: { contact: { email: "a@example.com" } } });
  });

  it("refuses to write through a non-container", () => {
    const target = { info: "not-an-object" };
    expect(setAtPointer(target, "/info/title", "x")).toBe(false);
  });

  it("applies the fixes carried by diagnostics and raises the score", () => {
    const source = `openapi: 3.1.0
info:
  title: Bare
  version: 1.0.0
paths:
  /things:
    get:
      responses:
        "200":
          description: ok
`;
    const before = analyzeSource(source);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    expect(fixableCount(before.value.diagnostics)).toBeGreaterThan(0);

    const result = applyFixes(source, before.value.diagnostics);
    expect(result.applied.length).toBeGreaterThan(0);

    const after = analyzeSource(result.source);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.score).toBeGreaterThanOrEqual(before.value.score);
  });

  it("returns the source untouched when it cannot be parsed", () => {
    const result = applyFixes("::: not yaml :::", []);
    expect(result.applied).toEqual([]);
  });
});

describe("extractAndValidate", () => {
  it("strips markdown fences", () => {
    expect(extractSpecSource("Here you go:\n```yaml\nopenapi: 3.1.0\n```\nHope that helps.")).toBe(
      "openapi: 3.1.0",
    );
  });

  it("finds a YAML document after prose", () => {
    const source = extractSpecSource(
      "Certainly! Here is the spec.\n\nopenapi: 3.1.0\ninfo:\n  title: A\n",
    );
    expect(source.startsWith("openapi: 3.1.0")).toBe(true);
  });

  it("reports validation errors without throwing", () => {
    const result = extractAndValidate("openapi: 3.1.0\ninfo: {}\npaths: {}\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors.length).toBeGreaterThan(0);
  });

  it("fails cleanly on unparseable output", () => {
    expect(extractAndValidate("").ok).toBe(false);
    expect(extractAndValidate("openapi: 3.1.0\n  bad:\n indent\n").ok).toBe(false);
  });

  it("normalises the output to YAML", () => {
    const result = extractAndValidate(
      '{"openapi":"3.1.0","info":{"title":"A","version":"1.0.0"},"paths":{}}',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toContain("openapi: 3.1.0");
  });
});
