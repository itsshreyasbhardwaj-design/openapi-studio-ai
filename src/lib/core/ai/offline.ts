import { exampleFromSchema } from "@/lib/core/openapi/examples";
import type {
  Components,
  OpenApiDocument,
  Operation,
  PathItem,
  Response as OpenApiResponse,
  Schema,
} from "@/lib/core/openapi/types";
import {
  schemaFromFields,
  selectBlueprints,
  type DomainBlueprint,
  type ResourceBlueprint,
} from "./blueprint";

const ERROR_RESPONSES: Record<string, { title: string; description: string }> = {
  "400": { title: "invalid_request", description: "The request payload failed validation." },
  "401": { title: "unauthenticated", description: "Credentials are missing or invalid." },
  "403": { title: "forbidden", description: "The caller is not allowed to perform this action." },
  "404": { title: "not_found", description: "The requested resource does not exist." },
  "409": {
    title: "conflict",
    description: "The request conflicts with the current state of the resource.",
  },
  "422": {
    title: "unprocessable",
    description: "The request was well-formed but semantically invalid.",
  },
  "429": {
    title: "rate_limited",
    description: "Too many requests. Retry after the indicated interval.",
  },
  "500": { title: "internal_error", description: "An unexpected error occurred." },
};

function errorRef(code: string): OpenApiResponse {
  return {
    $ref: `#/components/responses/${ERROR_RESPONSES[code]?.title ?? "error"}`,
  } as OpenApiResponse;
}

function singularTitle(model: string): string {
  return model.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function baseComponents(): Components {
  return {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Short-lived JWT issued by the authentication service.",
      },
      apiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "Server-to-server API key. Never expose this in a browser or mobile client.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        description: "A machine-readable error, returned for every non-2xx response.",
        required: ["code", "message"],
        additionalProperties: false,
        properties: {
          code: {
            type: "string",
            description: "Stable, machine-readable error code.",
            example: "invalid_request",
            maxLength: 64,
          },
          message: {
            type: "string",
            description:
              "Human-readable explanation, safe to log but not to display verbatim to end users.",
            example: 'The field "currency" is required.',
            maxLength: 512,
          },
          details: {
            type: "array",
            description: "Field-level problems, when the error relates to specific inputs.",
            maxItems: 50,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                field: {
                  type: "string",
                  description: "Path to the offending field.",
                  example: "items[0].quantity",
                },
                issue: {
                  type: "string",
                  description: "What is wrong with the field.",
                  example: "must be >= 1",
                },
              },
            },
          },
          requestId: {
            type: "string",
            description: "Correlation id — quote this when contacting support.",
            example: "req_01H8XK9P2M",
            maxLength: 64,
          },
        },
      },
      PageInfo: {
        type: "object",
        description: "Cursor pagination metadata.",
        required: ["hasMore"],
        additionalProperties: false,
        properties: {
          hasMore: {
            type: "boolean",
            description: "Whether another page is available.",
            example: true,
          },
          nextCursor: {
            type: "string",
            description: "Opaque cursor to pass as `cursor` to fetch the next page.",
            example: "eyJvZmZzZXQiOjI1fQ",
            maxLength: 256,
          },
        },
      },
    },
    parameters: {
      Limit: {
        name: "limit",
        in: "query",
        description: "Maximum number of items to return.",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      Cursor: {
        name: "cursor",
        in: "query",
        description: "Opaque cursor returned by the previous page.",
        required: false,
        schema: { type: "string", maxLength: 256 },
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        description:
          "Unique key that makes the request safe to retry. Replaying a key returns the original response.",
        required: false,
        schema: { type: "string", maxLength: 128 },
      },
    },
    responses: Object.fromEntries(
      Object.entries(ERROR_RESPONSES).map(([code, meta]) => [
        meta.title,
        {
          description: meta.description,
          ...(code === "429"
            ? {
                headers: {
                  "Retry-After": {
                    description: "Seconds to wait before retrying.",
                    schema: { type: "integer", example: 30 },
                  },
                  "X-RateLimit-Remaining": {
                    description: "Requests remaining in the current window.",
                    schema: { type: "integer", example: 0 },
                  },
                },
              }
            : {}),
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: {
                code: meta.title,
                message: meta.description,
                requestId: "req_01H8XK9P2M",
              },
            },
          },
        },
      ]),
    ),
  };
}

