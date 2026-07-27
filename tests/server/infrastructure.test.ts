import { afterEach, describe, expect, it } from "vitest";
import { assertSafeUrl, isPrivateHost, sanitizeForwardHeaders } from "@/lib/server/ssrf";
import { consume, resetRateLimits, clientKey } from "@/lib/server/rate-limit";
import {
  contentHash,
  decryptSecret,
  encryptSecret,
  isEncrypted,
  safeEqual,
} from "@/lib/server/crypto";
import { redact } from "@/lib/server/logger";
import { capabilities, productionReadiness, resetEnvCache } from "@/lib/server/env";
import { newId, slugify } from "@/lib/utils/id";
import { err, isErr, isOk, mapOk, ok, unwrap } from "@/lib/utils/result";

afterEach(() => {
  resetRateLimits();
  resetEnvCache();
});

describe("SSRF policy", () => {
  it("identifies private and loopback hosts", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.5",
      "172.16.4.4",
      "169.254.169.254",
      "::1",
      "100.64.0.1",
    ]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });

  it("blocks cloud metadata and private targets when the policy forbids them", () => {
    const policy = { allowPrivateNetwork: false, allowedProtocols: ["http:", "https:"] };
    expect(assertSafeUrl("http://169.254.169.254/latest/meta-data/", policy).ok).toBe(false);
    expect(assertSafeUrl("http://localhost:8080/admin", policy).ok).toBe(false);
    expect(assertSafeUrl("https://api.example.com/v1", policy).ok).toBe(true);
  });

  it("rejects non-HTTP protocols and embedded credentials", () => {
    const policy = { allowPrivateNetwork: true, allowedProtocols: ["http:", "https:"] };
    expect(assertSafeUrl("file:///etc/passwd", policy).ok).toBe(false);
    expect(assertSafeUrl("gopher://example.com", policy).ok).toBe(false);
    expect(assertSafeUrl("https://user:pass@example.com", policy).ok).toBe(false);
    expect(assertSafeUrl("not a url", policy).ok).toBe(false);
  });

  it("strips hop-by-hop and identity headers before forwarding", () => {
    const sanitised = sanitizeForwardHeaders({
      Accept: "application/json",
      Host: "evil.example.com",
      Cookie: "session=1",
      "X-Forwarded-For": "1.2.3.4",
      Connection: "keep-alive",
      "X-Custom": "keep-me",
    });
    expect(sanitised).toEqual({ accept: "application/json", "x-custom": "keep-me" });
  });

  it("removes CR/LF to prevent header injection", () => {
    expect(sanitizeForwardHeaders({ "x-a": "value\r\nX-Injected: yes" })["x-a"]).toBe(
      "value X-Injected: yes",
    );
  });
});

describe("rate limiting", () => {
  it("allows requests up to the limit and then rejects", () => {
    const key = "test:bucket";
    for (let index = 0; index < 3; index += 1) {
      expect(consume(key, { limit: 3, windowMs: 1000, now: 0 }).allowed).toBe(true);
    }
    const blocked = consume(key, { limit: 3, windowMs: 1000, now: 0 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const key = "test:window";
    consume(key, { limit: 1, windowMs: 1000, now: 0 });
    expect(consume(key, { limit: 1, windowMs: 1000, now: 0 }).allowed).toBe(false);
    expect(consume(key, { limit: 1, windowMs: 1000, now: 2000 }).allowed).toBe(true);
  });

  it("derives a stable client key", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientKey(headers, "scope")).toBe("scope:ip:203.0.113.9");
    expect(clientKey(headers, "scope", "user_1")).toBe("scope:user:user_1");
    expect(clientKey(new Headers(), "scope")).toBe("scope:ip:anonymous");
  });
});

describe("crypto", () => {
  it("round-trips a secret", () => {
    const encrypted = encryptSecret("super-secret-value");
    expect(encrypted).not.toContain("super-secret-value");
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe("super-secret-value");
  });

  it("produces a different ciphertext each time", () => {
    expect(encryptSecret("a")).not.toBe(encryptSecret("a"));
  });

  it("rejects tampered payloads", () => {
    const encrypted = encryptSecret("value");
    const parts = encrypted.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    expect(() => decryptSecret("garbage")).toThrow(/Malformed/);
  });

  it("compares in constant time without leaking length errors", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("hashes content stably", () => {
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(contentHash("a")).toHaveLength(40);
  });
});

describe("logging", () => {
  it("redacts credential-shaped keys at any depth", () => {
    const redacted = redact({
      ok: "visible",
      authorization: "Bearer secret",
      nested: { apiKey: "k", deeper: { password: "p", fine: 1 } },
      list: [{ token: "t" }],
    }) as Record<string, unknown>;

    expect(redacted.ok).toBe("visible");
    expect(redacted.authorization).toBe("[redacted]");
    expect(JSON.stringify(redacted)).not.toContain("secret");
    expect(JSON.stringify(redacted)).not.toContain('"k"');
    expect(JSON.stringify(redacted)).not.toContain('"p"');
    expect(JSON.stringify(redacted)).not.toContain('"t"');
  });

  it("stops at a maximum depth", () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let index = 0; index < 12; index += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain("[max-depth]");
  });
});

describe("environment", () => {
  it("reports local capabilities with an empty environment", () => {
    const result = capabilities();
    expect(result.persistence).toBe("file");
    expect(result.auth).toBe("local");
    expect(result.ai).toBe("offline");
  });

  it("passes readiness in local mode", () => {
    expect(productionReadiness().ready).toBe(true);
  });

  it("fails readiness in production mode without hosted services", () => {
    process.env.APP_MODE = "production";
    resetEnvCache();
    const readiness = productionReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.problems.join(" ")).toContain("DATABASE_URL");
    process.env.APP_MODE = "local";
    resetEnvCache();
  });
});

describe("utils", () => {
  it("creates prefixed identifiers", () => {
    const id = newId("spec");
    expect(id.startsWith("spec_")).toBe(true);
    expect(newId("spec")).not.toBe(id);
  });

  it("slugifies titles", () => {
    expect(slugify("My Great API!")).toBe("my-great-api");
    expect(slugify("  --weird--  ")).toBe("weird");
  });

  it("models results as a discriminated union", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err("bad"))).toBe(true);
    expect(unwrap(ok(2))).toBe(2);
    expect(() => unwrap(err(new Error("nope")))).toThrow("nope");
    const mapped = mapOk(ok(2), (value) => value * 2);
    expect(mapped.ok && mapped.value).toBe(4);
  });
});
