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
import { newId, slugify } from "@/lib/utils/id";
import { NotFoundError, type StudioRepository } from "./types";

export interface State {
  workspaces: Map<string, Workspace>;
  projects: Map<string, ApiProject>;
  versions: Map<string, SpecVersion>;
  comments: Map<string, Comment>;
  reviews: Map<string, ReviewRequest>;
  collections: Map<string, RequestCollection>;
  environments: Map<string, ApiEnvironment>;
  metrics: MetricSample[];
}

export function emptyState(): State {
  return {
    workspaces: new Map(),
    projects: new Map(),
    versions: new Map(),
    comments: new Map(),
    reviews: new Map(),
    collections: new Map(),
    environments: new Map(),
    metrics: [],
  };
}

const MAX_METRICS = 25_000;

/**
 * Volatile repository backed by plain maps.
 *
 * Used directly in tests and as the in-process cache for {@link FileRepository},
 * which layers durability on top by overriding {@link MemoryRepository.persist}.
 */
export class MemoryRepository implements StudioRepository {
  readonly kind: StudioRepository["kind"] = "memory";
  protected state: State = emptyState();

  async init(): Promise<void> {
    /* nothing to do */
  }

  /** Durability hook — a no-op in memory, overridden by the file backend. */
  protected async persist(): Promise<void> {
    /* no-op */
  }

  /**
   * Freshness hook, awaited at the start of every read.
   *
   * A no-op in memory. The file backend uses it to re-read the snapshot when
   * another module instance (Next.js compiles route handlers and pages into
   * separate server bundles) has written to it.
   */
  protected async beforeRead(): Promise<void> {
    /* no-op */
  }