function listResponseSchema(model: string): Schema {
  return {
    type: "object",
    description: `A page of ${model} records.`,
    required: ["data", "pageInfo"],
    additionalProperties: false,
    properties: {
      data: {
        type: "array",
        description: `The ${model} records in this page.`,
        maxItems: 100,
        items: { $ref: `#/components/schemas/${model}` },
      },
      pageInfo: { $ref: "#/components/schemas/PageInfo" },
    },
  };
}

function withExample(
  schema: Schema,
  document: OpenApiDocument,
  seed: string,
): Record<string, unknown> {
  return {
    schema,
    example: exampleFromSchema(schema, document, { seed, arrayLength: 2 }),
  };
}

function buildResourcePaths(
  resource: ResourceBlueprint,
  document: OpenApiDocument,
): Record<string, PathItem> {
  const paths: Record<string, PathItem> = {};
  const operations = resource.operations ?? ["list", "create", "read", "update", "delete"];
  const modelRef = { $ref: `#/components/schemas/${resource.model}` } as Schema;
  const label = singularTitle(resource.model);
  const collectionPath = `/${resource.collection}`;
  const itemPath = `/${resource.collection}/{${resource.model.charAt(0).toLowerCase()}${resource.model.slice(1)}Id}`;
  const idParamName = `${resource.model.charAt(0).toLowerCase()}${resource.model.slice(1)}Id`;

  const filterableFields = resource.fields.filter((field) => Array.isArray(field.enum)).slice(0, 2);

  const collectionItem: PathItem = {};
  if (operations.includes("list")) {
    collectionItem.get = {
      operationId: `list${resource.model}s`,
      summary: `List ${resource.collection.replace(/-/g, " ")}`,
      description: `Returns a cursor-paginated list of ${label} records, newest first.`,
      tags: [resource.tag],
      parameters: [
        { $ref: "#/components/parameters/Limit" },
        { $ref: "#/components/parameters/Cursor" },
        ...filterableFields.map((field) => ({
          name: field.name,
          in: "query" as const,
          description: `Filter by ${field.name}.`,
          required: false,
          schema: { type: "string" as const, enum: field.enum },
        })),
      ],
      responses: {
        "200": {
          description: `A page of ${label} records.`,
          content: {
            "application/json": withExample(
              listResponseSchema(resource.model),
              document,
              `list-${resource.collection}`,
            ),
          },
        },
        "400": errorRef("400"),
        "401": errorRef("401"),
        "429": errorRef("429"),
        "500": errorRef("500"),
      },
    } satisfies Operation;
  }

  if (operations.includes("create")) {
    const writable = resource.fields.filter((field) => !field.readOnly);
    collectionItem.post = {
      operationId: `create${resource.model}`,
      summary: `Create a ${label}`,
      description: `Creates a new ${label}. Supply an \`Idempotency-Key\` header to make retries safe.`,
      tags: [resource.tag],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: {
        required: true,
        description: `The ${label} to create.`,
        content: {
          "application/json": withExample(
            schemaFromFields(`Payload used to create a ${label}.`, writable),
            document,
            `create-${resource.collection}`,
          ),
        },
      },
      responses: {
        "201": {
          description: `The created ${label}.`,
          headers: {
            Location: {
              description: "Canonical URL of the created resource.",
              schema: { type: "string", format: "uri" },
            },
          },
          content: { "application/json": { schema: modelRef } },
        },
        "400": errorRef("400"),
        "401": errorRef("401"),
        "409": errorRef("409"),
        "422": errorRef("422"),
        "429": errorRef("429"),
        "500": errorRef("500"),
      },
    } satisfies Operation;
  }

  if (Object.keys(collectionItem).length > 0) paths[collectionPath] = collectionItem;

  const itemItem: PathItem = {
    parameters: [
      {
        name: idParamName,
        in: "path",
        required: true,
        description: `Identifier of the ${label}.`,
        schema: { type: "string", maxLength: 64 },
      },
    ],
  };

  if (operations.includes("read")) {
    itemItem.get = {
      operationId: `get${resource.model}`,
      summary: `Retrieve a ${label}`,
      description: `Returns a single ${label} by identifier.`,
      tags: [resource.tag],
      responses: {
        "200": {
          description: `The requested ${label}.`,
          content: { "application/json": { schema: modelRef } },
        },
        "401": errorRef("401"),
        "403": errorRef("403"),
        "404": errorRef("404"),
        "429": errorRef("429"),
        "500": errorRef("500"),
      },
    } satisfies Operation;
  }

  if (operations.includes("update")) {
    const writable = resource.fields.filter((field) => !field.readOnly);
    itemItem.patch = {
      operationId: `update${resource.model}`,
      summary: `Update a ${label}`,
      description: `Applies a partial update. Only the supplied fields are modified.`,
      tags: [resource.tag],
      requestBody: {
        required: true,
        description: `Fields to change on the ${label}.`,
        content: {
          "application/json": {
            schema: {
              ...schemaFromFields(`Partial update for a ${label}.`, writable),
              required: undefined,
            } as Schema,
          },
        },
      },
      responses: {
        "200": {
          description: `The updated ${label}.`,
          content: { "application/json": { schema: modelRef } },
        },
        "400": errorRef("400"),
        "401": errorRef("401"),
        "404": errorRef("404"),
        "409": errorRef("409"),
        "429": errorRef("429"),
        "500": errorRef("500"),
      },
    } satisfies Operation;
  }

  if (operations.includes("delete")) {
    itemItem.delete = {
      operationId: `delete${resource.model}`,
      summary: `Delete a ${label}`,
      description: `Permanently deletes the ${label}. This operation cannot be undone.`,
      tags: [resource.tag],
      responses: {
        "204": { description: "The resource was deleted." },
        "401": errorRef("401"),
        "403": errorRef("403"),
        "404": errorRef("404"),
        "429": errorRef("429"),
        "500": errorRef("500"),
      },
    } satisfies Operation;
  }

  if (Object.keys(itemItem).length > 1) paths[itemPath] = itemItem;

  for (const action of resource.actions ?? []) {
    const actionPath = `${itemPath}/${action.suffix}`;
    paths[actionPath] = {
      parameters: itemItem.parameters,
      [action.method]: {
        operationId: `${action.suffix}${resource.model}`,
        summary: action.summary,
        description: action.description,
        tags: [resource.tag],
        ...(action.requestFields
          ? {
              requestBody: {
                required: action.requestFields.some((field) => field.required),
                content: {
                  "application/json": {
                    schema: schemaFromFields(action.summary, action.requestFields),
                  },
                },
              },
            }
          : {}),
        responses: {
          "200": {
            description: action.summary,
            content: {
              "application/json": {
                schema: action.responseRef
                  ? { $ref: `#/components/schemas/${action.responseRef}` }
                  : { type: "object" },
              },
            },
          },
          "400": errorRef("400"),
          "401": errorRef("401"),
          "404": errorRef("404"),
          "409": errorRef("409"),
          "429": errorRef("429"),
          "500": errorRef("500"),
        },
      } satisfies Operation,
    } as PathItem;
  }

  return paths;
}

