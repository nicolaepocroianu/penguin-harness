/**
 * The dev sandbox, assembled.
 *
 * Reports what state a preview is in, builds the module on demand, and serves the draft's
 * media. Everything it decides lives in `sandbox-model`, `sandbox-paths`, `media-origin`
 * and `sandbox-builder`; this is the part that touches the filesystem and the activity
 * record, kept thin on purpose.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type Opaque } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { Config } from "../hmr/capabilities.js";
import {
  activityPayload,
  scopeConfigurationToLanguage,
  unwrapModuleConfiguration,
  withPreviewStartScene,
  type ActivityPayload,
} from "./sandbox-configuration.js";
import { moduleDeclaration, ModuleDeclarationError } from "./sandbox-declaration.js";
import { moduleFileHeaders, moduleFilePath } from "./sandbox-module-files.js";
import { describeBuild, SandboxBuilder, type BuildResult } from "./sandbox-builder.js";
import { spawnModuleBuild } from "./sandbox-build-runner.js";
import {
  aliasesByRefKey,
  applyAliasesToLanguageGroups,
  mediaUrlVersions,
  overlayRefAssets,
  versionMediaUrls,
  type ManifestAsset,
} from "./sandbox-ref-assets.js";
import { planMediaResponse } from "./media-origin.js";
import { previewMediaPath, previewState } from "./sandbox-model.js";
import {
  sandboxMediaRoot,
  sandboxModuleRoot,
  sandboxStatus,
  withinRoot,
  type SandboxBuildReport,
  type SandboxStatus,
} from "./sandbox-paths.js";

/** A build result as a caller sees it, with the sentence already written. */
function report(result: BuildResult): SandboxBuildReport {
  return {
    ok: result.ok,
    joined: result.joined,
    skipped: result.skipped,
    message: describeBuild(result),
    log: result.log,
  };
}