  private sortByCreatedDesc<T extends { createdAt: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async ensureWorkspace(ownerId: string): Promise<Workspace> {
    await this.beforeRead();
    const existing = [...this.state.workspaces.values()].find((w) => w.ownerId === ownerId);
    if (existing) return existing;
    const workspace: Workspace = {
      id: newId("ws"),
      name: "Personal workspace",
      slug: slugify(`${ownerId}-workspace`) || "workspace",
      ownerId,
      memberIds: [ownerId],
      createdAt: new Date().toISOString(),
    };
    this.state.workspaces.set(workspace.id, workspace);
    await this.persist();
    return workspace;
  }

  async listWorkspaces(ownerId: string): Promise<Workspace[]> {
    await this.beforeRead();
    return [...this.state.workspaces.values()].filter(
      (w) => w.ownerId === ownerId || w.memberIds.includes(ownerId),
    );
  }

  async listProjects(ownerId: string): Promise<ApiProject[]> {
    await this.beforeRead();
    return this.sortByCreatedDesc(
      [...this.state.projects.values()].filter((p) => p.ownerId === ownerId),
    ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string): Promise<ApiProject | null> {
    await this.beforeRead();
    return this.state.projects.get(id) ?? null;
  }

  async createProject(project: ApiProject): Promise<ApiProject> {
    await this.beforeRead();
    this.state.projects.set(project.id, project);
    await this.persist();
    return project;
  }

  async updateProject(id: string, patch: Partial<ApiProject>): Promise<ApiProject> {
    await this.beforeRead();
    const existing = this.state.projects.get(id);
    if (!existing) throw new NotFoundError("API project", id);
    const next: ApiProject = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.state.projects.set(id, next);
    await this.persist();
    return next;
  }

  async deleteProject(id: string): Promise<void> {
    await this.beforeRead();
    this.state.projects.delete(id);
    for (const [key, version] of this.state.versions) {
      if (version.specId === id) this.state.versions.delete(key);
    }
    for (const [key, comment] of this.state.comments) {
      if (comment.specId === id) this.state.comments.delete(key);
    }
    for (const [key, review] of this.state.reviews) {
      if (review.specId === id) this.state.reviews.delete(key);
    }
    this.state.metrics = this.state.metrics.filter((m) => m.specId !== id);
    await this.persist();
  }

  async listVersions(specId: string): Promise<SpecVersion[]> {
    await this.beforeRead();
    return this.sortByCreatedDesc(
      [...this.state.versions.values()].filter((v) => v.specId === specId),
    );
  }

  async getVersion(id: string): Promise<SpecVersion | null> {
    await this.beforeRead();
    return this.state.versions.get(id) ?? null;
  }

  async createVersion(version: SpecVersion): Promise<SpecVersion> {
    await this.beforeRead();
    this.state.versions.set(version.id, version);
    await this.persist();
    return version;
  }

  async updateVersion(id: string, patch: Partial<SpecVersion>): Promise<SpecVersion> {
    await this.beforeRead();
    const existing = this.state.versions.get(id);
    if (!existing) throw new NotFoundError("Specification version", id);
    const next: SpecVersion = { ...existing, ...patch, id };
    this.state.versions.set(id, next);
    await this.persist();
    return next;
  }

  async listComments(specId: string): Promise<Comment[]> {
    await this.beforeRead();
    return [...this.state.comments.values()]
      .filter((c) => c.specId === specId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createComment(comment: Comment): Promise<Comment> {
    await this.beforeRead();
    this.state.comments.set(comment.id, comment);
    await this.persist();
    return comment;
  }

  async updateComment(id: string, patch: Partial<Comment>): Promise<Comment> {
    await this.beforeRead();
    const existing = this.state.comments.get(id);
    if (!existing) throw new NotFoundError("Comment", id);
    const next: Comment = { ...existing, ...patch, id };
    this.state.comments.set(id, next);
    await this.persist();
    return next;
  }

  async deleteComment(id: string): Promise<void> {
    await this.beforeRead();
    this.state.comments.delete(id);
    await this.persist();
  }

  async listReviews(specId: string): Promise<ReviewRequest[]> {
    await this.beforeRead();
    return this.sortByCreatedDesc(
      [...this.state.reviews.values()].filter((r) => r.specId === specId),
    );
  }

  async getReview(id: string): Promise<ReviewRequest | null> {
    await this.beforeRead();
    return this.state.reviews.get(id) ?? null;
  }

  async createReview(review: ReviewRequest): Promise<ReviewRequest> {
    await this.beforeRead();
    this.state.reviews.set(review.id, review);
    await this.persist();
    return review;
  }

  async updateReview(id: string, patch: Partial<ReviewRequest>): Promise<ReviewRequest> {
    await this.beforeRead();
    const existing = this.state.reviews.get(id);
    if (!existing) throw new NotFoundError("Review request", id);
    const next: ReviewRequest = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.state.reviews.set(id, next);
    await this.persist();
    return next;
  }

  async listCollections(workspaceId: string): Promise<RequestCollection[]> {
    await this.beforeRead();
    return this.sortByCreatedDesc(
      [...this.state.collections.values()].filter((c) => c.workspaceId === workspaceId),
    );
  }

  async getCollection(id: string): Promise<RequestCollection | null> {
    await this.beforeRead();
    return this.state.collections.get(id) ?? null;
  }

  async saveCollection(collection: RequestCollection): Promise<RequestCollection> {
    await this.beforeRead();
    this.state.collections.set(collection.id, collection);
    await this.persist();
    return collection;
  }

  async deleteCollection(id: string): Promise<void> {
    await this.beforeRead();
    this.state.collections.delete(id);
    await this.persist();
  }

  async listEnvironments(workspaceId: string): Promise<ApiEnvironment[]> {
    await this.beforeRead();
    return this.sortByCreatedDesc(
      [...this.state.environments.values()].filter((e) => e.workspaceId === workspaceId),
    );
  }

  async saveEnvironment(environment: ApiEnvironment): Promise<ApiEnvironment> {
    await this.beforeRead();
    this.state.environments.set(environment.id, environment);
    await this.persist();
    return environment;
  }

  async deleteEnvironment(id: string): Promise<void> {
    await this.beforeRead();
    this.state.environments.delete(id);
    await this.persist();
  }

  async recordMetric(sample: MetricSample): Promise<void> {
    await this.beforeRead();
    this.state.metrics.push(sample);
    if (this.state.metrics.length > MAX_METRICS) {
      this.state.metrics = this.state.metrics.slice(-MAX_METRICS);
    }
    await this.persist();
  }

  async listMetrics(specId: string | null, sinceIso: string): Promise<MetricSample[]> {
    await this.beforeRead();
    return this.state.metrics.filter(
      (m) => m.timestamp >= sinceIso && (specId === null || m.specId === specId),
    );
  }
}
