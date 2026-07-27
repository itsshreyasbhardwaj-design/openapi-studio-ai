import { z } from "zod";
import type { ApiEnvironment } from "@/lib/domain/types";
import { getRepository } from "@/lib/repository";
import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  isEncryptionAvailable,
} from "@/lib/server/crypto";
import { jsonResponse, readJson, route } from "@/lib/server/http";
import { newId } from "@/lib/utils/id";

const saveSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().max(500).default(""),
  variables: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        value: z.string().max(8000),
        secret: z.boolean().default(false),
      }),
    )
    .max(200)
    .default([]),
});

const MASK = "••••••••";

/**
 * Environments hold the variables the API client interpolates.
 *
 * Secret values are encrypted at rest when `ENCRYPTION_KEY` is configured and
 * are never returned to the browser — the client receives a mask and sends the
 * mask back unchanged when a secret is not being edited.
 */
function toWire(environment: ApiEnvironment): ApiEnvironment {
  return {
    ...environment,
    variables: environment.variables.map((variable) =>
      variable.secret ? { ...variable, value: MASK } : variable,
    ),
  };
}

export const GET = route(async ({ identity }) => {
  const repository = await getRepository();
  const workspace = await repository.ensureWorkspace(identity.userId);
  const environments = await repository.listEnvironments(workspace.id);
  return jsonResponse({
    environments: environments.map(toWire),
    encryptionAvailable: isEncryptionAvailable(),
  });
});

export const POST = route(
  async ({ request, identity }) => {
    const body = await readJson(request, saveSchema);
    const repository = await getRepository();
    const workspace = await repository.ensureWorkspace(identity.userId);

    const existing = body.id
      ? (await repository.listEnvironments(workspace.id)).find((item) => item.id === body.id)
      : undefined;

    const variables = body.variables.map((variable) => {
      if (!variable.secret) return variable;
      // A masked value means "unchanged" — reuse the stored ciphertext.
      if (variable.value === MASK) {
        const previous = existing?.variables.find((item) => item.key === variable.key);
        return previous ?? { ...variable, value: "" };
      }
      return {
        ...variable,
        value: isEncryptionAvailable() ? encryptSecret(variable.value) : variable.value,
      };
    });

    const environment: ApiEnvironment = {
      id: body.id ?? newId("env"),
      workspaceId: workspace.id,
      name: body.name,
      baseUrl: body.baseUrl,
      variables,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    const saved = await repository.saveEnvironment(environment);
    return jsonResponse({ environment: toWire(saved) }, { status: existing ? 200 : 201 });
  },
  { scope: "environments:write", limit: 60 },
);

/** Resolve an environment into a plain variable bag for server-side execution. */
export async function resolveVariables(
  userId: string,
  environmentId: string | null,
): Promise<Record<string, string>> {
  if (!environmentId) return {};
  const repository = await getRepository();
  const workspace = await repository.ensureWorkspace(userId);
  const environment = (await repository.listEnvironments(workspace.id)).find(
    (item) => item.id === environmentId,
  );
  if (!environment) return {};

  const bag: Record<string, string> = {};
  if (environment.baseUrl) bag.baseUrl = environment.baseUrl;
  for (const variable of environment.variables) {
    bag[variable.key] =
      variable.secret && isEncrypted(variable.value)
        ? decryptSecret(variable.value)
        : variable.value;
  }
  return bag;
}
