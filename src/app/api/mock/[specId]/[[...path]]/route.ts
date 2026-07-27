import { parseSpec } from "@/lib/core/openapi/document";
import { mockResponse, type MockOptions, type MockScenario } from "@/lib/core/mock/server";
import { getRepository } from "@/lib/repository";
import { ApiError, route } from "@/lib/server/http";
import { newId } from "@/lib/utils/id";

export const dynamic = "force-dynamic";

type Params = { specId: string; path?: string[] | undefined };

const CONTROL_PREFIX = "__mock_";

/**
 * The mock server.
 *
 * Any request under `/api/mock/<specId>/<path>` is answered from the stored
 * specification. Behaviour is tuned per request with `__mock_*` query
 * parameters (scenario, status, delay, auth) so a single mock URL can exercise
 * a client's happy path and its failure handling without redeploying anything.
 */
async function handle(request: Request, params: Params): Promise<Response> {
  const started = performance.now();
  const repository = await getRepository();
  const project = await repository.getProject(params.specId);
  if (!project) throw ApiError.notFound(`No mock is published for "${params.specId}".`);
  if (!project.currentVersionId) throw ApiError.notFound("This API has no saved version to mock.");

  const version = await repository.getVersion(project.currentVersionId);
  if (!version) throw ApiError.notFound("This API has no saved version to mock.");

  const parsed = parseSpec(version.document);
  if (!parsed.ok)
    throw ApiError.badRequest(`The stored specification is invalid: ${parsed.error.message}`);

  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!key.startsWith(CONTROL_PREFIX)) query[key] = value;
  }

  const control = (name: string): string | null => url.searchParams.get(`${CONTROL_PREFIX}${name}`);
  const options: MockOptions = {
    scenario: (control("scenario") as MockScenario | null) ?? "success",
    ...(control("status") ? { statusCode: control("status")! } : {}),
    delayMs: Math.min(10_000, Number(control("delay") ?? 0) || 0),
    errorRate: Math.max(0, Math.min(1, Number(control("errorRate") ?? 0.15))),
    enforceAuth: control("auth") !== "off",
    validateRequest: control("validate") !== "off",
    ...(control("seed") ? { seed: control("seed")! } : {}),
  };

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const body = ["GET", "HEAD"].includes(request.method) ? null : await request.text();
  const path = `/${(params.path ?? []).join("/")}`;

  const result = mockResponse(
    parsed.value.document,
    { method: request.method, path, query, headers, body: body || null },
    options,
  );

  if (result.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, result.delayMs));
  }

  const durationMs = Math.round(performance.now() - started);
  await repository.recordMetric({
    id: newId("mtr"),
    specId: params.specId,
    timestamp: new Date().toISOString(),
    method: request.method,
    path: result.path ?? path,
    status: result.status,
    durationMs,
    source: "mock",
  });

  return new Response(result.status === 204 ? null : result.body, {
    status: result.status,
    headers: {
      ...result.headers,
      "x-mock-explanation": result.explanation,
      "x-mock-duration-ms": String(durationMs),
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    },
  });
}

const handler = route<Params>(({ request, params }) => handle(request, params), {
  authenticated: false,
  scope: "mock",
  limit: 600,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-max-age": "86400",
    },
  });
}
