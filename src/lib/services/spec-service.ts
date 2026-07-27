import "server-only";
import { analyzeSource, type AnalyzedSource } from "@/lib/core/analysis";
import { diffDocuments, nextVersionLabel, type DiffResult } from "@/lib/core/openapi/diff";
import { parseSpec } from "@/lib/core/openapi/document";
import type {
  ApiKind,
  ApiProject,
  LifecycleStatus,
  SpecFormat,
  SpecVersion,
} from "@/lib/domain/types";
import { getRepository } from "@/lib/repository";
import { NotFoundError } from "@/lib/repository/types";
import { assertOwner, type Identity } from "@/lib/server/auth";
import { contentHash } from "@/lib/server/crypto";
import { ApiError } from "@/lib/server/http";
import { newId, slugify } from "@/lib/utils/id";

export interface CreateSpecInput {
  readonly name: string;
  readonly description?: string;
  readonly kind?: ApiKind;
  readonly source: string;
  readonly tags?: readonly string[];
}

export interface SpecWithVersion {
  readonly project: ApiProject;
  readonly version: SpecVersion | null;
}

/**
 * Application service for API projects and their versions.
 *
 * Routes stay thin: they parse input and render output, while ownership checks,
 * version bookkeeping and validation gates live here so every entry point
 * (HTTP, server actions, future CLI) behaves identically.
 */
export class SpecService {
  static async list(identity: Identity): Promise<SpecWithVersion[]> {
    const repository = await getRepository();
    const projects = await repository.listProjects(identity.userId);
    return Promise.all(
      projects.map(async (project) => ({
        project,
        version: project.currentVersionId
          ? await repository.getVersion(project.currentVersionId)
          : null,
      })),
    );
  }

  static async get(identity: Identity, specId: string): Promise<SpecWithVersion> {
    const repository = await getRepository();
    const project = await repository.getProject(specId);
    if (!project) throw new NotFoundError("API project", specId);
    assertOwner(project.ownerId, identity);
    const version = project.currentVersionId
      ? await repository.getVersion(project.currentVersionId)
      : null;
    return { project, version };
  }

  static async create(identity: Identity, input: CreateSpecInput): Promise<SpecWithVersion> {
    const parsed = parseSpec(input.source);
    if (!parsed.ok) {
      throw ApiError.badRequest(`The specification could not be parsed: ${parsed.error.message}`, {
        line: parsed.error.line,
        column: parsed.error.column,
      });
    }

    const repository = await getRepository();
    const workspace = await repository.ensureWorkspace(identity.userId);
    const now = new Date().toISOString();
    const specId = newId("spec");
    const versionLabel = parsed.value.document.info?.version ?? "1.0.0";

    const version: SpecVersion = {
      id: newId("ver"),
      specId,
      label: versionLabel,
      document: input.source,
      format: parsed.value.format,
      hash: contentHash(input.source),
      message: "Initial version",
      status: "draft",
      createdBy: identity.userId,
      createdAt: now,
    };

    const project: ApiProject = {
      id: specId,
      workspaceId: workspace.id,
      ownerId: identity.userId,
      name: input.name || parsed.value.document.info?.title || "Untitled API",
      slug:
        slugify(input.name || parsed.value.document.info?.title || "untitled-api") ||
        "untitled-api",
      description:
        input.description ?? parsed.value.document.info?.description?.split("\n")[0] ?? "",
      kind: input.kind ?? "rest",
      status: "draft",
      tags: input.tags ?? [],
      currentVersionId: version.id,
      createdAt: now,
      updatedAt: now,
    };

    await repository.createProject(project);
    await repository.createVersion(version);
    return { project, version };
  }

  static async updateMetadata(
    identity: Identity,
    specId: string,
    patch: Partial<Pick<ApiProject, "name" | "description" | "tags" | "status" | "kind">>,
  ): Promise<ApiProject> {
    const { project } = await SpecService.get(identity, specId);
    const repository = await getRepository();
    return repository.updateProject(project.id, {
      ...patch,
      ...(patch.name ? { slug: slugify(patch.name) || project.slug } : {}),
    });
  }

