import { collectRefs, RefResolver } from "./deref";
import type { Diagnostic } from "./diagnostics";
import { listOperations, pathTemplateVariables } from "./navigate";
import { extend, pointer } from "./pointer";
import { specVersionOf } from "./document";
import {
  HTTP_METHODS,
  isReference,
  type MediaType,
  type OpenApiDocument,
  type Parameter,
  type PathItem,
  type Schema,
  type SecurityScheme,
} from "./types";

const VALID_STATUS = /^([1-5]\d{2}|[1-5]XX|default)$/;
const VALID_COMPONENT_KEY = /^[a-zA-Z0-9._-]+$/;
const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object", "null"]);
const PARAM_LOCATIONS = new Set(["query", "header", "path", "cookie"]);

interface Ctx {
  readonly document: OpenApiDocument;
  readonly resolver: RefResolver;
  readonly out: Diagnostic[];
}

function report(ctx: Ctx, diagnostic: Diagnostic): void {
  ctx.out.push(diagnostic);
}

/**
 * Structural validation of an OpenAPI 3.x document.
 *
 * This is a hand-written validator rather than a JSON-Schema meta-validation
 * pass, for three reasons: the error messages can be written for humans, every
 * finding carries a precise JSON Pointer for the editor to jump to, and many
 * findings can carry a machine-applicable fix.
 */
export function validateDocument(document: OpenApiDocument): Diagnostic[] {
  const ctx: Ctx = { document, resolver: new RefResolver(document), out: [] };

  validateRoot(ctx);
  validateInfo(ctx);
  validateServers(ctx);
  validatePaths(ctx);
  validateWebhooks(ctx);
  validateComponents(ctx);
  validateSecurityRequirements(ctx);
  validateReferences(ctx);
  validateTags(ctx);

  return ctx.out;
}

function validateRoot(ctx: Ctx): void {
  const version = ctx.document.openapi;
  if (typeof version !== "string" || version.length === 0) {
    report(ctx, {
      rule: "openapi-version-missing",
      source: "structure",
      severity: "error",
      message: 'The root "openapi" field is required and must state the specification version.',
      pointer: pointer("openapi"),
      hint: 'Add `openapi: "3.1.0"` at the root of the document.',
      fix: { pointer: pointer("openapi"), value: "3.1.0", label: "Set openapi to 3.1.0" },
    });
    return;
  }
  if (specVersionOf(ctx.document) === "unknown") {
    report(ctx, {
      rule: "openapi-version-unsupported",
      source: "structure",
      severity: "error",
      message: `OpenAPI version "${version}" is not supported. Use 3.0.x or 3.1.x.`,
      pointer: pointer("openapi"),
      fix: { pointer: pointer("openapi"), value: "3.1.0", label: "Set openapi to 3.1.0" },
    });
  }

  const hasPaths = Object.keys(ctx.document.paths ?? {}).length > 0;
  const hasWebhooks = Object.keys(ctx.document.webhooks ?? {}).length > 0;
  const hasComponents = Object.keys(ctx.document.components ?? {}).length > 0;
  if (!hasPaths && !hasWebhooks && !hasComponents) {
    report(ctx, {
      rule: "document-empty",
      source: "structure",
      severity: "error",
      message: "The document declares no paths, webhooks or components.",
      pointer: "",
      hint: "Add at least one path under `paths`.",
    });
  }
  if (specVersionOf(ctx.document) === "3.0" && !hasPaths) {
    report(ctx, {
      rule: "paths-required-in-30",
      source: "structure",
      severity: "error",
      message: "OpenAPI 3.0 requires a `paths` object.",
      pointer: pointer("paths"),
      hint: "Upgrade to 3.1 to publish a webhook-only or components-only document.",
    });
  }
}