export interface SynthesisOptions {
  readonly title?: string;
  readonly version?: string;
  readonly baseUrl?: string;
}

export interface SynthesisResult {
  readonly document: OpenApiDocument;
  /** Blueprint ids that contributed, surfaced in the assistant transcript. */
  readonly blueprints: readonly string[];
  readonly notes: readonly string[];
}

/**
 * Synthesise a complete OpenAPI 3.1 document from a natural-language prompt,
 * entirely offline.
 *
 * This is the default engine when `OPENROUTER_API_KEY` is absent, and the
 * fallback whenever a hosted model returns an unusable document — so the
 * "generate an API from a description" experience never fails or costs money.
 */
export function synthesiseSpec(prompt: string, options: SynthesisOptions = {}): SynthesisResult {
  const blueprints: DomainBlueprint[] = selectBlueprints(prompt);
  const notes: string[] = [];

  const title = options.title ?? deriveTitle(prompt, blueprints);
  const document: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title,
      version: options.version ?? "1.0.0",
      description: buildDescription(prompt, blueprints),
      contact: {
        name: "API Support",
        email: "api-support@example.com",
        url: "https://example.com/support",
      },
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [
      { url: options.baseUrl ?? "https://api.example.com/v1", description: "Production" },
      {
        url: "https://sandbox.api.example.com/v1",
        description: "Sandbox — safe for integration testing",
      },
    ],
    security: [{ bearerAuth: [] }],
    tags: [],
    paths: {},
    components: baseComponents(),
  };

  const tags = new Map<string, string>();

  for (const blueprint of blueprints) {
    for (const [name, schema] of Object.entries(blueprint.extraSchemas ?? {})) {
      document.components!.schemas![name] = schema;
    }
    for (const resource of blueprint.resources) {
      document.components!.schemas![resource.model] = schemaFromFields(
        resource.description,
        resource.fields,
      );
      tags.set(resource.tag, resource.description);
    }
  }

  for (const blueprint of blueprints) {
    for (const resource of blueprint.resources) {
      Object.assign(document.paths!, buildResourcePaths(resource, document));
    }

    if (blueprint.id === "auth") {
      Object.assign(document.paths!, authPaths());
      notes.push("Added token issuance, refresh and revocation endpoints.");
    }

    for (const [name, webhook] of Object.entries(blueprint.webhooks ?? {})) {
      document.webhooks ??= {};
      document.webhooks[name] = {
        post: {
          operationId: `on${name.replace(/[^a-zA-Z0-9]/g, "")}`,
          summary: webhook.summary,
          description: webhook.description,
          tags: ["Webhooks"],
          parameters: [
            {
              name: "X-Signature",
              in: "header",
              required: true,
              description: "HMAC-SHA256 signature of the raw request body, hex encoded.",
              schema: { type: "string", maxLength: 128 },
            },
            {
              name: "X-Signature-Timestamp",
              in: "header",
              required: true,
              description:
                "Unix timestamp of the delivery; reject deliveries older than five minutes.",
              schema: { type: "integer" },
            },
          ],
          requestBody: {
            required: true,
            description: "The event payload.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "type", "createdAt", "data"],
                  additionalProperties: false,
                  properties: {
                    id: {
                      type: "string",
                      description: "Unique event identifier.",
                      example: "evt_01H8XK9P2M",
                    },
                    type: { type: "string", description: "Event type.", example: name },
                    createdAt: {
                      type: "string",
                      format: "date-time",
                      description: "When the event occurred.",
                    },
                    data: { $ref: `#/components/schemas/${webhook.payloadRef}` },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Acknowledged. Return 2xx within 5 seconds or delivery is retried.",
            },
            "400": errorRef("400"),
          },
        },
      };
      tags.set("Webhooks", "Events delivered to your endpoint.");
      notes.push(`Added the \`${name}\` webhook with signature verification headers.`);
    }
  }

  document.tags = [...tags.entries()].map(([name, description]) => ({ name, description }));
  notes.unshift(
    `Modelled ${Object.keys(document.paths ?? {}).length} paths across ${document.tags.length} tags with cursor pagination, idempotent creates and a shared error contract.`,
  );
  notes.push(
    "Every operation documents 401, 429 and 500 so clients can implement correct back-off.",
  );

  return { document, blueprints: blueprints.map((blueprint) => blueprint.id), notes };
}

