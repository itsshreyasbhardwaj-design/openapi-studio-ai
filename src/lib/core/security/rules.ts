import { RefResolver } from "@/lib/core/openapi/deref";
import { effectiveSecurity, listOperations } from "@/lib/core/openapi/navigate";
import { extend, pointer } from "@/lib/core/openapi/pointer";
import {
  isReference,
  type MediaType,
  type OpenApiDocument,
  type Schema,
  type SecurityScheme,
} from "@/lib/core/openapi/types";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

/** OWASP API Security Top 10 (2023) categories used to classify findings. */
export type OwaspCategory =
  | "API1:2023 Broken Object Level Authorization"
  | "API2:2023 Broken Authentication"
  | "API3:2023 Broken Object Property Level Authorization"
  | "API4:2023 Unrestricted Resource Consumption"
  | "API5:2023 Broken Function Level Authorization"
  | "API6:2023 Unrestricted Access to Sensitive Business Flows"
  | "API7:2023 Server Side Request Forgery"
  | "API8:2023 Security Misconfiguration"
  | "API9:2023 Improper Inventory Management"
  | "API10:2023 Unsafe Consumption of APIs";

export interface SecurityFinding {
  readonly id: string;
  readonly title: string;
  readonly severity: FindingSeverity;
  readonly category: OwaspCategory;
  readonly pointer: string;
  readonly detail: string;
  readonly recommendation: string;
  /** Where the finding applies, e.g. `POST /orders`. */
  readonly subject: string;
}

export interface RuleContext {
  readonly document: OpenApiDocument;
  readonly resolver: RefResolver;
}

export interface SecurityRule {
  readonly id: string;
  readonly title: string;
  readonly severity: FindingSeverity;
  readonly category: OwaspCategory;
  evaluate(ctx: RuleContext): SecurityFinding[];
}

const SENSITIVE_NAMES = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "ssn",
  "creditcard",
  "credit_card",
  "cvv",
  "pin",
  "private_key",
];

const MUTATING = new Set(["post", "put", "patch", "delete"]);

/**
 * Split an identifier into words so that matching is word-aware.
 * Without this, `shippingAddress` matches the sensitive term "pin".
 */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

function isSensitiveName(name: string): boolean {
  const tokens = words(name);
  const collapsed = tokens.join("");
  return SENSITIVE_NAMES.some((needle) => {
    const target = needle.replace(/_/g, "");
    return tokens.includes(target) || collapsed === target;
  });
}

function finding(
  rule: Pick<SecurityRule, "id" | "title" | "severity" | "category">,
  subject: string,
  pointerAt: string,
  detail: string,
  recommendation: string,
): SecurityFinding {
  return {
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    category: rule.category,
    pointer: pointerAt,
    detail,
    recommendation,
    subject,
  };
}

const noGlobalSecurity: SecurityRule = {
  id: "no-authentication-declared",
  title: "API declares no authentication",
  severity: "critical",
  category: "API2:2023 Broken Authentication",
  evaluate(ctx) {
    const hasGlobal = (ctx.document.security ?? []).length > 0;
    const operations = listOperations(ctx.document);
    const anyOperationSecured = operations.some(
      (entry) => (entry.operation.security ?? []).length > 0,
    );
    const schemes = Object.keys(ctx.document.components?.securitySchemes ?? {});
    if (hasGlobal || anyOperationSecured) return [];
    if (operations.length === 0) return [];
    return [
      finding(
        this,
        "Whole API",
        pointer("security"),
        schemes.length === 0
          ? "The document defines no security schemes and no operation requires authentication, so every endpoint is public."
          : "Security schemes are defined but never applied, so every endpoint is effectively public.",
        "Declare a root-level `security` requirement, then opt individual public endpoints out with `security: []`.",
      ),
    ];
  },
};

const unsecuredMutation: SecurityRule = {
  id: "unsecured-write-operation",
  title: "State-changing operation is unauthenticated",
  severity: "critical",
  category: "API5:2023 Broken Function Level Authorization",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    for (const entry of listOperations(ctx.document)) {
      if (!MUTATING.has(entry.method)) continue;
      if (effectiveSecurity(ctx.document, entry.operation).length > 0) continue;
      out.push(
        finding(
          this,
          `${entry.method.toUpperCase()} ${entry.path}`,
          extend(entry.pointer, "security"),
          "This operation modifies state but requires no authentication.",
          "Attach a security requirement to the operation, or inherit the document-level requirement.",
        ),
      );
    }
    return out;
  },
};

