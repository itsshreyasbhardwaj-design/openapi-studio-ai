import { RefResolver } from "./deref";
import { isReference, type Json, type OpenApiDocument, type Schema } from "./types";

/**
 * Deterministic pseudo-random generator (mulberry32).
 *
 * Determinism matters: the mock server, the documentation preview and the SDK
 * examples must all show the *same* payload for the same schema, otherwise
 * snapshot tests and screenshots churn on every run.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const FIRST_NAMES = ["Ada", "Grace", "Linus", "Rin", "Noor", "Kai", "Ines", "Omar", "Yuki", "Sam"];
const LAST_NAMES = [
  "Lovelace",
  "Hopper",
  "Torvalds",
  "Okafor",
  "Haddad",
  "Nakamura",
  "Silva",
  "Novak",
];
const WORDS = [
  "orbit",
  "signal",
  "atlas",
  "vector",
  "harbor",
  "lumen",
  "cobalt",
  "ember",
  "quartz",
  "meridian",
];
const COMPANIES = ["Northwind", "Acme", "Globex", "Initech", "Umbrella", "Soylent", "Hooli"];

export interface ExampleOptions {
  /** Seed source; identical seeds produce identical payloads. */
  readonly seed?: string;
  /** Prefer `example`/`examples` declared in the schema. Default: true. */
  readonly preferDeclared?: boolean;
  /** Number of items generated for arrays without `minItems`. Default: 2. */
  readonly arrayLength?: number;
  readonly maxDepth?: number;
  /** Emit `null` for nullable fields occasionally (used by fuzz-style mocks). */
  readonly allowNull?: boolean;
}

interface GenCtx {
  readonly random: () => number;
  readonly resolver: RefResolver;
  readonly options: Required<Omit<ExampleOptions, "seed">>;
}

function pick<T>(random: () => number, items: readonly T[], fallback: T): T {
  if (items.length === 0) return fallback;
  return items[Math.floor(random() * items.length)] ?? fallback;
}

function stringForFormat(format: string | undefined, name: string, ctx: GenCtx): string {
  const { random } = ctx;
  const word = pick(random, WORDS, "sample");
  switch (format) {
    case "date-time":
      return new Date(Date.UTC(2025, 0, 15, 9, 30, 0)).toISOString();
    case "date":
      return "2025-01-15";
    case "time":
      return "09:30:00";
    case "email":
      return `${pick(random, FIRST_NAMES, "ada").toLowerCase()}@example.com`;
    case "hostname":
      return "api.example.com";
    case "ipv4":
      return "203.0.113.7";
    case "ipv6":
      return "2001:db8::7";
    case "uri":
    case "url":
    case "uri-reference":
      return "https://example.com/resource";
    case "uuid":
      return "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    case "byte":
      return "T3BlbkFQSSBTdHVkaW8=";
    case "binary":
      return "<binary>";
    case "password":
      return "correct-horse-battery-staple";
    default:
      break;
  }

  const lower = name.toLowerCase();
  if (lower.includes("email"))
    return `${pick(random, FIRST_NAMES, "ada").toLowerCase()}@example.com`;
  if (lower.endsWith("id") || lower === "id")
    return `${lower.replace(/id$/, "") || "obj"}_${Math.floor(random() * 8999 + 1000)}`;
  if (lower.includes("name")) {
    return lower.includes("last")
      ? pick(random, LAST_NAMES, "Hopper")
      : lower.includes("company") || lower.includes("org")
        ? pick(random, COMPANIES, "Acme")
        : pick(random, FIRST_NAMES, "Ada");
  }
  if (lower.includes("url") || lower.includes("link")) return "https://example.com/resource";
  if (lower.includes("phone")) return "+1-202-555-0142";
  if (lower.includes("currency")) return "USD";
  if (lower.includes("country")) return "US";
  if (lower.includes("status") || lower.includes("state")) return "active";
  if (lower.includes("token") || lower.includes("secret") || lower.includes("key")) {
    return "sk_test_51H8xExampleKeyDoNotUse";
  }
  if (lower.includes("description") || lower.includes("summary") || lower.includes("message")) {
    return `A short ${word} description.`;
  }
  return word;
}

function clampNumber(schema: Schema, value: number): number {
  let out = value;
  if (typeof schema.minimum === "number") out = Math.max(schema.minimum, out);
  if (typeof schema.maximum === "number") out = Math.min(schema.maximum, out);
  if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
    out = Math.round(out / schema.multipleOf) * schema.multipleOf;
  }
  return out;
}