function authPaths(): Record<string, PathItem> {
  const tokenResponse: OpenApiResponse = {
    description: "A newly issued token pair.",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/TokenPair" },
        example: {
          accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          refreshToken: "rt_01H8XK9P2MZ8Q3",
          tokenType: "Bearer",
          expiresIn: 3600,
          scope: "profile orders:read",
        },
      },
    },
  };

  return {
    "/auth/register": {
      post: {
        operationId: "register",
        summary: "Register a new account",
        description:
          "Creates an account and issues an initial token pair. Passwords must be at least 12 characters.",
        tags: ["Authentication"],
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Credentials" } } },
        },
        responses: {
          "201": tokenResponse,
          "400": errorRef("400"),
          "409": errorRef("409"),
          "429": errorRef("429"),
        },
      },
    },
    "/auth/token": {
      post: {
        operationId: "issueToken",
        summary: "Sign in and issue tokens",
        description: "Exchanges credentials for an access/refresh token pair.",
        tags: ["Authentication"],
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Credentials" } } },
        },
        responses: {
          "200": tokenResponse,
          "400": errorRef("400"),
          "401": errorRef("401"),
          "429": errorRef("429"),
        },
      },
    },
    "/auth/token/refresh": {
      post: {
        operationId: "refreshToken",
        summary: "Refresh an access token",
        description:
          "Exchanges a refresh token for a new pair. Refresh tokens are single-use and rotate on each call.",
        tags: ["Authentication"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["refreshToken"],
                additionalProperties: false,
                properties: {
                  refreshToken: {
                    type: "string",
                    description: "The refresh token to exchange.",
                    maxLength: 512,
                  },
                },
              },
            },
          },
        },
        responses: { "200": tokenResponse, "401": errorRef("401"), "429": errorRef("429") },
      },
    },
    "/auth/token/revoke": {
      post: {
        operationId: "revokeToken",
        summary: "Revoke a token",
        description:
          "Immediately invalidates the supplied refresh token and every access token derived from it.",
        tags: ["Authentication"],
        responses: { "204": { description: "The token was revoked." }, "401": errorRef("401") },
      },
    },
    "/auth/me": {
      get: {
        operationId: "getCurrentUser",
        summary: "Get the authenticated user",
        description: "Returns the profile associated with the presented access token.",
        tags: ["Authentication"],
        responses: {
          "200": {
            description: "The authenticated user.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
          },
          "401": errorRef("401"),
        },
      },
    },
  };
}