function validateInfo(ctx: Ctx): void {
  const info = ctx.document.info;
  if (!info || typeof info !== "object") {
    report(ctx, {
      rule: "info-missing",
      source: "structure",
      severity: "error",
      message: "The `info` object is required.",
      pointer: pointer("info"),
      fix: {
        pointer: pointer("info"),
        value: { title: "Untitled API", version: "1.0.0" },
        label: "Add a minimal info block",
      },
    });
    return;
  }
  if (!info.title) {
    report(ctx, {
      rule: "info-title-missing",
      source: "structure",
      severity: "error",
      message: "`info.title` is required.",
      pointer: pointer("info", "title"),
      fix: { pointer: pointer("info", "title"), value: "Untitled API", label: "Add a title" },
    });
  }
  if (!info.version) {
    report(ctx, {
      rule: "info-version-missing",
      source: "structure",
      severity: "error",
      message: "`info.version` is required.",
      pointer: pointer("info", "version"),
      fix: { pointer: pointer("info", "version"), value: "1.0.0", label: "Add version 1.0.0" },
    });
  }
}

function validateServers(ctx: Ctx): void {
  const servers = ctx.document.servers;
  if (!servers) return;
  if (!Array.isArray(servers)) {
    report(ctx, {
      rule: "servers-not-array",
      source: "structure",
      severity: "error",
      message: "`servers` must be an array of Server objects.",
      pointer: pointer("servers"),
    });
    return;
  }
  servers.forEach((server, index) => {
    const at = extend(pointer("servers"), index);
    if (!server?.url) {
      report(ctx, {
        rule: "server-url-missing",
        source: "structure",
        severity: "error",
        message: "Each server entry requires a `url`.",
        pointer: extend(at, "url"),
      });
      return;
    }
    for (const variable of pathTemplateVariables(server.url)) {
      if (!server.variables?.[variable]) {
        report(ctx, {
          rule: "server-variable-undeclared",
          source: "structure",
          severity: "error",
          message: `Server URL uses "{${variable}}" but no matching entry exists in \`variables\`.`,
          pointer: extend(at, "variables"),
          hint: `Declare \`variables.${variable}.default\`.`,
        });
      }
    }
  });
}

function validatePaths(ctx: Ctx): void {
  const paths = ctx.document.paths;
  if (!paths) return;

  const seenOperationIds = new Map<string, string>();

  for (const [path, rawItem] of Object.entries(paths)) {
    const at = extend(pointer("paths"), path);
    if (!path.startsWith("/")) {
      report(ctx, {
        rule: "path-missing-leading-slash",
        source: "structure",
        severity: "error",
        message: `Path "${path}" must start with "/".`,
        pointer: at,
      });
    }
    const pathItem = rawItem as PathItem | undefined;
    if (!pathItem || typeof pathItem !== "object") {
      report(ctx, {
        rule: "path-item-invalid",
        source: "structure",
        severity: "error",
        message: `Path "${path}" must map to a Path Item object.`,
        pointer: at,
      });
      continue;
    }

    const declared = pathTemplateVariables(path);
    if (new Set(declared).size !== declared.length) {
      report(ctx, {
        rule: "path-duplicate-template-variable",
        source: "structure",
        severity: "error",
        message: `Path "${path}" declares the same template variable more than once.`,
        pointer: at,
      });
    }

    const unknownKeys = Object.keys(pathItem).filter(
      (key) =>
        !key.startsWith("x-") &&
        !["$ref", "summary", "description", "servers", "parameters", ...HTTP_METHODS].includes(key),
    );
    for (const key of unknownKeys) {
      report(ctx, {
        rule: "path-item-unknown-field",
        source: "structure",
        severity: "warning",
        message: `"${key}" is not a valid Path Item field.`,
        pointer: extend(at, key),
        hint: "Prefix custom fields with `x-` to keep the document valid.",
      });
    }

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const opAt = extend(at, method);

      if (operation.operationId) {
        const previous = seenOperationIds.get(operation.operationId);
        if (previous) {
          report(ctx, {
            rule: "operation-id-duplicate",
            source: "structure",
            severity: "error",
            message: `operationId "${operation.operationId}" is already used by ${previous}.`,
            pointer: extend(opAt, "operationId"),
            hint: "operationId values must be unique across the whole document.",
          });
        } else {
          seenOperationIds.set(operation.operationId, `${method.toUpperCase()} ${path}`);
        }
      }

      validateResponses(ctx, operation.responses, opAt);
      validateOperationParameters(ctx, operation.parameters, opAt, declared, path, method);
      validateRequestBody(ctx, operation.requestBody, opAt);
    }

    validateOperationParameters(ctx, pathItem.parameters, at, declared, path, null);

    // Every declared template variable must be covered by a path parameter,
    // considering path-level and operation-level parameters together.
    const covered = new Set<string>();
    const collect = (list: PathItem["parameters"]): void => {
      for (const entry of list ?? []) {
        const parameter = isReference(entry) ? ctx.resolver.tryResolve<Parameter>(entry) : entry;
        if (parameter?.in === "path" && parameter.name) covered.add(parameter.name);
      }
    };
    collect(pathItem.parameters);
    for (const method of HTTP_METHODS) collect(pathItem[method]?.parameters);
    for (const variable of declared) {
      if (!covered.has(variable)) {
        report(ctx, {
          rule: "path-parameter-undeclared",
          source: "structure",
          severity: "error",
          message: `Path "${path}" uses "{${variable}}" but no path parameter declares it.`,
          pointer: extend(at, "parameters"),
          hint: `Add a parameter with \`name: ${variable}\`, \`in: path\`, \`required: true\`.`,
        });
      }
    }
  }
}

