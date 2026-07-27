import { z } from "zod";
import { collectionFromSpec } from "@/lib/core/testing/from-spec";
import { parseSpec } from "@/lib/core/openapi/document";
import { getRepository } from "@/lib/repository";
import { ApiError, jsonResponse, readJson, route } from "@/lib/server/http";
import { SpecService } from "@/lib/services/spec-service";
import { newId } from "@/lib/utils/id";
import type { RequestCollection } from "@/lib/domain/types";

const requestSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  protocol: z.enum(["rest", "graphql"]),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().max(4000),
  headers: z.record(z.string(), z.string()).default({}),
  query: z.record(z.string(), z.string()).default({}),
  body: z.string().max(1_000_000).nullable().default(null),
  variables: z.string().max(100_000).nullable().default(null),
  auth: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer"), token: z.string().max(4000) }),
    z.object({
      type: z.literal("basic"),
      username: z.string().max(200),
      password: z.string().max(200),
    }),
    z.object({
      type: z.literal("apiKey"),
      name: z.string().max(120),
      in: z.enum(["header", "query"]),
      value: z.string().max(4000),
    }),
  ]),
  assertions: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum([
          "status",
          "statusRange",
          "header",
          "jsonPath",
          "bodyContains",
          "responseTime",
          "schema",
        ]),
        target: z.string().max(200),
        operator: z.enum([
          "equals",
          "notEquals",
          "contains",
          "matches",
          "lessThan",
          "greaterThan",
          "exists",
        ]),
        expected: z.string().max(2000),
      }),
    )
    .max(50)
    .default([]),
  captures: z
    .array(z.object({ name: z.string().max(80), from: z.string().max(200) }))
    .max(20)
    .optional(),
});

const saveSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).default(""),
  specId: z.string().nullable().default(null),
  requests: z.array(requestSchema).max(200).default([]),
});

const importSchema = z.object({
  specId: z.string().min(1),
  versionId: z.string().optional(),
  name: z.string().max(160).optional(),
  baseUrl: z.string().max(500).optional(),
});

export const GET = route(async ({ identity }) => {
  const repository = await getRepository();
  const workspace = await repository.ensureWorkspace(identity.userId);
  return jsonResponse({ collections: await repository.listCollections(workspace.id) });
});

/** Save a collection, or import one from a stored specification. */
export const POST = route(
  async ({ request, identity }) => {
    const url = new URL(request.url);
    const repository = await getRepository();
    const workspace = await repository.ensureWorkspace(identity.userId);
    const now = new Date().toISOString();

    if (url.searchParams.get("mode") === "import") {
      const body = await readJson(request, importSchema);
      const { source } = await SpecService.sourceFor(identity, body.specId, body.versionId);
      const parsed = parseSpec(source);
      if (!parsed.ok)
        throw ApiError.badRequest(`The specification could not be parsed: ${parsed.error.message}`);

      const collection = collectionFromSpec(parsed.value.document, {
        workspaceId: workspace.id,
        specId: body.specId,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }),
      });
      const saved = await repository.saveCollection(collection);
      return jsonResponse({ collection: saved }, { status: 201 });
    }

    const body = await readJson(request, saveSchema);
    const existing = body.id ? await repository.getCollection(body.id) : null;

    const collection: RequestCollection = {
      id: body.id ?? newId("col"),
      workspaceId: workspace.id,
      specId: body.specId,
      name: body.name,
      description: body.description,
      requests: body.requests,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const saved = await repository.saveCollection(collection);
    return jsonResponse({ collection: saved }, { status: existing ? 200 : 201 });
  },
  { scope: "collections:write", limit: 120 },
);
