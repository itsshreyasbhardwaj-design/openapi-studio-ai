import { RefResolver } from "@/lib/core/openapi/deref";
import { effectiveSecurity, listOperations } from "@/lib/core/openapi/navigate";
import {
  isReference,
  type MediaType,
  type OpenApiDocument,
  type Schema,
  type SecurityScheme,
} from "@/lib/core/openapi/types";
import { slugify } from "@/lib/utils/id";

/** Language-neutral type reference used by every generator. */
export type TypeRef =
  | { kind: "primitive"; name: "string" | "integer" | "number" | "boolean" | "datetime" | "any" }
  | { kind: "array"; items: TypeRef }
  | { kind: "map"; values: TypeRef }
  | { kind: "model"; name: string }
  | { kind: "enum"; name: string; values: string[] }
  | { kind: "void" };

export interface SdkProperty {
  readonly name: string;
  /** Wire name; differs from `name` when the JSON key is not a valid identifier. */
  readonly wireName: string;
  readonly type: TypeRef;
  readonly required: boolean;
  readonly nullable: boolean;
  readonly description: string | null;
  readonly deprecated: boolean;
}

export interface SdkModelType {
  readonly name: string;
  readonly description: string | null;
  readonly properties: readonly SdkProperty[];
  /** Populated for enum-only schemas. */
  readonly enumValues: readonly string[];
  readonly additionalProperties: TypeRef | null;
}

export interface SdkParameter {
  readonly name: string;
  readonly wireName: string;
  readonly type: TypeRef;
  readonly required: boolean;
  readonly description: string | null;
}

export type PaginationStyle = "page" | "offset" | "cursor" | "none";

export interface SdkOperation {
  readonly id: string;
  readonly methodName: string;
  readonly httpMethod: string;
  readonly path: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly tag: string;
  readonly deprecated: boolean;
  readonly pathParams: readonly SdkParameter[];
  readonly queryParams: readonly SdkParameter[];
  readonly headerParams: readonly SdkParameter[];
  readonly requestBody: {
    readonly type: TypeRef;
    readonly required: boolean;
    readonly mediaType: string;
  } | null;
  readonly responseType: TypeRef;
  readonly successStatus: number;
  readonly errorStatuses: readonly number[];
  readonly pagination: PaginationStyle;
  /** Property holding the page items when the response is a wrapper object. */
  readonly itemsProperty: string | null;
  readonly requiresAuth: boolean;
}

export type SdkAuthKind = "bearer" | "basic" | "apiKeyHeader" | "apiKeyQuery" | "oauth2" | "none";

export interface SdkAuth {
  readonly kind: SdkAuthKind;
  readonly schemeName: string;
  /** Header or query parameter name for API-key schemes. */
  readonly parameterName: string | null;
  readonly tokenUrl: string | null;
  readonly scopes: readonly string[];
}

export interface SdkSpec {
  readonly title: string;
  readonly packageName: string;
  readonly namespace: string;
  readonly version: string;
  readonly description: string;
  readonly baseUrl: string;
  readonly servers: readonly string[];
  readonly auth: readonly SdkAuth[];
  readonly models: readonly SdkModelType[];
  readonly operations: readonly SdkOperation[];
}

const RESERVED = new Set([
  "class",
  "default",
  "for",
  "if",
  "in",
  "return",
  "new",
  "delete",
  "type",
  "import",
  "from",
  "async",
  "await",
  "function",
  "var",
  "let",
  "const",
  "public",
  "private",
  "static",
  "int",
  "string",
  "bool",
  "lambda",
  "pass",
  "def",
  "None",
  "True",
  "False",
  "package",
  "interface",
  "map",
  "range",
  "func",
]);

export function toCamel(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9]+(.)?/g, (_match, char: string | undefined) =>
    char ? char.toUpperCase() : "",
  );
  const camel = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  return RESERVED.has(camel) ? `${camel}Value` : camel || "value";
}

