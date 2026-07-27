import "server-only";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ApiEnvironment,
  ApiProject,
  Comment,
  MetricSample,
  RequestCollection,
  ReviewRequest,
  SpecVersion,
  Workspace,
} from "@/lib/domain/types";
import { logger } from "@/lib/server/logger";
import { MemoryRepository } from "./memory";
import type { StudioRepository } from "./types";

interface Snapshot {
  version: 1;
  workspaces: Workspace[];
  projects: ApiProject[];
  versions: SpecVersion[];
  comments: Comment[];
  reviews: ReviewRequest[];
  collections: RequestCollection[];
  environments: ApiEnvironment[];
  metrics: MetricSample[];
}

/**
 * Durable, dependency-free repository used by the default "local mode".
 *
 * The whole workspace is a single JSON snapshot written atomically (temp file +
 * rename), which keeps the zero-config developer experience friction-free while
 * surviving process restarts.
 */
export class FileRepository extends MemoryRepository {
  override readonly kind: StudioRepository["kind"] = "file";
  private readonly file: string;
  private initialised = false;
  private loadedMtimeMs = 0;
  private writing: Promise<void> = Promise.resolve();

  constructor(file = join(process.cwd(), ".data", "studio.json")) {
    super();
    this.file = file;
  }

  override async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const [raw, info] = await Promise.all([readFile(this.file, "utf8"), stat(this.file)]);
      const snapshot = JSON.parse(raw) as Snapshot;
      this.hydrate(snapshot);
      this.loadedMtimeMs = info.mtimeMs;
      logger.debug("repository.loaded", { file: this.file, projects: snapshot.projects.length });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        logger.warn("repository.load_failed", {
          file: this.file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Re-read the snapshot when the file changed underneath us.
   *
   * Next.js compiles route handlers and server components into *separate*
   * server bundles, so a module-level singleton is not shared between them.
   * Without this check a spec created through `/api/specs` would be invisible
   * to the page that renders it — which is exactly the bug this guards.
   */
  protected override async beforeRead(): Promise<void> {
    if (!this.initialised) {
      await this.init();
      return;
    }
    try {
      const info = await stat(this.file);
      if (info.mtimeMs !== this.loadedMtimeMs) await this.load();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private hydrate(snapshot: Partial<Snapshot>): void {
    const index = <T extends { id: string }>(items: T[] | undefined): Map<string, T> =>
      new Map((items ?? []).map((item) => [item.id, item]));

    this.state = {
      workspaces: index(snapshot.workspaces),
      projects: index(snapshot.projects),
      versions: index(snapshot.versions),
      comments: index(snapshot.comments),
      reviews: index(snapshot.reviews),
      collections: index(snapshot.collections),
      environments: index(snapshot.environments),
      metrics: snapshot.metrics ?? [],
    };
  }

  private snapshot(): Snapshot {
    return {
      version: 1,
      workspaces: [...this.state.workspaces.values()],
      projects: [...this.state.projects.values()],
      versions: [...this.state.versions.values()],
      comments: [...this.state.comments.values()],
      reviews: [...this.state.reviews.values()],
      collections: [...this.state.collections.values()],
      environments: [...this.state.environments.values()],
      metrics: this.state.metrics,
    };
  }

  /**
   * Writes are awaited rather than debounced.
   *
   * A debounce would leave a read-after-write race: a client that creates a
   * spec and immediately navigates could reach a reader that has not yet seen
   * the write. Snapshots are small and the write is a single atomic rename, so
   * paying it inline is the right trade.
   */
  protected override async persist(): Promise<void> {
    await this.flush();
  }

  /** Force an immediate durable write. */
  async flush(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const payload = JSON.stringify(this.snapshot());
      const tmp = `${this.file}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(tmp, payload, "utf8");
        await rename(tmp, this.file);
        this.loadedMtimeMs = (await stat(this.file)).mtimeMs;
      } catch (error) {
        logger.error("repository.persist_failed", {
          file: this.file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    await this.writing;
  }
}
