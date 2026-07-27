import { RefResolver, collectRefs } from "./deref";
import type { Diagnostic } from "./diagnostics";
import { listOperations } from "./navigate";
import { extend, pointer } from "./pointer";
import {
  isReference,
  type MediaType,
  type OpenApiDocument,
  type OperationEntry,
  type Schema,
} from "./types";

const PAGINATION_HINTS = [
  "limit",
  "offset",
  "page",
  "per_page",
  "perpage",
  "cursor",
  "after",
  "before",
  "size",
];
const SEMVER = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

/**
 * Quality linter — the "suggest improvements" half of specification analysis.
 *
 * Where {@link validateDocument} answers *"is this a legal OpenAPI document?"*,
 * the linter answers *"is this a good API contract?"*: documentation coverage,
 * examples, error modelling, pagination, naming consistency and dead weight.
 */
export function lintDocument(document: OpenApiDocument): Diagnostic[] {
  const out: Diagnostic[] = [];
  const resolver = new RefResolver(document);
  const operations = listOperations(document);

  lintInfo(document, out);
  lintServers(document, out);
  for (const entry of operations) lintOperation(document, entry, resolver, out);
  lintNamingConsistency(operations, out);
  lintUnusedComponents(document, out);
  lintSchemas(document, out);

  return out;
}

function lintInfo(document: OpenApiDocument, out: Diagnostic[]): void {
  const info = document.info;
  if (!info) return;

  if (!info.description) {
    out.push({
      rule: "info-description-missing",
      source: "quality",
      severity: "warning",
      message: "The API has no description. Consumers see this first in generated documentation.",
      pointer: pointer("info", "description"),
      hint: "Explain what the API does, who it is for, and any global conventions.",
      fix: {
        pointer: pointer("info", "description"),
        value: "Describe what this API does and how to get started.",
        label: "Add a description placeholder",
      },
    });
  }
  if (!info.contact?.email && !info.contact?.url) {
    out.push({
      rule: "info-contact-missing",
      source: "quality",
      severity: "info",
      message: "No contact details are published for this API.",
      pointer: pointer("info", "contact"),
      hint: "Add `info.contact.email` or `info.contact.url` so consumers know where to ask for help.",
    });
  }
  if (!info.license?.name) {
    out.push({
      rule: "info-license-missing",
      source: "quality",
      severity: "info",
      message: "No license is declared for this API description.",
      pointer: pointer("info", "license"),
    });
  }
  if (info.version && !SEMVER.test(info.version)) {
    out.push({
      rule: "info-version-not-semver",
      source: "quality",
      severity: "info",
      message: `Version "${info.version}" is not semantic versioning, which makes change impact harder to communicate.`,
      pointer: pointer("info", "version"),
      hint: "Use MAJOR.MINOR.PATCH so breaking changes are unambiguous.",
    });
  }
}

function lintServers(document: OpenApiDocument, out: Diagnostic[]): void {
  const servers = document.servers ?? [];
  if (servers.length === 0) {
    out.push({
      rule: "servers-missing",
      source: "quality",
      severity: "warning",
      message: "No servers are declared, so tooling cannot infer a base URL.",
      pointer: pointer("servers"),
      fix: {
        pointer: pointer("servers"),
        value: [{ url: "https://api.example.com/v1", description: "Production" }],
        label: "Add a production server",
      },
    });
    return;
  }
  servers.forEach((server, index) => {
    if (!server.description) {
      out.push({
        rule: "server-description-missing",
        source: "quality",
        severity: "info",
        message: "Server entries are clearer with a description such as “Production” or “Sandbox”.",
        pointer: extend(pointer("servers"), index, "description"),
      });
    }
  });
}

function hasExample(media: MediaType | undefined, resolver: RefResolver): boolean {
  if (!media) return false;
  if (media.example !== undefined) return true;
  if (media.examples && Object.keys(media.examples).length > 0) return true;
  const schema = media.schema ? resolver.tryResolve<Schema>(media.schema) : null;
  return Boolean(schema && (schema.example !== undefined || (schema.examples?.length ?? 0) > 0));
}