export function toPascal(input: string): string {
  const camel = toCamel(input);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function toSnake(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

function schemaToType(
  schema: Schema | undefined,
  resolver: RefResolver,
  hint: string,
  depth = 0,
): TypeRef {
  if (!schema || depth > 8) return { kind: "primitive", name: "any" };

  if (isReference(schema) || schema.$ref) {
    const ref = (schema as { $ref?: string }).$ref ?? "";
    const match = /#\/components\/schemas\/(.+)$/.exec(ref);
    if (match?.[1]) return { kind: "model", name: toPascal(match[1]) };
    const resolved = resolver.tryResolve<Schema>(schema);
    return resolved
      ? schemaToType(resolved, resolver, hint, depth + 1)
      : { kind: "primitive", name: "any" };
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.type !== "object") {
    return { kind: "enum", name: toPascal(hint), values: schema.enum.map(String) };
  }

  if (schema.allOf?.length) {
    // Flatten to the first object-shaped member; generators expose the merge as a model.
    for (const member of schema.allOf) {
      const type = schemaToType(member, resolver, hint, depth + 1);
      if (type.kind === "model") return type;
    }
    return { kind: "primitive", name: "any" };
  }
  const union = schema.oneOf ?? schema.anyOf;
  if (union?.length) return schemaToType(union[0], resolver, hint, depth + 1);

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const primary =
    types.find((type) => type !== "null") ??
    (schema.properties ? "object" : schema.items ? "array" : undefined);

  switch (primary) {
    case "array":
      return {
        kind: "array",
        items: schemaToType(schema.items, resolver, `${hint}Item`, depth + 1),
      };
    case "object": {
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        return { kind: "model", name: toPascal(hint) };
      }
      if (typeof schema.additionalProperties === "object") {
        return {
          kind: "map",
          values: schemaToType(schema.additionalProperties, resolver, `${hint}Value`, depth + 1),
        };
      }
      return { kind: "map", values: { kind: "primitive", name: "any" } };
    }
    case "integer":
      return { kind: "primitive", name: "integer" };
    case "number":
      return { kind: "primitive", name: "number" };
    case "boolean":
      return { kind: "primitive", name: "boolean" };
    case "string":
      return schema.format === "date-time"
        ? { kind: "primitive", name: "datetime" }
        : { kind: "primitive", name: "string" };
    default:
      return { kind: "primitive", name: "any" };
  }
}

function buildModels(document: OpenApiDocument, resolver: RefResolver): SdkModelType[] {
  const models: SdkModelType[] = [];

  for (const [name, rawSchema] of Object.entries(document.components?.schemas ?? {})) {
    const schema = isReference(rawSchema) ? resolver.tryResolve<Schema>(rawSchema) : rawSchema;
    if (!schema) continue;

    // Merge allOf members so inherited properties appear on the generated model.
    const merged: Schema = { ...schema };
    if (schema.allOf?.length) {
      merged.properties = { ...(schema.properties ?? {}) };
      merged.required = [...(schema.required ?? [])];
      for (const member of schema.allOf) {
        const part = resolver.tryResolve<Schema>(member);
        if (!part) continue;
        Object.assign(merged.properties, part.properties ?? {});
        merged.required.push(...(part.required ?? []));
      }
    }

    const required = new Set(merged.required ?? []);
    const properties: SdkProperty[] = Object.entries(merged.properties ?? {}).map(
      ([key, rawChild]) => {
        const child = (isReference(rawChild) ? rawChild : rawChild) as Schema;
        const resolved = isReference(rawChild) ? resolver.tryResolve<Schema>(rawChild) : rawChild;
        const childTypes = Array.isArray(resolved?.type)
          ? resolved.type
          : resolved?.type
            ? [resolved.type]
            : [];
        return {
          name: toCamel(key),
          wireName: key,
          type: schemaToType(child, resolver, `${name}${toPascal(key)}`),
          required: required.has(key),
          nullable: resolved?.nullable === true || childTypes.includes("null"),
          description: resolved?.description ?? null,
          deprecated: resolved?.deprecated === true,
        };
      },
    );

    models.push({
      name: toPascal(name),
      description: merged.description ?? merged.title ?? null,
      properties,
      enumValues: Array.isArray(merged.enum) ? merged.enum.map(String) : [],
      additionalProperties:
        typeof merged.additionalProperties === "object"
          ? schemaToType(merged.additionalProperties, resolver, `${name}Value`)
          : null,
    });
  }

  return models.sort((a, b) => a.name.localeCompare(b.name));
}

function detectPagination(queryNames: readonly string[]): PaginationStyle {
  const lower = queryNames.map((name) => name.toLowerCase());
  if (lower.some((name) => name === "cursor" || name === "after" || name === "page_token"))
    return "cursor";
  if (lower.includes("page")) return "page";
  if (lower.includes("offset")) return "offset";
  return "none";
}

function preferredMedia(
  content: Record<string, MediaType> | undefined,
): [string, MediaType] | null {
  const entries = Object.entries(content ?? {});
  if (entries.length === 0) return null;
  const json = entries.find(([name]) => name.includes("json"));
  return json ?? entries[0] ?? null;
}

/**
 * Build the language-neutral SDK model from an OpenAPI document.
 *
 * Every generator consumes this IR rather than the raw document, so adding a
 * language means writing one emitter — not re-implementing OpenAPI traversal,
 * naming rules or pagination detection.
 */
export function buildSdkSpec(
  document: OpenApiDocument,
  options: { packageName?: string } = {},
): SdkSpec {
  const resolver = new RefResolver(document);
  const title = document.info?.title ?? "API";
  const packageName = options.packageName ?? (slugify(title) || "api-client");

  const auth: SdkAuth[] = Object.entries(document.components?.securitySchemes ?? {}).map(
    ([name, rawScheme]) => {
      const scheme = isReference(rawScheme)
        ? resolver.tryResolve<SecurityScheme>(rawScheme)
        : rawScheme;
      const flows = scheme?.flows ?? {};
      const flow =
        flows.clientCredentials ?? flows.authorizationCode ?? flows.password ?? flows.implicit;
      let kind: SdkAuthKind = "none";
      if (scheme?.type === "http")
        kind = scheme.scheme?.toLowerCase() === "basic" ? "basic" : "bearer";
      else if (scheme?.type === "apiKey")
        kind = scheme.in === "query" ? "apiKeyQuery" : "apiKeyHeader";
      else if (scheme?.type === "oauth2" || scheme?.type === "openIdConnect") kind = "oauth2";
      return {
        kind,
        schemeName: name,
        parameterName: scheme?.name ?? null,
        tokenUrl: flow?.tokenUrl ?? null,
        scopes: Object.keys(flow?.scopes ?? {}),
      };
    },
  );

  const operations: SdkOperation[] = listOperations(document)
    .filter((entry) => entry.kind === "path")
    .map((entry) => {
      const toParameter = (location: string): SdkParameter[] =>
        entry.parameters
          .filter((parameter) => parameter.in === location && parameter.name)
          .map((parameter) => ({
            name: toCamel(parameter.name ?? ""),
            wireName: parameter.name ?? "",
            type: schemaToType(
              parameter.schema
                ? (resolver.tryResolve<Schema>(parameter.schema) ?? undefined)
                : undefined,
              resolver,
              `${entry.operationId}${toPascal(parameter.name ?? "")}`,
            ),
            required: parameter.required === true,
            description: parameter.description ?? null,
          }));

      const queryParams = toParameter("query");
      const responseEntry = Object.entries(entry.operation.responses ?? {})
        .filter(([code]) => code.startsWith("2"))
        .sort(([a], [b]) => a.localeCompare(b))[0];
      const successStatus = responseEntry ? Number.parseInt(responseEntry[0], 10) || 200 : 200;
      const response = responseEntry
        ? resolver.tryResolve<{ content?: Record<string, MediaType> }>(responseEntry[1])
        : null;
      const responseMedia = preferredMedia(response?.content);
      const responseType: TypeRef = responseMedia
        ? schemaToType(
            responseMedia[1].schema
              ? (resolver.tryResolve<Schema>(responseMedia[1].schema) ?? undefined)
              : undefined,
            resolver,
            `${toPascal(entry.operationId)}Response`,
          )
        : { kind: "void" };

      const rawBody = entry.operation.requestBody
        ? resolver.tryResolve<{ content?: Record<string, MediaType>; required?: boolean }>(
            entry.operation.requestBody,
          )
        : null;
      const bodyMedia = preferredMedia(rawBody?.content);

      const resolvedResponseSchema = responseMedia?.[1].schema
        ? resolver.tryResolve<Schema>(responseMedia[1].schema)
        : null;
      const itemsProperty =
        resolvedResponseSchema && resolvedResponseSchema.type !== "array"
          ? (Object.entries(resolvedResponseSchema.properties ?? {}).find(([, value]) => {
              const child = resolver.tryResolve<Schema>(value);
              return child?.type === "array";
            })?.[0] ?? null)
          : null;

      return {
        id: entry.operationId,
        methodName: toCamel(entry.operationId),
        httpMethod: entry.method.toUpperCase(),
        path: entry.path,
        summary: entry.operation.summary ?? null,
        description: entry.operation.description ?? null,
        tag: entry.tags[0] ?? "default",
        deprecated: entry.deprecated,
        pathParams: toParameter("path"),
        queryParams,
        headerParams: toParameter("header"),
        requestBody: bodyMedia
          ? {
              type: schemaToType(
                bodyMedia[1].schema
                  ? (resolver.tryResolve<Schema>(bodyMedia[1].schema) ?? undefined)
                  : undefined,
                resolver,
                `${toPascal(entry.operationId)}Request`,
              ),
              required: rawBody?.required === true,
              mediaType: bodyMedia[0],
            }
          : null,
        responseType,
        successStatus,
        errorStatuses: Object.keys(entry.operation.responses ?? {})
          .filter((code) => code.startsWith("4") || code.startsWith("5"))
          .map((code) => Number.parseInt(code, 10))
          .filter((code) => Number.isFinite(code)),
        pagination: detectPagination(queryParams.map((parameter) => parameter.wireName)),
        itemsProperty,
        requiresAuth: effectiveSecurity(document, entry.operation).length > 0,
      };
    });

  return {
    title,
    packageName,
    namespace: toPascal(title),
    version: document.info?.version ?? "1.0.0",
    description: document.info?.description?.split("\n")[0] ?? `Client library for ${title}.`,
    baseUrl: document.servers?.[0]?.url ?? "https://api.example.com",
    servers: (document.servers ?? []).map((server) => server.url ?? "").filter(Boolean),
    auth,
    models: buildModels(document, resolver),
    operations,
  };
}

/** A file emitted by a generator. */
export interface GeneratedFile {
  readonly path: string;
  readonly contents: string;
}

export interface GeneratedSdk {
  readonly language: SdkLanguage;
  readonly files: readonly GeneratedFile[];
  readonly entryPoint: string;
  readonly installCommand: string;
}

export type SdkLanguage = "typescript" | "javascript" | "python" | "java" | "go" | "csharp" | "php";

export const SDK_LANGUAGES: readonly { id: SdkLanguage; label: string; extension: string }[] = [
  { id: "typescript", label: "TypeScript", extension: "ts" },
  { id: "javascript", label: "JavaScript", extension: "js" },
  { id: "python", label: "Python", extension: "py" },
  { id: "java", label: "Java", extension: "java" },
  { id: "go", label: "Go", extension: "go" },
  { id: "csharp", label: "C#", extension: "cs" },
  { id: "php", label: "PHP", extension: "php" },
];

/** Documentation comment text for an operation, shared by all generators. */
export function operationDoc(operation: SdkOperation): string[] {
  const lines: string[] = [];
  if (operation.summary) lines.push(operation.summary);
  if (operation.description && operation.description !== operation.summary) {
    lines.push(...operation.description.split("\n").slice(0, 4));
  }
  lines.push(`${operation.httpMethod} ${operation.path}`);
  if (operation.deprecated) lines.push("@deprecated This operation is deprecated.");
  return lines;
}

/** Interpolate a path template with language-specific placeholders. */
export function renderPath(
  operation: SdkOperation,
  wrap: (parameter: SdkParameter) => string,
): string {
  let path = operation.path;
  for (const parameter of operation.pathParams) {
    path = path.replace(`{${parameter.wireName}}`, wrap(parameter));
  }
  return path;
}