const unsecuredRead: SecurityRule = {
  id: "unsecured-read-operation",
  title: "Read operation is unauthenticated",
  severity: "medium",
  category: "API1:2023 Broken Object Level Authorization",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    const hasAnySecurity =
      (ctx.document.security ?? []).length > 0 ||
      listOperations(ctx.document).some((entry) => (entry.operation.security ?? []).length > 0);
    if (!hasAnySecurity) return []; // already covered by `no-authentication-declared`

    for (const entry of listOperations(ctx.document)) {
      if (MUTATING.has(entry.method)) continue;
      if (effectiveSecurity(ctx.document, entry.operation).length > 0) continue;
      const parameterised = entry.parameters.some((parameter) => parameter.in === "path");
      out.push(
        finding(
          this,
          `${entry.method.toUpperCase()} ${entry.path}`,
          extend(entry.pointer, "security"),
          parameterised
            ? "This operation exposes an object by identifier without authentication, enabling enumeration."
            : "This operation is readable without authentication.",
          "Confirm the endpoint is intentionally public; otherwise require a security scheme.",
        ),
      );
    }
    return out;
  },
};

const weakSchemes: SecurityRule = {
  id: "weak-security-scheme",
  title: "Weak or discouraged security scheme",
  severity: "high",
  category: "API2:2023 Broken Authentication",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    for (const [name, rawScheme] of Object.entries(
      ctx.document.components?.securitySchemes ?? {},
    )) {
      const scheme = isReference(rawScheme)
        ? ctx.resolver.tryResolve<SecurityScheme>(rawScheme)
        : rawScheme;
      if (!scheme) continue;
      const at = extend(pointer("components", "securitySchemes"), name);

      if (scheme.type === "apiKey" && scheme.in === "query") {
        out.push(
          finding(
            { ...this, severity: "high" },
            `securityScheme ${name}`,
            extend(at, "in"),
            "API keys in query strings leak into access logs, proxies, browser history and referrer headers.",
            "Move the key to a header (`in: header`) or migrate to OAuth 2.0 bearer tokens.",
          ),
        );
      }
      if (scheme.type === "http" && scheme.scheme?.toLowerCase() === "basic") {
        out.push(
          finding(
            { ...this, severity: "medium" },
            `securityScheme ${name}`,
            extend(at, "scheme"),
            "HTTP Basic transmits reusable credentials on every request and cannot be scoped or revoked individually.",
            "Prefer short-lived bearer tokens with scopes; if Basic is required, enforce TLS and rotate credentials.",
          ),
        );
      }
      if (
        scheme.type === "http" &&
        scheme.scheme?.toLowerCase() === "bearer" &&
        !scheme.bearerFormat
      ) {
        out.push(
          finding(
            { ...this, severity: "low" },
            `securityScheme ${name}`,
            extend(at, "bearerFormat"),
            "The bearer token format is unspecified, so consumers cannot validate or introspect it.",
            "Set `bearerFormat: JWT` (or the applicable format) to document token expectations.",
          ),
        );
      }
      if (scheme.flows?.implicit) {
        out.push(
          finding(
            { ...this, severity: "high" },
            `securityScheme ${name}`,
            extend(at, "flows", "implicit"),
            "The OAuth 2.0 implicit flow returns tokens in the URL fragment and is prohibited by OAuth 2.1.",
            "Use the authorization code flow with PKCE instead.",
          ),
        );
      }
      if (scheme.flows?.password) {
        out.push(
          finding(
            { ...this, severity: "medium" },
            `securityScheme ${name}`,
            extend(at, "flows", "password"),
            "The resource owner password flow requires clients to handle end-user credentials directly.",
            "Migrate to the authorization code flow with PKCE.",
          ),
        );
      }
      for (const [flowName, flow] of Object.entries(scheme.flows ?? {})) {
        if (flow && Object.keys(flow.scopes ?? {}).length === 0) {
          out.push(
            finding(
              { ...this, severity: "low" },
              `securityScheme ${name}`,
              extend(at, "flows", flowName, "scopes"),
              "The OAuth flow declares no scopes, which prevents least-privilege access control.",
              "Define granular scopes and require them per operation.",
            ),
          );
        }
      }
    }
    return out;
  },
};