function lintOperation(
  document: OpenApiDocument,
  entry: OperationEntry,
  resolver: RefResolver,
  out: Diagnostic[],
): void {
  const { operation, pointer: at, path, method } = entry;

  if (!operation.summary) {
    out.push({
      rule: "operation-summary-missing",
      source: "quality",
      severity: "warning",
      message: `${method.toUpperCase()} ${path} has no summary.`,
      pointer: extend(at, "summary"),
      hint: "A one-line summary becomes the heading in generated documentation and SDK doc comments.",
    });
  }
  if (!operation.description) {
    out.push({
      rule: "operation-description-missing",
      source: "quality",
      severity: "info",
      message: `${method.toUpperCase()} ${path} has no description.`,
      pointer: extend(at, "description"),
    });
  }
  if (!operation.operationId) {
    out.push({
      rule: "operation-id-missing",
      source: "quality",
      severity: "warning",
      message: `${method.toUpperCase()} ${path} has no operationId, so generated SDK method names are unstable.`,
      pointer: extend(at, "operationId"),
      fix: {
        pointer: extend(at, "operationId"),
        value: entry.operationId,
        label: `Set operationId`,
      },
    });
  }
  if (entry.tags.length === 0) {
    out.push({
      rule: "operation-tags-missing",
      source: "quality",
      severity: "info",
      message: `${method.toUpperCase()} ${path} is untagged and will fall into the "Default" group.`,
      pointer: extend(at, "tags"),
    });
  }

  const codes = Object.keys(operation.responses ?? {});
  const has = (prefix: string): boolean => codes.some((code) => code.startsWith(prefix));

  if (!has("4") && !codes.includes("default")) {
    out.push({
      rule: "operation-missing-4xx",
      source: "quality",
      severity: "warning",
      message: `${method.toUpperCase()} ${path} documents no client-error response.`,
      pointer: extend(at, "responses"),
      hint: "Document at least 400 and, where relevant, 404 so clients can handle failures.",
      fix: {
        pointer: extend(at, "responses", "400"),
        value: { description: "The request was invalid." },
        label: "Add a 400 response",
      },
    });
  }
  if (!has("5") && !codes.includes("default")) {
    out.push({
      rule: "operation-missing-5xx",
      source: "quality",
      severity: "info",
      message: `${method.toUpperCase()} ${path} documents no server-error response.`,
      pointer: extend(at, "responses"),
      fix: {
        pointer: extend(at, "responses", "500"),
        value: { description: "Unexpected server error." },
        label: "Add a 500 response",
      },
    });
  }

  const secured = (operation.security ?? document.security ?? []).length > 0;
  if (secured && !codes.includes("429")) {
    out.push({
      rule: "operation-missing-429",
      source: "quality",
      severity: "info",
      message: `${method.toUpperCase()} ${path} is authenticated but documents no 429 rate-limit response.`,
      pointer: extend(at, "responses"),
      hint: "Publishing 429 alongside Retry-After lets clients back off correctly.",
      fix: {
        pointer: extend(at, "responses", "429"),
        value: {
          description: "Too many requests.",
          headers: {
            "Retry-After": { schema: { type: "integer" }, description: "Seconds to wait." },
          },
        },
        label: "Add a 429 response",
      },
    });
  }

  // Success responses should carry a schema and an example.
  for (const [code, rawResponse] of Object.entries(operation.responses ?? {})) {
    if (!code.startsWith("2")) continue;
    const response = resolver.tryResolve<{ content?: Record<string, MediaType> }>(rawResponse);
    const content = response?.content ?? {};
    const mediaEntries = Object.entries(content);
    if (mediaEntries.length === 0) {
      if (code !== "204" && method !== "delete" && method !== "head") {
        out.push({
          rule: "response-2xx-no-content",
          source: "quality",
          severity: "info",
          message: `${method.toUpperCase()} ${path} → ${code} returns no documented body.`,
          pointer: extend(at, "responses", code),
        });
      }
      continue;
    }
    for (const [mediaType, media] of mediaEntries) {
      const mediaAt = extend(at, "responses", code, "content", mediaType);
      if (!media?.schema) {
        out.push({
          rule: "response-schema-missing",
          source: "quality",
          severity: "warning",
          message: `${method.toUpperCase()} ${path} → ${code} (${mediaType}) has no schema, so no types can be generated.`,
          pointer: mediaAt,
        });
      }
      if (!hasExample(media, resolver)) {
        out.push({
          rule: "response-example-missing",
          source: "quality",
          severity: "info",
          message: `${method.toUpperCase()} ${path} → ${code} has no example payload.`,
          pointer: mediaAt,
          hint: "Examples power the documentation preview, the mock server and the Try It console.",
        });
      }
    }
  }

  if (operation.requestBody) {
    const body = resolver.tryResolve<{ content?: Record<string, MediaType>; description?: string }>(
      operation.requestBody,
    );
    for (const [mediaType, media] of Object.entries(body?.content ?? {})) {
      if (!hasExample(media, resolver)) {
        out.push({
          rule: "request-example-missing",
          source: "quality",
          severity: "info",
          message: `${method.toUpperCase()} ${path} request body (${mediaType}) has no example.`,
          pointer: extend(at, "requestBody", "content", mediaType),
        });
      }
    }
  }

  // Collection endpoints should paginate.
  if (method === "get" && returnsCollection(operation.responses, resolver)) {
    const names = entry.parameters.map((parameter) => (parameter.name ?? "").toLowerCase());
    const paginated = names.some((name) => PAGINATION_HINTS.includes(name));
    if (!paginated) {
      out.push({
        rule: "collection-missing-pagination",
        source: "quality",
        severity: "warning",
        message: `GET ${path} returns a collection but exposes no pagination parameters.`,
        pointer: extend(at, "parameters"),
        hint: "Unbounded list endpoints are the most common cause of production incidents. Add `limit` and a cursor.",
      });
    }
  }

  if (operation.deprecated && !operation.description?.trim() && !operation["x-replaced-by"]) {
    out.push({
      rule: "deprecated-without-guidance",
      source: "quality",
      severity: "warning",
      message: `${method.toUpperCase()} ${path} is deprecated but offers no migration guidance.`,
      pointer: extend(at, "deprecated"),
      hint: "Describe the replacement operation and the removal date.",
    });
  }
}

