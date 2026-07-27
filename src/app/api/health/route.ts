import { capabilities, productionReadiness } from "@/lib/server/env";
import { jsonResponse, route } from "@/lib/server/http";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

/** Liveness and configuration report. Public so uptime checks can hit it. */
export const GET = route(
  async () => {
    const repository = await getRepository();
    const readiness = productionReadiness();

    return jsonResponse(
      {
        status: readiness.ready ? "ok" : "degraded",
        version: process.env.npm_package_version ?? "0.1.0",
        capabilities: capabilities(),
        persistence: repository.kind,
        problems: readiness.problems,
        time: new Date().toISOString(),
      },
      { status: readiness.ready ? 200 : 503 },
    );
  },
  { authenticated: false, scope: "health", limit: 60 },
);