function validateWebhooks(ctx: Ctx): void {
  const webhooks = ctx.document.webhooks;
  if (!webhooks) return;
  if (specVersionOf(ctx.document) === "3.0") {
    report(ctx, {
      rule: "webhooks-unsupported-in-30",
      source: "structure",
      severity: "error",
      message: "`webhooks` requires OpenAPI 3.1 or newer.",
      pointer: pointer("webhooks"),
      fix: { pointer: pointer("openapi"), value: "3.1.0", label: "Upgrade the document to 3.1.0" },
    });
  }
  for (const [name, rawItem] of Object.entries(webhooks)) {
    const at = extend(pointer("webhooks"), name);
    const item = (
      isReference(rawItem) ? ctx.resolver.tryResolve<PathItem>(rawItem) : rawItem
    ) as PathItem | null;
    if (!item || typeof item !== "object") {
      report(ctx, {
        rule: "webhook-item-invalid",
        source: "structure",
        severity: "error",
        message: `Webhook "${name}" must map to a Path Item object.`,
        pointer: at,
      });
      continue;
    }
    const methods = HTTP_METHODS.filter((method) => item[method]);
    if (methods.length === 0) {
      report(ctx, {
        rule: "webhook-no-operation",
        source: "structure",
        severity: "error",
        message: `Webhook "${name}" declares no operation.`,
        pointer: at,
        hint: "Webhooks are usually delivered with POST — add a `post` operation.",
      });
    }
    for (const method of methods) {
      validateResponses(ctx, item[method]?.responses, extend(at, method));
    }
  }
}