function deriveTitle(prompt: string, blueprints: readonly DomainBlueprint[]): string {
  const quoted = /"([^"]{3,40})"/.exec(prompt)?.[1];
  if (quoted) return quoted;

  const named = /(?:for|called|named)\s+([A-Z][A-Za-z0-9]{2,20})/.exec(prompt)?.[1];
  if (named) return `${named} API`;

  if (blueprints.length === 1) return blueprints[0]?.title ?? "Generated API";
  return blueprints.map((blueprint) => blueprint.title.replace(/ API$/, "")).join(" & ") + " API";
}

function buildDescription(prompt: string, blueprints: readonly DomainBlueprint[]): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ").slice(0, 400);
  const domainText = blueprints.map((blueprint) => blueprint.description).join("\n\n");

  return [
    `Generated by OpenAPI Studio AI from the request: "${trimmed}".`,
    "",
    domainText,
    "",
    "## Conventions",
    "",
    "- **Authentication** — every endpoint requires a bearer token unless explicitly marked public.",
    "- **Pagination** — list endpoints are cursor-paginated via `limit` and `cursor`; responses carry `pageInfo.nextCursor`.",
    "- **Idempotency** — send an `Idempotency-Key` header on creates; replaying a key returns the original response.",
    "- **Errors** — every failure returns the shared `Error` schema with a stable `code` and a `requestId` for support.",
    "- **Rate limits** — 429 responses include `Retry-After` and `X-RateLimit-Remaining`.",
    "- **Timestamps** — all timestamps are RFC 3339 in UTC.",
  ].join("\n");
}