const insecureTransport: SecurityRule = {
  id: "insecure-transport",
  title: "Server is reachable over plaintext HTTP",
  severity: "high",
  category: "API8:2023 Security Misconfiguration",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    (ctx.document.servers ?? []).forEach((server, index) => {
      const url = server.url ?? "";
      const isLocal = /localhost|127\.0\.0\.1|\{/.test(url);
      if (url.startsWith("http://") && !isLocal) {
        out.push(
          finding(
            this,
            url,
            extend(pointer("servers"), index, "url"),
            "Credentials and payloads sent to this server are transmitted in cleartext.",
            "Serve the API over HTTPS and redirect plaintext traffic with HSTS enabled.",
          ),
        );
      }
      if (/\/\/[^/@]+:[^/@]+@/.test(url)) {
        out.push(
          finding(
            { ...this, id: "credentials-in-server-url", severity: "critical" },
            url,
            extend(pointer("servers"), index, "url"),
            "The server URL embeds credentials, which will be copied into client configuration and logs.",
            "Remove the credentials from the URL and use a security scheme.",
          ),
        );
      }
    });
    return out;
  },
};

const noRateLimiting: SecurityRule = {
  id: "no-rate-limiting-documented",
  title: "No rate limiting is documented",
  severity: "medium",
  category: "API4:2023 Unrestricted Resource Consumption",
  evaluate(ctx) {
    const operations = listOperations(ctx.document);
    if (operations.length === 0) return [];
    const documented = operations.some((entry) =>
      Object.keys(entry.operation.responses ?? {}).includes("429"),
    );
    if (documented) return [];
    return [
      finding(
        this,
        "Whole API",
        pointer("paths"),
        "No operation documents a 429 response, so consumers cannot implement correct back-off.",
        "Document 429 with a `Retry-After` header and publish the quota in the API description.",
      ),
    ];
  },
};

const unboundedCollections: SecurityRule = {
  id: "unbounded-collection",
  title: "Collection endpoint has no bound on result size",
  severity: "medium",
  category: "API4:2023 Unrestricted Resource Consumption",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    for (const entry of listOperations(ctx.document)) {
      if (entry.method !== "get") continue;
      const returnsArray = Object.entries(entry.operation.responses ?? {}).some(
        ([code, rawResponse]) => {
          if (!code.startsWith("2")) return false;
          const response = ctx.resolver.tryResolve<{ content?: Record<string, MediaType> }>(
            rawResponse,
          );
          return Object.values(response?.content ?? {}).some((media) => {
            const schema = media?.schema ? ctx.resolver.tryResolve<Schema>(media.schema) : null;
            return schema?.type === "array";
          });
        },
      );
      if (!returnsArray) continue;
      const hasLimit = entry.parameters.some((parameter) =>
        ["limit", "per_page", "perpage", "size", "count", "page_size"].includes(
          (parameter.name ?? "").toLowerCase(),
        ),
      );
      if (!hasLimit) {
        out.push(
          finding(
            this,
            `GET ${entry.path}`,
            extend(entry.pointer, "parameters"),
            "The endpoint returns an unbounded array, allowing a single request to exhaust server memory or bandwidth.",
            "Add a `limit` parameter with a documented maximum and enforce a server-side default.",
          ),
        );
      }
    }
    return out;
  },
};