function returnsCollection(
  responses: Record<string, unknown> | undefined,
  resolver: RefResolver,
): boolean {
  for (const [code, rawResponse] of Object.entries(responses ?? {})) {
    if (!code.startsWith("2")) continue;
    const response = resolver.tryResolve<{ content?: Record<string, MediaType> }>(rawResponse);
    for (const media of Object.values(response?.content ?? {})) {
      const schema = media?.schema ? resolver.tryResolve<Schema>(media.schema) : null;
      if (!schema) continue;
      if (schema.type === "array") return true;
      for (const property of Object.values(schema.properties ?? {})) {
        const resolved = resolver.tryResolve<Schema>(property);
        if (resolved?.type === "array") return true;
      }
    }
  }
  return false;
}

function lintNamingConsistency(operations: readonly OperationEntry[], out: Diagnostic[]): void {
  const paths = [...new Set(operations.map((entry) => entry.path))];
  let kebab = 0;
  let camel = 0;
  let snake = 0;

  for (const path of paths) {
    for (const segment of path
      .split("/")
      .filter((segment) => segment && !segment.startsWith("{"))) {
      if (segment.includes("-")) kebab += 1;
      else if (segment.includes("_")) snake += 1;
      else if (/[a-z][A-Z]/.test(segment)) camel += 1;
    }
  }

  const styles = [
    { name: "kebab-case", count: kebab },
    { name: "snake_case", count: snake },
    { name: "camelCase", count: camel },
  ].filter((style) => style.count > 0);

  if (styles.length > 1) {
    const dominant = styles.reduce((a, b) => (a.count >= b.count ? a : b));
    out.push({
      rule: "path-naming-inconsistent",
      source: "quality",
      severity: "warning",
      message: `Path segments mix ${styles.map((style) => style.name).join(", ")}. Pick one convention.`,
      pointer: pointer("paths"),
      hint: `${dominant.name} is dominant in this document.`,
    });
  }

  for (const path of paths) {
    if (path.length > 1 && path.endsWith("/")) {
      out.push({
        rule: "path-trailing-slash",
        source: "quality",
        severity: "warning",
        message: `Path "${path}" ends with a slash, which many routers treat as a distinct resource.`,
        pointer: extend(pointer("paths"), path),
      });
    }
    for (const segment of path.split("/")) {
      if (segment && !segment.startsWith("{") && /[A-Z]/.test(segment) && !segment.includes("-")) {
        out.push({
          rule: "path-uppercase-segment",
          source: "quality",
          severity: "info",
          message: `Path segment "${segment}" contains uppercase characters; URLs are case-sensitive.`,
          pointer: extend(pointer("paths"), path),
        });
        break;
      }
    }
  }
}

function lintUnusedComponents(document: OpenApiDocument, out: Diagnostic[]): void {
  const used = new Set(collectRefs(document).map((entry) => entry.ref));
  for (const group of ["schemas", "parameters", "requestBodies", "responses"] as const) {
    const entries = document.components?.[group];
    if (!entries) continue;
    for (const name of Object.keys(entries)) {
      const ref = `#/components/${group}/${name}`;
      if (!used.has(ref)) {
        out.push({
          rule: "component-unused",
          source: "quality",
          severity: "info",
          message: `Component ${group}/${name} is never referenced.`,
          pointer: extend(pointer("components", group), name),
          hint: "Remove dead definitions or reference them so consumers know they matter.",
        });
      }
    }
  }
}

function lintSchemas(document: OpenApiDocument, out: Diagnostic[]): void {
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    if (isReference(schema)) continue;
    const at = extend(pointer("components", "schemas"), name);

    if (!schema.description && !schema.title) {
      out.push({
        rule: "schema-description-missing",
        source: "quality",
        severity: "info",
        message: `Schema "${name}" has no description.`,
        pointer: extend(at, "description"),
      });
    }
    const isObject = schema.type === "object" || Boolean(schema.properties);
    if (isObject && !schema.required?.length && Object.keys(schema.properties ?? {}).length > 0) {
      out.push({
        rule: "schema-no-required-properties",
        source: "quality",
        severity: "info",
        message: `Schema "${name}" marks no property as required, so every field is optional for consumers.`,
        pointer: extend(at, "required"),
      });
    }
    if (isObject && schema.additionalProperties === undefined) {
      out.push({
        rule: "schema-additional-properties-unspecified",
        source: "quality",
        severity: "info",
        message: `Schema "${name}" does not state whether unknown properties are allowed.`,
        pointer: extend(at, "additionalProperties"),
        hint: "Set `additionalProperties: false` for strict contracts.",
      });
    }
    for (const [property, child] of Object.entries(schema.properties ?? {})) {
      if (isReference(child)) continue;
      if (!child.description) {
        out.push({
          rule: "property-description-missing",
          source: "quality",
          severity: "info",
          message: `Property "${name}.${property}" has no description.`,
          pointer: extend(at, "properties", property, "description"),
        });
      }
    }
  }
}
