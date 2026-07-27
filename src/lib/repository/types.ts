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

/**
 * Persistence port.
 *
 * Every storage backend (in-memory, file, PostgreSQL/Supabase) implements this
 * single interface, so features depend on the abstraction rather than on a
 * database driver — the Dependency Inversion half of SOLID applied to storage.
 */
export interface StudioRepository {
  readonly kind: "memory" | "file" | "postgres";

  /** Called once before first use. Safe to call repeatedly. */
  init(): Promise<void>;

  // -- workspaces -----------------------------------------------------------
  ensureWorkspace(ownerId: string): Promise<Workspace>;
  listWorkspaces(ownerId: string): Promise<Workspace[]>;

  // -- API projects ---------------------------------------------------------
  listProjects(ownerId: string): Promise<ApiProject[]>;
  getProject(id: string): Promise<ApiProject | null>;
  createProject(project: ApiProject): Promise<ApiProject>;
  updateProject(id: string, patch: Partial<ApiProject>): Promise<ApiProject>;
  deleteProject(id: string): Promise<void>;

  // -- versions -------------------------------------------------------------
  listVersions(specId: string): Promise<SpecVersion[]>;
  getVersion(id: string): Promise<SpecVersion | null>;
  createVersion(version: SpecVersion): Promise<SpecVersion>;
  updateVersion(id: string, patch: Partial<SpecVersion>): Promise<SpecVersion>;

  // -- collaboration --------------------------------------------------------
  listComments(specId: string): Promise<Comment[]>;
  createComment(comment: Comment): Promise<Comment>;
  updateComment(id: string, patch: Partial<Comment>): Promise<Comment>;
  deleteComment(id: string): Promise<void>;

  listReviews(specId: string): Promise<ReviewRequest[]>;
  getReview(id: string): Promise<ReviewRequest | null>;
  createReview(review: ReviewRequest): Promise<ReviewRequest>;
  updateReview(id: string, patch: Partial<ReviewRequest>): Promise<ReviewRequest>;

  // -- client workspace -----------------------------------------------------
  listCollections(workspaceId: string): Promise<RequestCollection[]>;
  getCollection(id: string): Promise<RequestCollection | null>;
  saveCollection(collection: RequestCollection): Promise<RequestCollection>;
  deleteCollection(id: string): Promise<void>;

  listEnvironments(workspaceId: string): Promise<ApiEnvironment[]>;
  saveEnvironment(environment: ApiEnvironment): Promise<ApiEnvironment>;
  deleteEnvironment(id: string): Promise<void>;

  // -- telemetry ------------------------------------------------------------
  recordMetric(sample: MetricSample): Promise<void>;
  listMetrics(specId: string | null, sinceIso: string): Promise<MetricSample[]>;
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(entity: string, id: string) {
    super(`${entity} "${id}" was not found.`);
    this.name = "NotFoundError";
  }
}