/** Reads a JSON file, or null when it is absent or unreadable. Never throws. */
async function readJsonFile(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every asset in a plan's manifest, whatever language group it sits in. */
function manifestAssets(manifest: unknown): ManifestAsset[] {
  const assets = (manifest as { assets?: unknown } | null | undefined)?.assets;
  if (Array.isArray(assets)) return assets as ManifestAsset[];
  if (!assets || typeof assets !== "object") return [];
  return Object.entries(assets as Record<string, unknown>).flatMap(([languageCode, group]) =>
    Array.isArray(group)
      ? (group as ManifestAsset[]).map((asset) => ({ languageCode, ...asset }))
      : [],
  );
}

/** Files whose modification times decide whether a built module is current. */
const SOURCE_DIRS = ["module/src", "module/res", "module/generated"];

export interface SandboxMediaResponse {
  status: number;
  headers: Record<string, string>;
  /** Absent for 304 and 416, which carry no body. */
  body?: Opaque<"Uint8Array", Uint8Array>;
}

export type { SandboxBuildReport };

export interface PayloadOptions {
  languageCode?: string | null;
  startSceneId?: string | null;
}

/** The sandbox as its callers see it. */
export abstract class ActivitySandbox extends Interface<{
  status(projectId: string, activityId: string): Promise<SandboxStatus>;
  payload(projectId: string, activityId: string, options: PayloadOptions): Promise<ActivityPayload>;
  moduleFile(projectId: string, activityId: string, rawPath: string): Promise<SandboxMediaResponse>;
  build(projectId: string, activityId: string, force?: boolean): Promise<SandboxBuildReport>;
  media(
    projectId: string,
    activityId: string,
    rawPath: string,
    request: { range?: string | null; ifRange?: string | null; ifNoneMatch?: string | null },
  ): Promise<SandboxMediaResponse>;
}>() {}

@Component({})
export class ActivitySandboxService implements ActivitySandbox {
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly config!: Config;

  /**
   * One build per workspace, shared by everyone waiting on it.
   *
   * Held on the service rather than created per request: coalescing four concurrent
   * requests into one build is the whole point, and a builder made per request coalesces
   * nothing.
   */
  private readonly builder = new SandboxBuilder({
    build: (workspace) => spawnModuleBuild(workspace),
    sources: (workspace) => this.sourceMtimes(path.dirname(workspace)),
    now: () => Date.now(),
  });

  /**
   * The workspace of the most recent module build, or null when nothing has been built.
   *
   * Only a succeeded run counts. A failed build leaves a half-written workspace behind, and
   * serving from it would give an author a preview of code that did not compile.
   */
  private async builtModule(projectId: string, activityId: string): Promise<string | null> {
    const runs = await this.generation.list(projectId, activityId);
    const built = runs
      .filter((run) => run.kind === "module" && run.status === "succeeded")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return built
      ? sandboxModuleRoot(path.join(this.config.root, "activity-runs", built.runId))
      : null;
  }

  /** What the client is told about a preview. Never claims more than it can show. */
  async status(projectId: string, activityId: string): Promise<SandboxStatus> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const canonical = this.activities.isCanonicalRef(activity);
    const workspace = await this.builtModule(projectId, activity.id);
    const definition = workspace
      ? await fs.stat(path.join(workspace, "definition.json")).catch(() => null)
      : null;
    const state = previewState({
      hasSpec: activity.draft.status === "valid" && activity.draft.spec !== null,
      hasModule: Boolean(definition?.isFile()),
      canonicalRef: canonical,
      builtAtMs: definition?.mtimeMs ?? null,
      sourceMtimesMs: workspace ? await this.sourceMtimes(path.dirname(workspace)) : [],
    });
    // The last build's output, so a failed build is visible rather than showing as a
    // preview that simply never appears.
    return sandboxStatus(state, workspace ? this.builder.lastLog(workspace) : null);
  }

  /**
   * The payload the learner runtime fetches for this preview.
   *
   * Reads the built module's declaration and configuration, overlays this ref's media onto
   * them, scopes the configuration to the requested language and points the preview at a
   * scene. Every decision lives in `sandbox-declaration`, `sandbox-ref-assets` and
   * `sandbox-configuration`; this reads the files and puts them together.
   */
  async payload(
    projectId: string,
    activityId: string,
    options: PayloadOptions,
  ): Promise<ActivityPayload> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const spec = activity.draft.spec;
    if (!spec)
      throw new HttpError(409, "preview_not_ready", "Save a specification before previewing.");
    const workspace = await this.builtModule(projectId, activity.id);
    if (!workspace)
      throw new HttpError(409, "preview_not_built", "No module has been built for this activity.");

    const runtime = (spec.runtime ?? {}) as Record<string, unknown>;
    const definition = await readJsonFile(path.join(workspace, "definition.json"));
    if (!definition)
      throw new HttpError(409, "preview_not_built", "The built module has no definition.");
    const packageJson = await readJsonFile(path.join(workspace, "package.json"));

    let declaration;
    try {
      declaration = moduleDeclaration({
        definition,
        packageVersion: packageJson?.version,
        theme: String(runtime.theme ?? ""),
        routePrefix: `/api/projects/${projectId}/activities/${activity.id}/sandbox/module/`,
      });
    } catch (error) {
      if (error instanceof ModuleDeclarationError)
        throw new HttpError(409, "preview_not_built", error.message);
      throw error;
    }

    // The ref's own media, or the shared module's if this ref has planned none yet.
    const assets = manifestAssets(activity.draft.mediaPlan?.manifest);
    const aliases = aliasesByRefKey(assets);
    // The draft revision is the version token: it changes exactly when the media plan does,
    // which is the only time a cached URL would be wrong.
    const versionToken = activity.draft.contentRevision.slice(0, 16);
    const overlaid = overlayRefAssets(
      declaration as unknown as Record<string, unknown>,
      assets,
      aliases,
      versionToken,
    );

    const configurationFile = path.join(
      workspace,
      "configurations",
      `${activity.productCode}-${activity.refNum}.json`,
    );
    const raw = (await readJsonFile(configurationFile)) ?? {};
    let configuration = unwrapModuleConfiguration(raw, declaration.id);
    configuration = applyAliasesToLanguageGroups(configuration, assets, aliases);
    configuration = versionMediaUrls(
      configuration,
      mediaUrlVersions(assets, versionToken),
    ) as Record<string, unknown>;
    configuration = scopeConfigurationToLanguage(configuration, options.languageCode);
    configuration = withPreviewStartScene(configuration, options.startSceneId);

    return activityPayload({
      moduleId: declaration.id,
      title: String(spec.title ?? activity.title),
      layout: String(runtime.layout ?? "mainOnly"),
      resolution: String(runtime.resolution ?? "640x480"),
      declaration: overlaid as unknown as { id: string },
      // The navbar compartment every layout carries. The preview has no navbar module to
      // build, so it is declared empty rather than omitted: the runtime expects the
      // compartment to exist, and an absent one is a different failure from an empty one.
      navBarDeclaration: { id: "navBar" },
      navBarConfiguration: {},
      configuration,
      hasAssessment: runtime.usesAssessment === true,
    });
  }

  /**
   * Build this activity's module if it needs it, and say what happened.
   *
   * `force` rebuilds regardless — what a Play button does, because an author pressing it
   * after a build they believe failed is asking for a build, not a freshness opinion.
   */
  async build(projectId: string, activityId: string, force = false): Promise<SandboxBuildReport> {
    const activity = await this.activities.getActivity(projectId, activityId);
    // Only the canonical ref owns the module code, and a build writes into it. A
    // non-canonical ref asking to build would rewrite a module someone else owns.
    if (!this.activities.isCanonicalRef(activity)) {
      const product = this.activities.productOf(activity);
      throw new HttpError(
        409,
        "ref_not_canonical",
        `This activity shares its module with ref ${product?.canonicalRefNum}, which owns the module code. Build it from that ref.`,
      );
    }
    const workspace = await this.builtModule(projectId, activity.id);
    if (!workspace)
      throw new HttpError(409, "preview_not_built", "No module has been built for this activity.");
    return report(await this.builder.ensure(workspace, force));
  }

  /**
   * One file from the built module, which is what the payload's URLs point at.
   *
   * Read whole rather than ranged: these are the module's code, styles and layout, fetched
   * once at load. The media route handles the large files that need ranges.
   */
  async moduleFile(
    projectId: string,
    activityId: string,
    rawPath: string,
  ): Promise<SandboxMediaResponse> {
    const relative = moduleFilePath(rawPath);
    if (!relative)
      throw new HttpError(
        400,
        "module_path_invalid",
        "That is not a module file this preview serves.",
      );
    const activity = await this.activities.getActivity(projectId, activityId);
    const workspace = await this.builtModule(projectId, activity.id);
    if (!workspace)
      throw new HttpError(409, "preview_not_built", "No module has been built for this activity.");
    const file = withinRoot(workspace, relative);
    if (!file)
      throw new HttpError(
        400,
        "module_path_invalid",
        "That is not a module file this preview serves.",
      );

    const bytes = await fs.readFile(file).catch(() => null);
    if (!bytes) throw new HttpError(404, "module_file_not_found", `No file at ${relative}.`);
    return {
      status: 200,
      headers: { ...moduleFileHeaders(relative), "content-length": String(bytes.byteLength) },
      body: new Uint8Array(bytes),
    };
  }

  /**
   * One media file from the draft, with range handling.
   *
   * The path is checked twice — by shape, then by where it lands — and the file is read
   * only after both pass.
   */
  async media(
    projectId: string,
    activityId: string,
    rawPath: string,
    request: { range?: string | null; ifRange?: string | null; ifNoneMatch?: string | null },
  ): Promise<SandboxMediaResponse> {
    const relative = previewMediaPath(rawPath);
    if (!relative) throw new HttpError(400, "media_path_invalid", "That is not a media path.");
    const activity = await this.activities.getActivity(projectId, activityId);
    const root = sandboxMediaRoot({
      draftWorkspace: this.activities.draftWorkspace(
        projectId,
        activity.collectionId,
        activity.id,
        activity.draft.draftId,
      ),
    });
    const file = withinRoot(root, relative);
    if (!file) throw new HttpError(400, "media_path_invalid", "That is not a media path.");

    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile())
      throw new HttpError(404, "media_not_found", `No media file at ${relative}.`);

    const plan = planMediaResponse(relative, { size: stat.size, mtimeMs: stat.mtimeMs }, request);
    if (plan.status === 304 || plan.status === 416)
      return { status: plan.status, headers: plan.headers };

    const handle = await fs.open(file, "r");
    try {
      const length = plan.range ? plan.range.length : stat.size;
      const buffer = new Uint8Array(length);
      // Read exactly the planned window. Reading the whole file and slicing would put a
      // multi-megabyte video in memory to answer a request for ten kilobytes of it.
      const { bytesRead } = await handle.read(buffer, 0, length, plan.range ? plan.range.start : 0);
      return {
        status: plan.status,
        headers: plan.headers,
        body: bytesRead === length ? buffer : buffer.subarray(0, bytesRead),
      };
    } finally {
      await handle.close();
    }
  }

  /** Modification times of everything a module build reads, for the freshness check. */
  async sourceMtimes(workspace: string): Promise<number[]> {
    const found: number[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          const stat = await fs.stat(full).catch(() => null);
          if (stat) found.push(stat.mtimeMs);
        }
      }
    };
    for (const relative of SOURCE_DIRS) await walk(path.join(workspace, relative));
    return found;
  }
}