const sensitiveDataExposure: SecurityRule = {
  id: "sensitive-data-exposure",
  title: "Sensitive data exposed in an unsafe location",
  severity: "high",
  category: "API3:2023 Broken Object Property Level Authorization",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];

    for (const entry of listOperations(ctx.document)) {
      for (const parameter of entry.parameters) {
        const name = parameter.name ?? "";
        if (!isSensitiveName(name)) continue;
        if (parameter.in === "path" || parameter.in === "query") {
          out.push(
            finding(
              this,
              `${entry.method.toUpperCase()} ${entry.path}`,
              extend(entry.pointer, "parameters"),
              `Parameter "${name}" carries sensitive data in the URL, where it is logged by servers and proxies.`,
              "Move the value into a header or the request body.",
            ),
          );
        }
      }
    }

    for (const [schemaName, schema] of Object.entries(ctx.document.components?.schemas ?? {})) {
      if (isReference(schema)) continue;
      for (const [property, rawChild] of Object.entries(schema.properties ?? {})) {
        if (!isSensitiveName(property)) continue;
        const child = ctx.resolver.tryResolve<Schema>(rawChild);
        if (child?.writeOnly === true) continue;
        out.push(
          finding(
            { ...this, id: "sensitive-field-readable", severity: "high" },
            `${schemaName}.${property}`,
            extend(pointer("components", "schemas"), schemaName, "properties", property),
            `Property "${property}" looks sensitive but is not marked \`writeOnly\`, so it appears in responses.`,
            "Mark the property `writeOnly: true`, or remove it from response schemas entirely.",
          ),
        );
      }
    }
    return out;
  },
};

const massAssignment: SecurityRule = {
  id: "mass-assignment-risk",
  title: "Request body accepts unknown properties",
  severity: "medium",
  category: "API3:2023 Broken Object Property Level Authorization",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    for (const entry of listOperations(ctx.document)) {
      if (!MUTATING.has(entry.method) || !entry.operation.requestBody) continue;
      const body = ctx.resolver.tryResolve<{ content?: Record<string, MediaType> }>(
        entry.operation.requestBody,
      );
      for (const [mediaType, media] of Object.entries(body?.content ?? {})) {
        const schema = media?.schema ? ctx.resolver.tryResolve<Schema>(media.schema) : null;
        if (!schema) continue;
        const isObject = schema.type === "object" || Boolean(schema.properties);
        if (isObject && schema.additionalProperties !== false) {
          out.push(
            finding(
              this,
              `${entry.method.toUpperCase()} ${entry.path}`,
              extend(entry.pointer, "requestBody", "content", mediaType, "schema"),
              "The request schema does not forbid unknown properties, which enables mass-assignment attacks against internal fields.",
              "Set `additionalProperties: false` and accept only the properties the endpoint intends to write.",
            ),
          );
        }
      }
    }
    return out;
  },
};

