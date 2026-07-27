import "server-only";
import postgres from "postgres";
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
import { logger } from "@/lib/server/logger";
import { NotFoundError, type StudioRepository } from "./types";

type Row = Record<string, unknown>;

/** postgres.js types JSONB params narrowly; our aggregates are plain JSON. */
const asJson = (value: unknown): postgres.JSONValue => value as postgres.JSONValue;

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? new Date().toISOString());

/**
 * PostgreSQL / Supabase backend.
 *
 * Relational columns are used for everything that is queried or ordered by,
 * while structurally free-form aggregates (review decisions, collection
 * requests, environment variables) are stored as JSONB — a deliberate balance
 * between query-ability and schema churn.
 */
export class PostgresRepository implements StudioRepository {
  readonly kind: StudioRepository["kind"] = "postgres";
  private readonly sql: postgres.Sql;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, {
      max: 5,
      idle_timeout: 20,
      prepare: false, // compatible with Supabase's transaction pooler
      onnotice: () => {},
    });
  }

  init(): Promise<void> {
    this.ready ??= this.migrate();
    return this.ready;
  }

  private async migrate(): Promise<void> {
    const sql = this.sql;
    await sql`
      CREATE TABLE IF NOT EXISTS workspaces (
        id           text PRIMARY KEY,
        name         text NOT NULL,
        slug         text NOT NULL,
        owner_id     text NOT NULL,
        member_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at   timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces (owner_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS api_projects (
        id                 text PRIMARY KEY,
        workspace_id       text NOT NULL,
        owner_id           text NOT NULL,
        name               text NOT NULL,
        slug               text NOT NULL,
        description        text NOT NULL DEFAULT '',
        kind               text NOT NULL DEFAULT 'rest',
        status             text NOT NULL DEFAULT 'draft',
        tags               jsonb NOT NULL DEFAULT '[]'::jsonb,
        current_version_id text,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS api_projects_owner_idx ON api_projects (owner_id, updated_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS spec_versions (
        id          text PRIMARY KEY,
        spec_id     text NOT NULL REFERENCES api_projects(id) ON DELETE CASCADE,
        label       text NOT NULL,
        document    text NOT NULL,
        format      text NOT NULL DEFAULT 'yaml',
        hash        text NOT NULL,
        message     text NOT NULL DEFAULT '',
        status      text NOT NULL DEFAULT 'draft',
        created_by  text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS spec_versions_spec_idx ON spec_versions (spec_id, created_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS spec_comments (
        id          text PRIMARY KEY,
        spec_id     text NOT NULL REFERENCES api_projects(id) ON DELETE CASCADE,
        version_id  text,
        pointer     text NOT NULL DEFAULT '',
        body        text NOT NULL,
        author_id   text NOT NULL,
        author_name text NOT NULL,
        resolved    boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS spec_comments_spec_idx ON spec_comments (spec_id, created_at)`;

    await sql`
      CREATE TABLE IF NOT EXISTS review_requests (
        id                text PRIMARY KEY,
        spec_id           text NOT NULL REFERENCES api_projects(id) ON DELETE CASCADE,
        version_id        text NOT NULL,
        base_version_id   text,
        title             text NOT NULL,
        description       text NOT NULL DEFAULT '',
        status            text NOT NULL DEFAULT 'open',
        requested_by      text NOT NULL,
        requested_by_name text NOT NULL,
        reviewers         jsonb NOT NULL DEFAULT '[]'::jsonb,
        decisions         jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS review_requests_spec_idx ON review_requests (spec_id, created_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS request_collections (
        id           text PRIMARY KEY,
        workspace_id text NOT NULL,
        spec_id      text,
        name         text NOT NULL,
        description  text NOT NULL DEFAULT '',
        requests     jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS request_collections_ws_idx ON request_collections (workspace_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS api_environments (
        id           text PRIMARY KEY,
        workspace_id text NOT NULL,
        name         text NOT NULL,
        base_url     text NOT NULL DEFAULT '',
        variables    jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at   timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS api_environments_ws_idx ON api_environments (workspace_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS metric_samples (
        id          text PRIMARY KEY,
        spec_id     text NOT NULL,
        ts          timestamptz NOT NULL DEFAULT now(),
        method      text NOT NULL,
        path        text NOT NULL,
        status      integer NOT NULL,
        duration_ms integer NOT NULL,
        source      text NOT NULL
      )`;
    await sql`CREATE INDEX IF NOT EXISTS metric_samples_spec_ts_idx ON metric_samples (spec_id, ts DESC)`;

    logger.info("repository.migrated", { backend: "postgres" });
  }

  // -- mappers ---------------------------------------------------------------
  private toWorkspace(row: Row): Workspace {
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      ownerId: String(row.owner_id),
      memberIds: (row.member_ids as string[]) ?? [],
      createdAt: iso(row.created_at),
    };
  }

  private toProject(row: Row): ApiProject {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      ownerId: String(row.owner_id),
      name: String(row.name),
      slug: String(row.slug),
      description: String(row.description ?? ""),
      kind: row.kind as ApiProject["kind"],
      status: row.status as ApiProject["status"],
      tags: (row.tags as string[]) ?? [],
      currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private toVersion(row: Row): SpecVersion {
    return {
      id: String(row.id),
      specId: String(row.spec_id),
      label: String(row.label),
      document: String(row.document),
      format: row.format as SpecVersion["format"],
      hash: String(row.hash),
      message: String(row.message ?? ""),
      status: row.status as SpecVersion["status"],
      createdBy: String(row.created_by),
      createdAt: iso(row.created_at),
    };
  }

  private toComment(row: Row): Comment {
    return {
      id: String(row.id),
      specId: String(row.spec_id),
      versionId: row.version_id ? String(row.version_id) : null,
      pointer: String(row.pointer ?? ""),
      body: String(row.body),
      authorId: String(row.author_id),
      authorName: String(row.author_name),
      resolved: Boolean(row.resolved),
      createdAt: iso(row.created_at),
    };
  }

  private toReview(row: Row): ReviewRequest {
    return {
      id: String(row.id),
      specId: String(row.spec_id),
      versionId: String(row.version_id),
      baseVersionId: row.base_version_id ? String(row.base_version_id) : null,
      title: String(row.title),
      description: String(row.description ?? ""),
      status: row.status as ReviewRequest["status"],
      requestedBy: String(row.requested_by),
      requestedByName: String(row.requested_by_name),
      reviewers: (row.reviewers as string[]) ?? [],
      decisions: (row.decisions as ReviewRequest["decisions"]) ?? [],
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private toCollection(row: Row): RequestCollection {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      specId: row.spec_id ? String(row.spec_id) : null,
      name: String(row.name),
      description: String(row.description ?? ""),
      requests: (row.requests as RequestCollection["requests"]) ?? [],
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private toEnvironment(row: Row): ApiEnvironment {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      baseUrl: String(row.base_url ?? ""),
      variables: (row.variables as ApiEnvironment["variables"]) ?? [],
      createdAt: iso(row.created_at),
    };
  }

  // -- workspaces ------------------------------------------------------------
  async ensureWorkspace(ownerId: string): Promise<Workspace> {
    await this.init();
    const rows = await this.sql<Row[]>`
      SELECT * FROM workspaces WHERE owner_id = ${ownerId} ORDER BY created_at LIMIT 1`;
    const first = rows[0];
    if (first) return this.toWorkspace(first);

    const workspace: Workspace = {
      id: newId("ws"),
      name: "Personal workspace",
      slug: slugify(`${ownerId}-workspace`) || "workspace",
      ownerId,
      memberIds: [ownerId],
      createdAt: new Date().toISOString(),
    };
    await this.sql`
      INSERT INTO workspaces (id, name, slug, owner_id, member_ids, created_at)
      VALUES (${workspace.id}, ${workspace.name}, ${workspace.slug}, ${workspace.ownerId},
              ${this.sql.json(asJson([...workspace.memberIds]))}, ${workspace.createdAt})`;
    return workspace;
  }

  async listWorkspaces(ownerId: string): Promise<Workspace[]> {
    await this.init();
    const rows = await this.sql<Row[]>`SELECT * FROM workspaces WHERE owner_id = ${ownerId}`;
    return rows.map((row) => this.toWorkspace(row));
  }

  // -- projects --------------------------------------------------------------
  async listProjects(ownerId: string): Promise<ApiProject[]> {
    await this.init();
    const rows = await this.sql<Row[]>`
      SELECT * FROM api_projects WHERE owner_id = ${ownerId} ORDER BY updated_at DESC`;
    return rows.map((row) => this.toProject(row));
  }

  async getProject(id: string): Promise<ApiProject | null> {
    await this.init();
    const rows = await this.sql<Row[]>`SELECT * FROM api_projects WHERE id = ${id}`;
    const row = rows[0];
    return row ? this.toProject(row) : null;
  }

  async createProject(project: ApiProject): Promise<ApiProject> {
    await this.init();
    await this.sql`
      INSERT INTO api_projects (id, workspace_id, owner_id, name, slug, description, kind, status,
                                tags, current_version_id, created_at, updated_at)
      VALUES (${project.id}, ${project.workspaceId}, ${project.ownerId}, ${project.name}, ${project.slug},
              ${project.description}, ${project.kind}, ${project.status},
              ${this.sql.json(asJson([...project.tags]))}, ${project.currentVersionId},
              ${project.createdAt}, ${project.updatedAt})`;
    return project;
  }

  async updateProject(id: string, patch: Partial<ApiProject>): Promise<ApiProject> {
    await this.init();
    const existing = await this.getProject(id);
    if (!existing) throw new NotFoundError("API project", id);
    const next: ApiProject = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    await this.sql`
      UPDATE api_projects SET
        name = ${next.name}, slug = ${next.slug}, description = ${next.description},
        kind = ${next.kind}, status = ${next.status}, tags = ${this.sql.json(asJson([...next.tags]))},
        current_version_id = ${next.currentVersionId}, updated_at = ${next.updatedAt}
      WHERE id = ${id}`;
    return next;
  }

  async deleteProject(id: string): Promise<void> {
    await this.init();
    await this.sql`DELETE FROM metric_samples WHERE spec_id = ${id}`;
    await this.sql`DELETE FROM api_projects WHERE id = ${id}`;
  }

  // -- versions --------------------------------------------------------------
  async listVersions(specId: string): Promise<SpecVersion[]> {
    await this.init();
    const rows = await this.sql<Row[]>`
      SELECT * FROM spec_versions WHERE spec_id = ${specId} ORDER BY created_at DESC`;
    return rows.map((row) => this.toVersion(row));
  }

  async getVersion(id: string): Promise<SpecVersion | null> {
    await this.init();
    const rows = await this.sql<Row[]>`SELECT * FROM spec_versions WHERE id = ${id}`;
    const row = rows[0];
    return row ? this.toVersion(row) : null;
  }

  async createVersion(version: SpecVersion): Promise<SpecVersion> {
    await this.init();
    await this.sql`
      INSERT INTO spec_versions (id, spec_id, label, document, format, hash, message, status, created_by, created_at)
      VALUES (${version.id}, ${version.specId}, ${version.label}, ${version.document}, ${version.format},
              ${version.hash}, ${version.message}, ${version.status}, ${version.createdBy}, ${version.createdAt})`;
    return version;
  }

  async updateVersion(id: string, patch: Partial<SpecVersion>): Promise<SpecVersion> {
    await this.init();
    const existing = await this.getVersion(id);
    if (!existing) throw new NotFoundError("Specification version", id);
    const next: SpecVersion = { ...existing, ...patch, id };
    await this.sql`
      UPDATE spec_versions SET label = ${next.label}, document = ${next.document}, format = ${next.format},
        hash = ${next.hash}, message = ${next.message}, status = ${next.status}
      WHERE id = ${id}`;
    return next;
  }

  // -- collaboration ---------------------------------------------------------
  async listComments(specId: string): Promise<Comment[]> {
    await this.init();
    const rows = await this.sql<Row[]>`
      SELECT * FROM spec_comments WHERE spec_id = ${specId} ORDER BY created_at`;
    return rows.map((row) => this.toComment(row));
  }

  async createComment(comment: Comment): Promise<Comment> {
    await this.init();
    await this.sql`
      INSERT INTO spec_comments (id, spec_id, version_id, pointer, body, author_id, author_name, resolved, created_at)
      VALUES (${comment.id}, ${comment.specId}, ${comment.versionId}, ${comment.pointer}, ${comment.body},
              ${comment.authorId}, ${comment.authorName}, ${comment.resolved}, ${comment.createdAt})`;
    return comment;
  }

  async updateComment(id: string, patch: Partial<Comment>): Promise<Comment> {
    await this.init();
    const rows = await this.sql<Row[]>`SELECT * FROM spec_comments WHERE id = ${id}`;
    const row = rows[0];
    if (!row) throw new NotFoundError("Comment", id);
    const next: Comment = { ...this.toComment(row), ...patch, id };
    await this.sql`
      UPDATE spec_comments SET body = ${next.body}, resolved = ${next.resolved}, pointer = ${next.pointer}
      WHERE id = ${id}`;
    return next;
  }

  async deleteComment(id: string): Promise<void> {
    await this.init();
    await this.sql`DELETE FROM spec_comments WHERE id = ${id}`;
  }

  async listReviews(specId: string): Promise<ReviewRequest[]> {
    await this.init();
    const rows = await this.sql<Row[]>`
      SELECT * FROM review_requests WHERE spec_id = ${specId} ORDER BY created_at DESC`;
    return rows.map((row) => this.toReview(row));
  }

  async getReview(id: string): Promise<ReviewRequest | null> {
    await this.init();
    const rows = await this.sql<Row[]>`SELECT * FROM review_requests WHERE id = ${id}`;
    const row = rows[0];
    return row ? this.toReview(row) : null;
  }

  async createReview(review: ReviewRequest): Promise<ReviewRequest> {
    await this.init();
    await this.sql`
      INSERT INTO review_requests (id, spec_id, version_id, base_version_id, title, description, status,
                                   requested_by, requested_by_name, reviewers, decisions, created_at, updated_at)
      VALUES (${review.id}, ${review.specId}, ${review.versionId}, ${review.baseVersionId}, ${review.title},
              ${review.description}, ${review.status}, ${review.requestedBy}, ${review.requestedByName},
              ${this.sql.json(asJson([...review.reviewers]))}, ${this.sql.json(asJson([...review.decisions]))},
              ${review.createdAt}, ${review.updatedAt})`;
    return review;
  }

  async updateReview(id: string, patch: Partial<ReviewRequest>): Promise<ReviewRequest> {
    await this.init();
    const existing = await this.getReview(id);
    if (!existing) throw new NotFoundError("Review request", id);
    const next: ReviewRequest = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    await this.sql`
      UPDATE review_requests SET title = ${next.title}, description = ${next.description},
        status = ${next.status}, reviewers = ${this.sql.json(asJson([...next.reviewers]))},
        decisions = ${this.sql.json(asJson([...next.decisions]))}, updated_at = ${next.updatedAt}
      WHERE id = ${id}`;
    return next;
  }

  // -- client workspace ------------------------------------------------------
  async listCollections(workspaceId: string): Promise<RequestCollection[]> {
    await this.init();
    const rows = await this.sql<Row[]>`
      SELECT * FROM request_collections WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
    return rows.map((row) => this.toCollection(row));
  }

  async getCollection(id: string): Promise<RequestCollection | null> {
    await this.init();
    const rows = await this.sql<Row[]>`SELECT * FROM request_collections WHERE id = ${id}`;
    const row = rows[0];
    return row ? this.toCollection(row) : null;
  }

  async saveCollection(collection: RequestCollection): Promise<RequestCollection> {
    await this.init();
    await this.sql`
      INSERT INTO request_collections (id, workspace_id, spec_id, name, description, requests, created_at, updated_at)
      VALUES (${collection.id}, ${collection.workspaceId}, ${collection.specId}, ${collection.name},
              ${collection.description}, ${this.sql.json(asJson([...collection.requests]))},
              ${collection.createdAt}, ${collection.updatedAt})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description,
        requests = EXCLUDED.requests, spec_id = EXCLUDED.spec_id, updated_at = EXCLUDED.updated_at`;
    return collection;
  }

  async deleteCollection(id: string): Promise<void> {
    await this.init();
    await this.sql`DELETE FROM request_collections WHERE id = ${id}`;
  }

  async listEnvironments(workspaceId: string): Promise<ApiEnvironment[]> {
    await this.init();
    const rows = await this.sql<Row[]>`
      SELECT * FROM api_environments WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
    return rows.map((row) => this.toEnvironment(row));
  }

  async saveEnvironment(environment: ApiEnvironment): Promise<ApiEnvironment> {
    await this.init();
    await this.sql`
      INSERT INTO api_environments (id, workspace_id, name, base_url, variables, created_at)
      VALUES (${environment.id}, ${environment.workspaceId}, ${environment.name}, ${environment.baseUrl},
              ${this.sql.json(asJson([...environment.variables]))}, ${environment.createdAt})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, base_url = EXCLUDED.base_url, variables = EXCLUDED.variables`;
    return environment;
  }

  async deleteEnvironment(id: string): Promise<void> {
    await this.init();
    await this.sql`DELETE FROM api_environments WHERE id = ${id}`;
  }

  // -- telemetry -------------------------------------------------------------
  async recordMetric(sample: MetricSample): Promise<void> {
    await this.init();
    await this.sql`
      INSERT INTO metric_samples (id, spec_id, ts, method, path, status, duration_ms, source)
      VALUES (${sample.id}, ${sample.specId}, ${sample.timestamp}, ${sample.method}, ${sample.path},
              ${sample.status}, ${sample.durationMs}, ${sample.source})`;
  }

  async listMetrics(specId: string | null, sinceIso: string): Promise<MetricSample[]> {
    await this.init();
    const rows = specId
      ? await this.sql<Row[]>`
          SELECT * FROM metric_samples WHERE spec_id = ${specId} AND ts >= ${sinceIso} ORDER BY ts`
      : await this.sql<Row[]>`SELECT * FROM metric_samples WHERE ts >= ${sinceIso} ORDER BY ts`;
    return rows.map((row) => ({
      id: String(row.id),
      specId: String(row.spec_id),
      timestamp: iso(row.ts),
      method: String(row.method),
      path: String(row.path),
      status: Number(row.status),
      durationMs: Number(row.duration_ms),
      source: row.source as MetricSample["source"],
    }));
  }
}