function validateResponses(
  ctx: Ctx,
  responses: Record<string, unknown> | undefined,
  at: string,
): void {
  const responsesAt = extend(at, "responses");
  if (!responses || Object.keys(responses).length === 0) {
    report(ctx, {
      rule: "operation-responses-missing",
      source: "structure",
      severity: "error",
      message: "Every operation must define at least one response.",
      pointer: responsesAt,
      fix: {
        pointer: responsesAt,
        value: { "200": { description: "Successful response" } },
        label: "Add a 200 response",
      },
    });
    return;
  }
  for (const [code, rawResponse] of Object.entries(responses)) {
    const codeAt = extend(responsesAt, code);
    if (!VALID_STATUS.test(code)) {
      report(ctx, {
        rule: "response-code-invalid",
        source: "structure",
        severity: "error",
        message: `"${code}" is not a valid response key. Use a 3-digit status, a range like 4XX, or "default".`,
        pointer: codeAt,
      });
    }
    const response = isReference(rawResponse)
      ? ctx.resolver.tryResolve<{ description?: string; content?: Record<string, MediaType> }>(
          rawResponse,
        )
      : (rawResponse as { description?: string; content?: Record<string, MediaType> } | null);
    if (!response) continue;
    if (!response.description) {
      report(ctx, {
        rule: "response-description-missing",
        source: "structure",
        severity: "error",
        message: `Response "${code}" is missing the required \`description\`.`,
        pointer: extend(codeAt, "description"),
        fix: {
          pointer: extend(codeAt, "description"),
          value: "Response",
          label: "Add a description",
        },
      });
    }
    for (const [mediaType, media] of Object.entries(response.content ?? {})) {
      validateMediaType(ctx, mediaType, media, extend(codeAt, "content", mediaType));
    }
  }
}

function validateMediaType(ctx: Ctx, name: string, media: MediaType, at: string): void {
  if (!name.includes("/")) {
    report(ctx, {
      rule: "media-type-invalid",
      source: "structure",
      severity: "warning",
      message: `"${name}" does not look like a media type.`,
      pointer: at,
    });
  }
  if (media?.schema) {
    const schema = isReference(media.schema)
      ? ctx.resolver.tryResolve<Schema>(media.schema)
      : media.schema;
    if (schema) validateSchema(ctx, schema, extend(at, "schema"), new Set());
  }
}

function validateOperationParameters(
  ctx: Ctx,
  parameters: PathItem["parameters"],
  at: string,
  declaredTemplates: readonly string[],
  path: string,
  method: string | null,
): void {
  if (!parameters) return;
  if (!Array.isArray(parameters)) {
    report(ctx, {
      rule: "parameters-not-array",
      source: "structure",
      severity: "error",
      message: "`parameters` must be an array.",
      pointer: extend(at, "parameters"),
    });
    return;
  }

  const seen = new Set<string>();
  parameters.forEach((entry, index) => {
    const paramAt = extend(at, "parameters", index);
    const parameter = isReference(entry) ? ctx.resolver.tryResolve<Parameter>(entry) : entry;
    if (!parameter) return;

    if (!parameter.name) {
      report(ctx, {
        rule: "parameter-name-missing",
        source: "structure",
        severity: "error",
        message: "Parameters require a `name`.",
        pointer: extend(paramAt, "name"),
      });
    }
    if (!parameter.in) {
      report(ctx, {
        rule: "parameter-in-missing",
        source: "structure",
        severity: "error",
        message: "Parameters require an `in` value (query, header, path or cookie).",
        pointer: extend(paramAt, "in"),
      });
    } else if (!PARAM_LOCATIONS.has(parameter.in)) {
      report(ctx, {
        rule: "parameter-in-invalid",
        source: "structure",
        severity: "error",
        message: `"${parameter.in}" is not a valid parameter location.`,
        pointer: extend(paramAt, "in"),
      });
    }

    const key = `${parameter.in ?? "?"}:${parameter.name ?? "?"}`;
    if (seen.has(key)) {
      report(ctx, {
        rule: "parameter-duplicate",
        source: "structure",
        severity: "error",
        message: `Duplicate parameter "${parameter.name}" in "${parameter.in}".`,
        pointer: paramAt,
      });
    }
    seen.add(key);

    if (parameter.in === "path") {
      if (parameter.required !== true) {
        report(ctx, {
          rule: "path-parameter-not-required",
          source: "structure",
          severity: "error",
          message: `Path parameter "${parameter.name}" must set \`required: true\`.`,
          pointer: extend(paramAt, "required"),
          fix: { pointer: extend(paramAt, "required"), value: true, label: "Mark as required" },
        });
      }
      if (parameter.name && !declaredTemplates.includes(parameter.name)) {
        report(ctx, {
          rule: "path-parameter-unused",
          source: "structure",
          severity: "error",
          message: `Path parameter "${parameter.name}" does not appear in the path template "${path}".`,
          pointer: paramAt,
          hint: method
            ? `Either add "{${parameter.name}}" to the path or remove the parameter.`
            : "Remove the parameter or update the path template.",
        });
      }
    }

    if (!parameter.schema && !parameter.content) {
      report(ctx, {
        rule: "parameter-schema-missing",
        source: "structure",
        severity: "warning",
        message: `Parameter "${parameter.name}" declares neither \`schema\` nor \`content\`.`,
        pointer: paramAt,
        fix: {
          pointer: extend(paramAt, "schema"),
          value: { type: "string" },
          label: "Add a string schema",
        },
      });
    }
    if (parameter.schema && !isReference(parameter.schema)) {
      validateSchema(ctx, parameter.schema, extend(paramAt, "schema"), new Set());
    }
  });
}

