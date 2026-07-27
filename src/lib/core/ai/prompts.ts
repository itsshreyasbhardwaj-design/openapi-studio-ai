import type { Diagnostic } from "@/lib/core/openapi/diagnostics";

export const SPEC_SYSTEM_PROMPT = `You are a distinguished API architect who writes OpenAPI 3.1 specifications.

Rules you never break:
1. Output ONLY a single YAML document. No prose, no markdown fences, no commentary.
2. The document must be valid OpenAPI 3.1.0 and parse as YAML.
3. Every operation has: operationId, summary, description, tags, and responses covering the success case plus 400, 401, 404 (where addressable), 429 and 500.
4. Reuse a shared Error schema under components.schemas.Error with 'code', 'message', 'details' and 'requestId'.
5. List endpoints are paginated with 'limit' and 'cursor' query parameters and return { data, pageInfo }.
6. Creates accept an 'Idempotency-Key' header.
7. Declare securitySchemes (bearer JWT at minimum) and apply security at the document root; mark public endpoints with 'security: []'.
8. Every schema property has a description; strings have maxLength; arrays have maxItems; request objects set 'additionalProperties: false'.
9. Sensitive fields (password, secrets, tokens) are 'writeOnly: true'.
10. Provide realistic examples for request and response bodies.
11. Document a 429 response with a Retry-After header wherever authentication is required.

Design for the consumer: names are consistent, resources are plural and kebab-case, and lifecycle states are enums.`;

export const IMPROVE_SYSTEM_PROMPT = `You are a meticulous API reviewer. You are given an OpenAPI document and a list of findings.

Return ONLY the corrected OpenAPI YAML document — no prose, no markdown fences.

Preserve every existing operation, path, schema name and semantic behaviour. Fix the findings by adding what is missing (descriptions, examples, error responses, pagination, security, constraints) rather than by removing or renaming existing surface area. If a finding cannot be fixed without a breaking change, leave that part untouched.`;

export interface GeneratePromptInput {
  readonly request: string;
  readonly title?: string;
  readonly baseUrl?: string;
  readonly style?: "minimal" | "standard" | "comprehensive";
}

export function buildGeneratePrompt(input: GeneratePromptInput): string {
  const depth =
    input.style === "minimal"
      ? "Keep the surface small: the core resource and its CRUD operations only."
      : input.style === "comprehensive"
        ? "Be thorough: include related resources, sub-resource actions, webhooks with signature headers, and filtering parameters."
        : "Cover the primary resources with full CRUD plus the obvious domain-specific actions.";

  return [
    `Design an API for: ${input.request}`,
    "",
    depth,
    input.title ? `Use "${input.title}" as info.title.` : "",
    input.baseUrl ? `Use "${input.baseUrl}" as the production server URL.` : "",
    "",
    "Return the YAML document only.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildImprovePrompt(source: string, diagnostics: readonly Diagnostic[]): string {
  const findings = diagnostics
    .slice(0, 60)
    .map(
      (diagnostic) =>
        `- [${diagnostic.severity}] ${diagnostic.pointer || "(root)"}: ${diagnostic.message}`,
    )
    .join("\n");

  return [
    "Findings to address:",
    findings || "- No automated findings; improve documentation quality and examples.",
    "",
    "Current document:",
    source,
  ].join("\n");
}

export interface RepairPromptInput {
  readonly source: string;
  readonly errors: readonly string[];
}

export function buildRepairPrompt(input: RepairPromptInput): string {
  return [
    "The document you produced is not valid. Fix these errors and return the corrected YAML document only:",
    ...input.errors.slice(0, 20).map((error) => `- ${error}`),
    "",
    input.source,
  ].join("\n");
}

/** Prompt used by the "explain this endpoint" affordance in the docs viewer. */
export function buildExplainPrompt(operationYaml: string): string {
  return [
    "Explain this API operation to a developer integrating with it for the first time.",
    "Cover: what it does, required inputs, the shape of a successful response, the failure modes worth handling, and one practical gotcha.",
    "Answer in at most 180 words of plain prose. Do not repeat the YAML.",
    "",
    operationYaml,
  ].join("\n");
}