const unboundedInput: SecurityRule = {
  id: "unbounded-input",
  title: "Request input has no size constraints",
  severity: "low",
  category: "API4:2023 Unrestricted Resource Consumption",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    const seen = new Set<string>();

    const inspect = (schema: Schema | null, at: string, subject: string, depth: number): void => {
      if (!schema || depth > 4) return;
      if (
        schema.type === "string" &&
        schema.maxLength === undefined &&
        !schema.enum &&
        !schema.format
      ) {
        const key = `${subject}:${at}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(
            finding(
              this,
              subject,
              at,
              "An unbounded string field allows arbitrarily large payloads.",
              "Add `maxLength` so the contract states the accepted size.",
            ),
          );
        }
      }
      if (schema.type === "array" && schema.maxItems === undefined) {
        const key = `${subject}:${at}:array`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(
            finding(
              this,
              subject,
              at,
              "An unbounded array field allows a request to contain unlimited elements.",
              "Add `maxItems` to cap the number of accepted elements.",
            ),
          );
        }
      }
      for (const [name, child] of Object.entries(schema.properties ?? {})) {
        inspect(
          ctx.resolver.tryResolve<Schema>(child),
          extend(at, "properties", name),
          subject,
          depth + 1,
        );
      }
      if (schema.items) {
        inspect(
          ctx.resolver.tryResolve<Schema>(schema.items),
          extend(at, "items"),
          subject,
          depth + 1,
        );
      }
    };

    for (const entry of listOperations(ctx.document)) {
      if (!entry.operation.requestBody) continue;
      const body = ctx.resolver.tryResolve<{ content?: Record<string, MediaType> }>(
        entry.operation.requestBody,
      );
      for (const [mediaType, media] of Object.entries(body?.content ?? {})) {
        inspect(
          media?.schema ? ctx.resolver.tryResolve<Schema>(media.schema) : null,
          extend(entry.pointer, "requestBody", "content", mediaType, "schema"),
          `${entry.method.toUpperCase()} ${entry.path}`,
          0,
        );
      }
    }
    return out;
  },
};

const errorLeakage: SecurityRule = {
  id: "error-response-leaks-internals",
  title: "Error response may leak internal details",
  severity: "medium",
  category: "API8:2023 Security Misconfiguration",
  evaluate(ctx) {
    const leaky = ["stack", "stacktrace", "trace", "exception", "sql", "query", "internal"];
    const out: SecurityFinding[] = [];
    for (const entry of listOperations(ctx.document)) {
      for (const [code, rawResponse] of Object.entries(entry.operation.responses ?? {})) {
        if (!code.startsWith("5") && !code.startsWith("4")) continue;
        const response = ctx.resolver.tryResolve<{ content?: Record<string, MediaType> }>(
          rawResponse,
        );
        for (const media of Object.values(response?.content ?? {})) {
          const schema = media?.schema ? ctx.resolver.tryResolve<Schema>(media.schema) : null;
          for (const property of Object.keys(schema?.properties ?? {})) {
            if (leaky.includes(property.toLowerCase())) {
              out.push(
                finding(
                  this,
                  `${entry.method.toUpperCase()} ${entry.path} → ${code}`,
                  extend(entry.pointer, "responses", code),
                  `The error schema exposes "${property}", which typically contains internal implementation detail.`,
                  "Return an opaque error code and correlation id; keep diagnostics in server-side logs.",
                ),
              );
            }
          }
        }
      }
    }
    return out;
  },
};

const undocumentedInventory: SecurityRule = {
  id: "inventory-gaps",
  title: "API inventory is incomplete",
  severity: "low",
  category: "API9:2023 Improper Inventory Management",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    const operations = listOperations(ctx.document);
    const deprecated = operations.filter((entry) => entry.deprecated);
    for (const entry of deprecated) {
      if (effectiveSecurity(ctx.document, entry.operation).length === 0) {
        out.push(
          finding(
            this,
            `${entry.method.toUpperCase()} ${entry.path}`,
            entry.pointer,
            "A deprecated endpoint remains publicly reachable, which is a common source of shadow API exposure.",
            "Publish a sunset date (`Sunset` header) and restrict or remove the endpoint.",
          ),
        );
      }
    }
    if ((ctx.document.servers ?? []).length === 0 && operations.length > 0) {
      out.push(
        finding(
          this,
          "Whole API",
          pointer("servers"),
          "No server is declared, so there is no authoritative record of where this API is deployed.",
          "Declare every environment under `servers` with a description.",
        ),
      );
    }
    return out;
  },
};

const webhookVerification: SecurityRule = {
  id: "webhook-without-verification",
  title: "Webhook has no signature verification",
  severity: "high",
  category: "API10:2023 Unsafe Consumption of APIs",
  evaluate(ctx) {
    const out: SecurityFinding[] = [];
    for (const entry of listOperations(ctx.document)) {
      if (entry.kind !== "webhook") continue;
      const headerNames = entry.parameters
        .filter((parameter) => parameter.in === "header")
        .map((parameter) => (parameter.name ?? "").toLowerCase());
      // Only operation-level security counts here: the document-level `security`
      // describes calls *into* the API, not deliveries the API sends out.
      const verified =
        headerNames.some((name) => name.includes("signature") || name.includes("hmac")) ||
        (entry.operation.security ?? []).length > 0;
      if (!verified) {
        out.push(
          finding(
            this,
            `Webhook ${entry.path}`,
            entry.pointer,
            "The webhook payload cannot be authenticated, so any party can forge deliveries.",
            "Document a signature header (e.g. `X-Signature` with HMAC-SHA256) and a verification procedure.",
          ),
        );
      }
    }
    return out;
  },
};

/** The full rule set, evaluated in order. */
export const SECURITY_RULES: readonly SecurityRule[] = [
  noGlobalSecurity,
  unsecuredMutation,
  unsecuredRead,
  weakSchemes,
  insecureTransport,
  noRateLimiting,
  unboundedCollections,
  sensitiveDataExposure,
  massAssignment,
  unboundedInput,
  errorLeakage,
  undocumentedInventory,
  webhookVerification,
];