  static async remove(identity: Identity, specId: string): Promise<void> {
    const { project } = await SpecService.get(identity, specId);
    const repository = await getRepository();
    await repository.deleteProject(project.id);
  }

  static async listVersions(identity: Identity, specId: string): Promise<SpecVersion[]> {
    await SpecService.get(identity, specId);
    const repository = await getRepository();
    return repository.listVersions(specId);
  }

  /**
   * Save a new version.
   *
   * The version label is derived from the semantic diff against the current
   * version unless the caller supplies one, so the recorded history reflects
   * actual API impact instead of an arbitrary counter.
   */
  static async saveVersion(
    identity: Identity,
    specId: string,
    input: { source: string; message?: string; label?: string; publish?: boolean },
  ): Promise<{ version: SpecVersion; diff: DiffResult | null }> {
    const { project, version: current } = await SpecService.get(identity, specId);

    const parsed = parseSpec(input.source);
    if (!parsed.ok) {
      throw ApiError.badRequest(`The specification could not be parsed: ${parsed.error.message}`, {
        line: parsed.error.line,
        column: parsed.error.column,
      });
    }

    const hash = contentHash(input.source);
    if (current && current.hash === hash) {
      throw ApiError.conflict("This version is identical to the current one.");
    }

    let diff: DiffResult | null = null;
    let label = input.label;
    if (current) {
      const previous = parseSpec(current.document);
      if (previous.ok) {
        diff = diffDocuments(previous.value.document, parsed.value.document);
        label ??= nextVersionLabel(current.label, diff.impact);
      }
    }
    label ??= parsed.value.document.info?.version ?? "1.0.0";

    const repository = await getRepository();
    const version: SpecVersion = {
      id: newId("ver"),
      specId,
      label,
      document: input.source,
      format: parsed.value.format,
      hash,
      message: input.message ?? (diff ? diff.summary : "Updated specification"),
      status: input.publish ? "published" : "draft",
      createdBy: identity.userId,
      createdAt: new Date().toISOString(),
    };

    await repository.createVersion(version);
    await repository.updateProject(project.id, {
      currentVersionId: version.id,
      ...(input.publish ? { status: "published" as LifecycleStatus } : {}),
    });

    return { version, diff };
  }

  /** Restore an earlier version by appending it as the newest version. */
  static async rollback(
    identity: Identity,
    specId: string,
    versionId: string,
  ): Promise<SpecVersion> {
    await SpecService.get(identity, specId);
    const repository = await getRepository();
    const target = await repository.getVersion(versionId);
    if (!target || target.specId !== specId)
      throw new NotFoundError("Specification version", versionId);

    const { version } = await SpecService.saveVersion(identity, specId, {
      source: target.document,
      message: `Rolled back to ${target.label} (${target.id})`,
      label: target.label,
    });
    return version;
  }

  static async analyze(source: string): Promise<AnalyzedSource> {
    const result = analyzeSource(source);
    if (!result.ok) {
      throw ApiError.badRequest(`The specification could not be parsed: ${result.error.message}`, {
        line: result.error.line,
        column: result.error.column,
      });
    }
    return result.value;
  }

  /** Load the document source for a spec, preferring an explicit version. */
  static async sourceFor(
    identity: Identity,
    specId: string,
    versionId?: string,
  ): Promise<{ source: string; format: SpecFormat; version: SpecVersion }> {
    const repository = await getRepository();
    const { project } = await SpecService.get(identity, specId);
    const version = versionId
      ? await repository.getVersion(versionId)
      : project.currentVersionId
        ? await repository.getVersion(project.currentVersionId)
        : null;
    if (!version || version.specId !== specId) {
      throw new NotFoundError(
        "Specification version",
        versionId ?? project.currentVersionId ?? "current",
      );
    }
    return { source: version.document, format: version.format, version };
  }
}
