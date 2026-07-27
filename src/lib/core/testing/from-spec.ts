import { RefResolver } from "@/lib/core/openapi/deref";
import { exampleJson } from "@/lib/core/openapi/examples";
import { listOperations } from "@/lib/core/openapi/navigate";
import type { MediaType, OpenApiDocument, OperationEntry, Schema } from "@/lib/core/openapi/types";
import type { HttpMethod, RequestCollection, RequestDefinition } from "@/lib/domain/types";
import { newId } from "@/lib/utils/id";
import { defaultAssertions } from "./assertions";

function successStatus(entry: OperationEntry): number {
  const codes = Object.keys(entry.operation.responses ?? {});
  const success = codes.find((code) => code.startsWith("2"));
  return success ? Number.parseInt(success, 10) : 200;
}

function requestBodyExample(
  entry: OperationEntry,
  document: OpenApiDocument,
  resolver: RefResolver,
): string | null {
  if (!entry.operation.requestBody) return null;
  const body = resolver.tryResolve<{ content?: Record<string, MediaType> }>(
    entry.operation.requestBody,
  );
  const content = body?.content ?? {};
  const mediaName =
    Object.keys(content).find((name) => name.includes("json")) ?? Object.keys(content)[0];
  if (!mediaName) return null;
  const media = content[mediaName];
  if (media?.example !== undefined) return JSON.stringify(media.example, null, 2);
  const schema = media?.schema
    ? (resolver.tryResolve<Schema>(media.schema) ?? undefined)
    : undefined;
  return exampleJson(schema, document, { seed: `${entry.method}:${entry.path}:request` });
}

/**
 * Import every operation of a specification into a runnable request collection.
 *
 * Path parameters become `{{variables}}` and required query parameters are
 * pre-filled with generated examples, so an imported collection is executable
 * immediately rather than being a list of stubs.
 */
export function collectionFromSpec(
  document: OpenApiDocument,
  options: { workspaceId: string; specId: string | null; name?: string; baseUrl?: string },
): RequestCollection {
  const resolver = new RefResolver(document);
  const baseUrl = options.baseUrl ?? document.servers?.[0]?.url ?? "{{baseUrl}}";
  const now = new Date().toISOString();

  const requests: RequestDefinition[] = listOperations(document)
    .filter((entry) => entry.kind === "path")
    .map((entry) => {
      let path = entry.path;
      for (const parameter of entry.parameters) {
        if (parameter.in === "path" && parameter.name) {
          path = path.replace(`{${parameter.name}}`, `{{${parameter.name}}}`);
        }
      }

      const query: Record<string, string> = {};
      const headers: Record<string, string> = { accept: "application/json" };
      for (const parameter of entry.parameters) {
        if (!parameter.name) continue;
        if (parameter.in === "query" && parameter.required) {
          query[parameter.name] = `{{${parameter.name}}}`;
        }
        if (parameter.in === "header" && parameter.required) {
          headers[parameter.name.toLowerCase()] = `{{${parameter.name}}}`;
        }
      }

      return {
        id: newId("req"),
        name: entry.operation.summary ?? `${entry.method.toUpperCase()} ${entry.path}`,
        protocol: "rest" as const,
        method: entry.method.toUpperCase() as HttpMethod,
        url: `${baseUrl.replace(/\/$/, "")}${path}`,
        headers,
        query,
        body: requestBodyExample(entry, document, resolver),
        variables: null,
        auth: { type: "bearer" as const, token: "{{accessToken}}" },
        assertions: defaultAssertions(successStatus(entry)),
      };
    });

  return {
    id: newId("col"),
    workspaceId: options.workspaceId,
    specId: options.specId,
    name: options.name ?? document.info?.title ?? "Imported collection",
    description:
      `Generated from ${document.info?.title ?? "an OpenAPI document"} ${document.info?.version ?? ""}`.trim(),
    requests,
    createdAt: now,
    updatedAt: now,
  };
}

/** Variables an imported collection expects the environment to provide. */
export function requiredVariablesFor(collection: RequestCollection): string[] {
  const names = new Set<string>();
  const pattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  for (const request of collection.requests) {
    const haystack = [
      request.url,
      request.body ?? "",
      ...Object.values(request.headers),
      ...Object.values(request.query),
      request.auth.type === "bearer" ? request.auth.token : "",
    ].join("\n");
    for (const match of haystack.matchAll(pattern)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return [...names].sort();
}
