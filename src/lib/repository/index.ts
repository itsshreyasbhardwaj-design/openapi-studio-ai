import "server-only";
import { env } from "@/lib/server/env";
import { logger } from "@/lib/server/logger";
import { FileRepository } from "./file";
import { MemoryRepository } from "./memory";
import { PostgresRepository } from "./postgres";
import type { StudioRepository } from "./types";

export type { StudioRepository };
export { NotFoundError } from "./types";
export { MemoryRepository } from "./memory";
export { FileRepository } from "./file";
export { PostgresRepository } from "./postgres";

let instance: StudioRepository | null = null;
let initialising: Promise<StudioRepository> | null = null;

function create(): StudioRepository {
  const config = env();
  if (config.NODE_ENV === "test") return new MemoryRepository();
  if (config.DATABASE_URL) return new PostgresRepository(config.DATABASE_URL);
  return new FileRepository();
}

/** Process-wide repository singleton, initialised on first use. */
export function getRepository(): Promise<StudioRepository> {
  initialising ??= (async () => {
    const repo = create();
    await repo.init();
    logger.info("repository.ready", { backend: repo.kind });
    instance = repo;
    return repo;
  })();
  return initialising;
}

/** Test helper: install a repository and reset the singleton. */
export function __setRepository(repo: StudioRepository | null): void {
  instance = repo;
  initialising = repo ? Promise.resolve(repo) : null;
}

export function peekRepository(): StudioRepository | null {
  return instance;
}
