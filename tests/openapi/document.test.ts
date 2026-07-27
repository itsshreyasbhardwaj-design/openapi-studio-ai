import { describe, expect, it } from "vitest";
import {
  cloneDocument,
  convertFormat,
  detectFormat,
  parseSpec,
  specVersionOf,
  stringifySpec,
} from "@/lib/core/openapi/document";
import { PETSTORE_YAML, petstore } from "../fixtures";

describe("detectFormat", () => {
  it("recognises JSON only when it actually parses as JSON", () => {
    expect(detectFormat('{"openapi":"3.1.0"}')).toBe("json");
    expect(detectFormat("openapi: 3.1.0")).toBe("yaml");
    // Looks like JSON but is not — YAML is the safe interpretation.
    expect(detectFormat("{openapi: 3.1.0}")).toBe("yaml");
  });
});

describe("parseSpec", () => {
  it("parses YAML documents", () => {
    const result = parseSpec(PETSTORE_YAML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe("yaml");
    expect(result.value.document.info?.title).toBe("Petstore");
  });

  it("parses JSON documents", () => {
    const result = parseSpec('{"openapi":"3.1.0","info":{"title":"J","version":"1"}}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe("json");
  });

  it("reports the failing line for malformed YAML", () => {
    const result = parseSpec("openapi: 3.1.0\ninfo:\n  title: A\n   bad: indent\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBeTruthy();
    expect(result.error.line).toBeGreaterThan(0);
  });

  it("rejects an empty document", () => {
    const result = parseSpec("   ");
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object root", () => {
    expect(parseSpec("- a\n- b").ok).toBe(false);
    expect(parseSpec("[1,2,3]").ok).toBe(false);
  });

  it("rejects duplicate keys", () => {
    const result = parseSpec("openapi: 3.1.0\ninfo: {}\ninfo: {}\n");
    expect(result.ok).toBe(false);
  });
});

describe("round-tripping", () => {
  it("survives YAML → document → YAML → document", () => {
    const first = petstore();
    const yaml = stringifySpec(first, "yaml");
    const second = parseSpec(yaml);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.document).toEqual(first);
  });

  it("converts between formats without losing meaning", () => {
    const json = convertFormat(PETSTORE_YAML, "json");
    expect(json.ok).toBe(true);
    if (!json.ok) return;

    const back = convertFormat(json.value, "yaml");
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    const original = parseSpec(PETSTORE_YAML);
    const restored = parseSpec(back.value);
    expect(original.ok && restored.ok).toBe(true);
    if (!original.ok || !restored.ok) return;
    expect(restored.value.document).toEqual(original.value.document);
  });

  it("returns the source unchanged when already in the target format", () => {
    const result = convertFormat(PETSTORE_YAML, "yaml");
    expect(result.ok && result.value).toBe(PETSTORE_YAML);
  });
});

describe("specVersionOf", () => {
  it("classifies supported versions", () => {
    expect(specVersionOf({ openapi: "3.1.0" })).toBe("3.1");
    expect(specVersionOf({ openapi: "3.0.3" })).toBe("3.0");
    expect(specVersionOf({ openapi: "2.0" })).toBe("unknown");
    expect(specVersionOf({})).toBe("unknown");
  });
});

describe("cloneDocument", () => {
  it("produces an independent copy", () => {
    const original = petstore();
    const copy = cloneDocument(original);
    copy.info!.title = "Changed";
    expect(original.info?.title).toBe("Petstore");
  });
});