function validateRequestBody(ctx: Ctx, requestBody: unknown, at: string): void {
  if (!requestBody) return;
  const bodyAt = extend(at, "requestBody");
  const body = isReference(requestBody)
    ? ctx.resolver.tryResolve<{ content?: Record<string, MediaType> }>(requestBody)
    : (requestBody as { content?: Record<string, MediaType> });
  if (!body) return;
  if (!body.content || Object.keys(body.content).length === 0) {
    report(ctx, {
      rule: "request-body-content-missing",
      source: "structure",
      severity: "error",
      message: "`requestBody` requires a non-empty `content` map.",
      pointer: extend(bodyAt, "content"),
      fix: {
        pointer: extend(bodyAt, "content"),
        value: { "application/json": { schema: { type: "object" } } },
        label: "Add a JSON body",
      },
    });
    return;
  }
  for (const [mediaType, media] of Object.entries(body.content)) {
    validateMediaType(ctx, mediaType, media, extend(bodyAt, "content", mediaType));
  }
}

function validateSchema(ctx: Ctx, schema: Schema, at: string, seen: Set<Schema>): void {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return;
  seen.add(schema);

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  for (const type of types) {
    if (!SCHEMA_TYPES.has(type)) {
      report(ctx, {
        rule: "schema-type-invalid",
        source: "structure",
        severity: "error",
        message: `"${type}" is not a valid JSON Schema type.`,
        pointer: extend(at, "type"),
      });
    }
  }
  if (Array.isArray(schema.type) && specVersionOf(ctx.document) === "3.0") {
    report(ctx, {
      rule: "schema-type-array-in-30",
      source: "structure",
      severity: "error",
      message: "Type arrays require OpenAPI 3.1. In 3.0 use `nullable: true` or `oneOf`.",
      pointer: extend(at, "type"),
    });
  }
  if (schema.nullable !== undefined && specVersionOf(ctx.document) === "3.1") {
    report(ctx, {
      rule: "schema-nullable-in-31",
      source: "structure",
      severity: "warning",
      message: "`nullable` was removed in OpenAPI 3.1. Use `type: [..., 'null']` instead.",
      pointer: extend(at, "nullable"),
    });
  }
  if (types.includes("array") && !schema.items && !schema.prefixItems) {
    report(ctx, {
      rule: "schema-array-items-missing",
      source: "structure",
      severity: "warning",
      message: "Array schemas should declare `items`.",
      pointer: extend(at, "items"),
      fix: { pointer: extend(at, "items"), value: { type: "string" }, label: "Add string items" },
    });
  }
  if (schema.required && !Array.isArray(schema.required)) {
    report(ctx, {
      rule: "schema-required-not-array",
      source: "structure",
      severity: "error",
      message: "`required` must be an array of property names.",
      pointer: extend(at, "required"),
    });
  } else if (Array.isArray(schema.required) && schema.properties) {
    for (const name of schema.required) {
      if (!(name in schema.properties)) {
        report(ctx, {
          rule: "schema-required-unknown-property",
          source: "structure",
          severity: "error",
          message: `Required property "${name}" is not defined in \`properties\`.`,
          pointer: extend(at, "required"),
        });
      }
    }
  }
  if (
    schema.minimum !== undefined &&
    schema.maximum !== undefined &&
    schema.minimum > schema.maximum
  ) {
    report(ctx, {
      rule: "schema-range-inverted",
      source: "structure",
      severity: "error",
      message: "`minimum` is greater than `maximum`.",
      pointer: extend(at, "minimum"),
    });
  }
  if (schema.pattern) {
    try {
      new RegExp(schema.pattern);
    } catch {
      report(ctx, {
        rule: "schema-pattern-invalid",
        source: "structure",
        severity: "error",
        message: `\`pattern\` is not a valid regular expression: ${schema.pattern}`,
        pointer: extend(at, "pattern"),
      });
    }
  }

  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    if (!isReference(child)) validateSchema(ctx, child, extend(at, "properties", name), seen);
  }
  if (schema.items && !isReference(schema.items)) {
    validateSchema(ctx, schema.items, extend(at, "items"), seen);
  }
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    const list = schema[key];
    if (!list) continue;
    if (!Array.isArray(list)) {
      report(ctx, {
        rule: "schema-composition-not-array",
        source: "structure",
        severity: "error",
        message: `\`${key}\` must be an array of schemas.`,
        pointer: extend(at, key),
      });
      continue;
    }
    list.forEach((child, index) => {
      if (!isReference(child)) validateSchema(ctx, child, extend(at, key, index), seen);
    });
  }
}

