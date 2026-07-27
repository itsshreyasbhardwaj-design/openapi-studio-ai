import "server-only";
import { z } from "zod";

/**
 * Environment contract.
 *
 * Everything is optional by design: OpenAPI Studio AI must boot and be fully
 * usable with an empty environment ("local mode"). Presence of a variable
 * *upgrades* a capability rather than being a hard requirement, which keeps the
 * open-source developer experience friction-free and the platform free to run.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_MODE: z.enum(["local", "production"]).default("local"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  ENCRYPTION_KEY: z.string().min(32).optional(),
  DATABASE_URL: z.string().min(1).optional(),

  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),

  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-3.5-sonnet"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  MAX_SPEC_BYTES: z.coerce.number().int().positive().default(2_000_000),
});

export type Env = z.infer<typeof schema>;

export class EnvironmentError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvironmentError";
  }
}

let cached: Env | null = null;

function read(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new EnvironmentError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/** Validated environment; parsed once per process. */
export function env(): Env {
  cached ??= read();
  return cached;
}

/** Reset the memoised environment. Test-only. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Runtime capability matrix derived from the environment. The UI renders this
 * so users always know which subsystems are live versus running locally.
 */
export interface Capabilities {
  readonly persistence: "postgres" | "file";
  readonly auth: "clerk" | "local";
  readonly ai: "openrouter" | "offline";
  readonly encryptionAtRest: boolean;
  readonly mode: Env["APP_MODE"];
}

export function capabilities(): Capabilities {
  const e = env();
  return {
    persistence: e.DATABASE_URL ? "postgres" : "file",
    auth: e.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && e.CLERK_SECRET_KEY ? "clerk" : "local",
    ai: e.OPENROUTER_API_KEY ? "openrouter" : "offline",
    encryptionAtRest: Boolean(e.ENCRYPTION_KEY),
    mode: e.APP_MODE,
  };
}

/**
 * Production readiness assertions. Called by `/api/health` and at build time so
 * that a deployment with `APP_MODE=production` cannot silently run with
 * development defaults (local auth, unencrypted secrets, ephemeral storage).
 */
export function productionReadiness(): { ready: boolean; problems: string[] } {
  const e = env();
  const problems: string[] = [];
  if (e.APP_MODE !== "production") return { ready: true, problems };

  if (!e.DATABASE_URL) problems.push("DATABASE_URL is required in production mode.");
  if (!e.CLERK_SECRET_KEY || !e.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    problems.push("Clerk keys are required in production mode.");
  }
  if (!e.ENCRYPTION_KEY) {
    problems.push("ENCRYPTION_KEY is required to encrypt stored secrets in production mode.");
  }
  if (e.NEXT_PUBLIC_APP_URL.startsWith("http://")) {
    problems.push("NEXT_PUBLIC_APP_URL must use HTTPS in production mode.");
  }
  return { ready: problems.length === 0, problems };
}