function generate(schema: Schema | undefined, name: string, depth: number, ctx: GenCtx): Json {
  if (!schema || depth > ctx.options.maxDepth) return null;

  const resolved = isReference(schema) ? ctx.resolver.tryResolve<Schema>(schema) : schema;
  if (!resolved) return null;

  if (ctx.options.preferDeclared) {
    if (resolved.example !== undefined) return resolved.example as Json;
    if (Array.isArray(resolved.examples) && resolved.examples.length > 0) {
      return resolved.examples[0] as Json;
    }
    if (resolved.default !== undefined) return resolved.default as Json;
  }
  if (resolved.const !== undefined) return resolved.const as Json;
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return pick(ctx.random, resolved.enum, resolved.enum[0]) as Json;
  }

  if (resolved.allOf?.length) {
    const merged: Record<string, Json> = {};
    for (const part of resolved.allOf) {
      const value = generate(part, name, depth + 1, ctx);
      if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(merged, value);
    }
    return merged;
  }
  const union = resolved.oneOf ?? resolved.anyOf;
  if (union?.length) return generate(union[0], name, depth + 1, ctx);

  const types = Array.isArray(resolved.type) ? resolved.type : resolved.type ? [resolved.type] : [];
  const nullable = resolved.nullable === true || types.includes("null");
  if (nullable && ctx.options.allowNull && ctx.random() < 0.2) return null;

  const primary = types.find((type) => type !== "null");
  const effective =
    primary ?? (resolved.properties ? "object" : resolved.items ? "array" : "string");

  switch (effective) {
    case "object": {
      const out: Record<string, Json> = {};
      const properties = Object.entries(resolved.properties ?? {});
      for (const [key, child] of properties) {
        const childSchema = isReference(child) ? ctx.resolver.tryResolve<Schema>(child) : child;
        if (childSchema?.writeOnly && depth > 0) continue;
        out[key] = generate(child, key, depth + 1, ctx);
      }
      if (properties.length === 0 && typeof resolved.additionalProperties === "object") {
        out[pick(ctx.random, WORDS, "key")] = generate(
          resolved.additionalProperties,
          "value",
          depth + 1,
          ctx,
        );
      }
      return out;
    }
    case "array": {
      const min = resolved.minItems ?? ctx.options.arrayLength;
      const max = resolved.maxItems ?? Math.max(min, ctx.options.arrayLength);
      const count = Math.max(0, Math.min(min, max, 25));
      const items: Json[] = [];
      for (let index = 0; index < count; index += 1) {
        items.push(generate(resolved.items, name, depth + 1, ctx));
      }
      return items;
    }
    case "integer": {
      const base = Math.floor(ctx.random() * 900) + 100;
      return Math.round(clampNumber(resolved, base));
    }
    case "number": {
      const base = Math.round((ctx.random() * 900 + 10) * 100) / 100;
      return Math.round(clampNumber(resolved, base) * 100) / 100;
    }
    case "boolean":
      return ctx.random() > 0.35;
    case "string":
    default: {
      let value = stringForFormat(resolved.format, name, ctx);
      if (typeof resolved.minLength === "number" && value.length < resolved.minLength) {
        value = value.padEnd(resolved.minLength, "x");
      }
      if (typeof resolved.maxLength === "number" && value.length > resolved.maxLength) {
        value = value.slice(0, resolved.maxLength);
      }
      return value;
    }
  }
}

/** Generate a deterministic example payload for a schema. */
export function exampleFromSchema(
  schema: Schema | undefined,
  document: OpenApiDocument,
  options: ExampleOptions = {},
): Json {
  const ctx: GenCtx = {
    random: createRandom(hashSeed(options.seed ?? "openapi-studio")),
    resolver: new RefResolver(document),
    options: {
      preferDeclared: options.preferDeclared ?? true,
      arrayLength: options.arrayLength ?? 2,
      maxDepth: options.maxDepth ?? 8,
      allowNull: options.allowNull ?? false,
    },
  };
  return generate(schema, "value", 0, ctx);
}

/** Pretty-printed JSON example, ready to drop into a code block. */
export function exampleJson(
  schema: Schema | undefined,
  document: OpenApiDocument,
  options: ExampleOptions = {},
): string {
  return JSON.stringify(exampleFromSchema(schema, document, options), null, 2);
}

/** Generate a plausible value for a parameter, used to prefill the Try It console. */
export function exampleForParameter(
  schema: Schema | undefined,
  name: string,
  document: OpenApiDocument,
  seed = "param",
): string {
  const value = exampleFromSchema(schema, document, { seed: `${seed}:${name}` });
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