function validateComponents(ctx: Ctx): void {
  const components = ctx.document.components;
  if (!components) return;

  for (const [group, entries] of Object.entries(components)) {
    if (!entries || typeof entries !== "object") continue;
    for (const key of Object.keys(entries as Record<string, unknown>)) {
      if (!VALID_COMPONENT_KEY.test(key)) {
        report(ctx, {
          rule: "component-key-invalid",
          source: "structure",
          severity: "error",
          message: `Component key "${key}" must match ^[a-zA-Z0-9._-]+$.`,
          pointer: extend(pointer("components", group), key),
        });
      }
    }
  }

  for (const [name, schema] of Object.entries(components.schemas ?? {})) {
    if (!isReference(schema)) {
      validateSchema(ctx, schema, extend(pointer("components", "schemas"), name), new Set());
    }
  }

  for (const [name, rawScheme] of Object.entries(components.securitySchemes ?? {})) {
    const at = extend(pointer("components", "securitySchemes"), name);
    const scheme = isReference(rawScheme)
      ? ctx.resolver.tryResolve<SecurityScheme>(rawScheme)
      : rawScheme;
    if (!scheme) continue;
    if (!scheme.type) {
      report(ctx, {
        rule: "security-scheme-type-missing",
        source: "structure",
        severity: "error",
        message: `Security scheme "${name}" requires a \`type\`.`,
        pointer: extend(at, "type"),
      });
      continue;
    }
    if (scheme.type === "apiKey" && (!scheme.name || !scheme.in)) {
      report(ctx, {
        rule: "security-scheme-apikey-incomplete",
        source: "structure",
        severity: "error",
        message: `apiKey scheme "${name}" requires both \`name\` and \`in\`.`,
        pointer: at,
      });
    }
    if (scheme.type === "http" && !scheme.scheme) {
      report(ctx, {
        rule: "security-scheme-http-incomplete",
        source: "structure",
        severity: "error",
        message: `http scheme "${name}" requires a \`scheme\` (e.g. bearer).`,
        pointer: extend(at, "scheme"),
      });
    }
    if (scheme.type === "oauth2" && (!scheme.flows || Object.keys(scheme.flows).length === 0)) {
      report(ctx, {
        rule: "security-scheme-oauth2-incomplete",
        source: "structure",
        severity: "error",
        message: `oauth2 scheme "${name}" requires at least one flow.`,
        pointer: extend(at, "flows"),
      });
    }
    if (scheme.type === "openIdConnect" && !scheme.openIdConnectUrl) {
      report(ctx, {
        rule: "security-scheme-oidc-incomplete",
        source: "structure",
        severity: "error",
        message: `openIdConnect scheme "${name}" requires \`openIdConnectUrl\`.`,
        pointer: extend(at, "openIdConnectUrl"),
      });
    }
  }
}

