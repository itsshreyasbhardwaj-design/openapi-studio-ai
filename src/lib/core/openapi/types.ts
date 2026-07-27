/**
 * Structural types for OpenAPI 3.0.x / 3.1.x documents.
 *
 * These are intentionally *permissive*: a design tool must be able to load,
 * display and repair partially-invalid documents rather than refuse them. The
 * validator — not the type system — is responsible for reporting problems.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface Reference {
  $ref: string;
  summary?: string;
  description?: string;
}

export type MaybeRef<T> = T | Reference;

export function isReference(value: unknown): value is Reference {
  return (
    typeof value === "object" && value !== null && typeof (value as Reference).$ref === "string"
  );
}

export interface Contact {
  name?: string;
  url?: string;
  email?: string;
}

export interface License {
  name?: string;
  url?: string;
  identifier?: string;
}

export interface Info {
  title?: string;
  version?: string;
  description?: string;
  summary?: string;
  termsOfService?: string;
  contact?: Contact;
  license?: License;
}

export interface ServerVariable {
  enum?: string[];
  default?: string;
  description?: string;
}

export interface Server {
  url?: string;
  description?: string;
  variables?: Record<string, ServerVariable>;
}

export interface ExternalDocs {
  url?: string;
  description?: string;
}

export interface Tag {
  name?: string;
  description?: string;
  externalDocs?: ExternalDocs;
}

export type SchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";

export interface Schema {
  $ref?: string;
  type?: SchemaType | SchemaType[];
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  example?: unknown;
  examples?: unknown[];
  enum?: unknown[];
  const?: unknown;

  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  prefixItems?: Schema[];

  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  not?: Schema;
  discriminator?: { propertyName?: string; mapping?: Record<string, string> };

  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;

  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  xml?: Record<string, unknown>;

  [extension: `x-${string}`]: unknown;
}

export interface Example {
  summary?: string;
  description?: string;
  value?: unknown;
  externalValue?: string;
}

export interface Encoding {
  contentType?: string;
  headers?: Record<string, MaybeRef<Header>>;
  style?: string;
  explode?: boolean;
}

export interface MediaType {
  schema?: MaybeRef<Schema>;
  example?: unknown;
  examples?: Record<string, MaybeRef<Example>>;
  encoding?: Record<string, Encoding>;
}

export type ParameterLocation = "query" | "header" | "path" | "cookie";

export interface Parameter {
  name?: string;
  in?: ParameterLocation;
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: string;
  explode?: boolean;
  schema?: MaybeRef<Schema>;
  example?: unknown;
  examples?: Record<string, MaybeRef<Example>>;
  content?: Record<string, MediaType>;
}

export type Header = Omit<Parameter, "name" | "in">;

export interface RequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, MediaType>;
}

export interface Link {
  operationId?: string;
  operationRef?: string;
  parameters?: Record<string, unknown>;
  requestBody?: unknown;
  description?: string;
  server?: Server;
}

export interface Response {
  description?: string;
  headers?: Record<string, MaybeRef<Header>>;
  content?: Record<string, MediaType>;
  links?: Record<string, MaybeRef<Link>>;
}

export type Responses = Record<string, MaybeRef<Response>>;

export type SecurityRequirement = Record<string, string[]>;

export interface OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes?: Record<string, string>;
}

export interface SecurityScheme {
  type?: "apiKey" | "http" | "oauth2" | "openIdConnect" | "mutualTLS";
  description?: string;
  name?: string;
  in?: "query" | "header" | "cookie";
  scheme?: string;
  bearerFormat?: string;
  flows?: {
    implicit?: OAuthFlow;
    password?: OAuthFlow;
    clientCredentials?: OAuthFlow;
    authorizationCode?: OAuthFlow;
  };
  openIdConnectUrl?: string;
}

export const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;
export type HttpMethodLower = (typeof HTTP_METHODS)[number];

export function isHttpMethod(value: string): value is HttpMethodLower {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

export interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  externalDocs?: ExternalDocs;
  operationId?: string;
  parameters?: MaybeRef<Parameter>[];
  requestBody?: MaybeRef<RequestBody>;
  responses?: Responses;
  callbacks?: Record<string, MaybeRef<Record<string, PathItem>>>;
  deprecated?: boolean;
  security?: SecurityRequirement[];
  servers?: Server[];
  [extension: `x-${string}`]: unknown;
}

export interface PathItem {
  $ref?: string;
  summary?: string;
  description?: string;
  servers?: Server[];
  parameters?: MaybeRef<Parameter>[];
  get?: Operation;
  put?: Operation;
  post?: Operation;
  delete?: Operation;
  options?: Operation;
  head?: Operation;
  patch?: Operation;
  trace?: Operation;
}

export interface Components {
  schemas?: Record<string, Schema>;
  responses?: Record<string, MaybeRef<Response>>;
  parameters?: Record<string, MaybeRef<Parameter>>;
  examples?: Record<string, MaybeRef<Example>>;
  requestBodies?: Record<string, MaybeRef<RequestBody>>;
  headers?: Record<string, MaybeRef<Header>>;
  securitySchemes?: Record<string, MaybeRef<SecurityScheme>>;
  links?: Record<string, MaybeRef<Link>>;
  callbacks?: Record<string, MaybeRef<Record<string, PathItem>>>;
  pathItems?: Record<string, PathItem>;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: Info;
  jsonSchemaDialect?: string;
  servers?: Server[];
  paths?: Record<string, PathItem>;
  webhooks?: Record<string, MaybeRef<PathItem>>;
  components?: Components;
  security?: SecurityRequirement[];
  tags?: Tag[];
  externalDocs?: ExternalDocs;
  [extension: `x-${string}`]: unknown;
}

/** A single operation flattened with everything needed to render or call it. */
export interface OperationEntry {
  readonly path: string;
  readonly method: HttpMethodLower;
  readonly operationId: string;
  readonly operation: Operation;
  /** Path-level parameters merged with operation-level parameters. */
  readonly parameters: readonly Parameter[];
  readonly tags: readonly string[];
  readonly deprecated: boolean;
  /** JSON pointer to the operation within the document. */
  readonly pointer: string;
  readonly kind: "path" | "webhook";
}