function validateSecurityRequirements(ctx: Ctx): void {
  const defined = new Set(Object.keys(ctx.document.components?.securitySchemes ?? {}));

  const check = (requirements: unknown, at: string): void => {
    if (!Array.isArray(requirements)) return;
    requirements.forEach((requirement, index) => {
      if (!requirement || typeof requirement !== "object") return;
      for (const name of Object.keys(requirement as Record<string, unknown>)) {
        if (!defined.has(name)) {
          report(ctx, {
            rule: "security-requirement-undefined",
            source: "structure",
            severity: "error",
            message: `Security requirement "${name}" is not declared in components.securitySchemes.`,
            pointer: extend(at, index),
            hint: `Add "${name}" under components.securitySchemes.`,
          });
        }
      }
    });
  };

  check(ctx.document.security, pointer("security"));
  for (const entry of listOperations(ctx.document)) {
    check(entry.operation.security, extend(entry.pointer, "security"));
  }
}

function validateReferences(ctx: Ctx): void {
  for (const { pointer: at, ref } of collectRefs(ctx.document)) {
    if (!ctx.resolver.isLocal(ref)) {
      report(ctx, {
        rule: "external-reference",
        source: "structure",
        severity: "warning",
        message: `External reference "${ref}" is not resolved. Bundle it before publishing.`,
        pointer: at,
        hint: "OpenAPI Studio never fetches remote references while validating untrusted documents.",
      });
      continue;
    }
    try {
      ctx.resolver.resolveOnce({ $ref: ref });
    } catch {
      report(ctx, {
        rule: "reference-unresolvable",
        source: "structure",
        severity: "error",
        message: `Reference "${ref}" does not resolve to anything in this document.`,
        pointer: at,
      });
    }
  }
}

function validateTags(ctx: Ctx): void {
  const declared = new Set((ctx.document.tags ?? []).map((tag) => tag.name).filter(Boolean));
  const seen = new Set<string>();
  (ctx.document.tags ?? []).forEach((tag, index) => {
    if (!tag.name) {
      report(ctx, {
        rule: "tag-name-missing",
        source: "structure",
        severity: "error",
        message: "Tag entries require a `name`.",
        pointer: extend(pointer("tags"), index),
      });
      return;
    }
    if (seen.has(tag.name)) {
      report(ctx, {
        rule: "tag-duplicate",
        source: "structure",
        severity: "warning",
        message: `Tag "${tag.name}" is declared more than once.`,
        pointer: extend(pointer("tags"), index),
      });
    }
    seen.add(tag.name);
  });

  for (const entry of listOperations(ctx.document)) {
    entry.tags.forEach((tag, index) => {
      if (declared.size > 0 && !declared.has(tag)) {
        report(ctx, {
          rule: "tag-undeclared",
          source: "structure",
          severity: "info",
          message: `Tag "${tag}" is used but not described in the root \`tags\` array.`,
          pointer: extend(entry.pointer, "tags", index),
          hint: "Describing tags improves generated documentation navigation.",
        });
      }
    });
  }
}
