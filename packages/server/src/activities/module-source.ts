/**
 * Which module a ref's preview or deploy uses, and the module documents in effect for it.
 *
 *   preview   the build the author pinned while it is still a succeeded build, else the
 *             newest; with none, the product's folder in the WAF checkout when it holds a
 *             module. A play link that names a module run plays that run, running or
 *             succeeded, and nothing else.
 *   deploy    the newest succeeded build, whatever the preview plays, when it holds a
 *             package.json; its documents fall back on the checkout's module folder.
 *
 * A module document (configuration, assessment, definition) is the author's edit, else the
 * first of the module's own files found in the module's roots, in order. A ref's assessment
 * falls back on the canonical ref's, which every ref shares, as the player's does.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@waterford/waf-harness-core/kernel";
import type { Config } from "../hmr/capabilities.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRecord,
  ActivityRunSummary,
  ModuleDocumentKind,
} from "./domain.js";
import { playingBuild } from "./module-builds.js";
import type { ActivityRuns } from "./run-store.js";
import { sandboxModuleRoot } from "./sandbox-paths.js";
import { checkoutOutputRoot, type ModuleSource } from "./sandbox-source.js";
import { moduleDocumentPath, WafLayout } from "./waf-layout.js";
import type { WafWorkspace } from "./waf-workspace.js";

/** What a module is wanted for: playing it here, or releasing it. */
export type ModulePurpose = "preview" | "deploy";

/** A ref as the module source reads it: its record, and the pin when the caller has the draft. */
export type ModuleRef = ActivityRecord & { draft?: Pick<ActivityDraft, "pinnedModuleRunId"> };

/** The module a purpose uses for a ref. */
export interface ResolvedModule {
  /** Where it is built and served from; null when there is nothing to use. */
  source: ModuleSource | null;
  /** Where its documents are read from, first match winning. */
  documentRoots: string[];
  /** The module build a deploy's source is. */
  runId?: string;
}

/** A module document in effect, and where it came from. */
export interface EffectiveDocument {
  /** Its path inside the module, e.g. `configurations/<code>-<ref>.json`. */
  file: string;
  value: unknown;
  /** An author's edit, used in place of the module's own document. */
  edited: boolean;
  /** The edit predates what it was made against (see module-overrides.ts). */
  stale: boolean;
}

export abstract class ActivityModuleSource extends Interface<{
  /**
   * The module build a purpose uses: for a preview the pinned one while it is still a
   * succeeded build, else the newest; for a deploy always the newest. Null with none.
   */
  build(
    projectId: string,
    activity: ModuleRef,
    purpose: ModulePurpose,
  ): Promise<ActivityRunSummary | null>;
  /** The module a purpose uses for a ref; `runId` is a play link's module run (preview only). */
  resolve(
    projectId: string,
    activity: ModuleRef,
    purpose: ModulePurpose,
    runId?: string | null,
  ): Promise<ResolvedModule>;
  /**
   * The document of `kind` in effect for a ref: the author's edit (unless `edits` is false),
   * else the module's own file in the first of `roots` that has it. Null with neither.
   */
  document(
    projectId: string,
    activity: ActivityDetail,
    kind: ModuleDocumentKind,
    roots: readonly string[],
    edits?: boolean,
  ): Promise<EffectiveDocument | null>;
}>() {}

/** Reads a JSON object, or null when the file is absent, unreadable or not an object. */
async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function isFile(file: string): Promise<boolean> {
  return (await fs.stat(file).catch(() => null))?.isFile() ?? false;
}

@Component()
export class ActivityModuleSourceService implements ActivityModuleSource {
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly runs!: ActivityRuns;
  @Use() private readonly config!: Config;
  @Use() private readonly wafWorkspace!: WafWorkspace;

  private runRoot(runId: string): string {
    return sandboxModuleRoot(this.runs.workspace(runId));
  }

  async build(
    projectId: string,
    activity: ModuleRef,
    purpose: ModulePurpose,
  ): Promise<ActivityRunSummary | null> {
    const builds = await this.generation.moduleBuilds(projectId, activity.id);
    // A release ships the newest build, whatever the preview plays.
    return playingBuild(builds, purpose === "deploy" ? null : activity.draft?.pinnedModuleRunId);
  }

  async resolve(
    projectId: string,
    activity: ModuleRef,
    purpose: ModulePurpose,
    runId?: string | null,
  ): Promise<ResolvedModule> {
    if (purpose === "preview") {
      const source = await this.previewSource(projectId, activity, runId ?? null);
      return { source, documentRoots: source ? [source.root] : [] };
    }
    // A deploy's documents fall back on the checkout's module folder, built or not.
    const built = await this.deploySource(projectId, activity);
    const source = built?.source ?? null;
    const documentRoots = source ? [source.root] : [];
    const product = this.activities.productOf(activity);
    const wafRoot = product ? await this.wafWorkspace.root() : null;
    const checkout =
      product && wafRoot ? new WafLayout(wafRoot).moduleDir(product.moduleFolder) : null;
    if (checkout) documentRoots.push(checkout);
    return { source, documentRoots, ...(built ? { runId: built.runId } : {}) };
  }

  /** The newest build, when it holds a module to release. */
  private async deploySource(
    projectId: string,
    activity: ModuleRef,
  ): Promise<{ source: ModuleSource; runId: string } | null> {
    const build = await this.build(projectId, activity, "deploy").catch(() => null);
    if (!build) return null;
    const root = this.runRoot(build.runId);
    return (await isFile(path.join(root, "package.json")))
      ? { source: { kind: "run", root }, runId: build.runId }
      : null;
  }

  private async previewSource(
    projectId: string,
    activity: ModuleRef,
    runId: string | null,
  ): Promise<ModuleSource | null> {
    if (runId) return this.namedRun(projectId, activity.id, runId);
    const build = await this.build(projectId, activity, "preview");
    if (build) return { kind: "run", root: this.runRoot(build.runId) };
    const product = this.activities.productOf(activity);
    if (!product) return null;
    const wafRoot = await this.wafWorkspace.root();
    if (!wafRoot) return null;
    // The folder was validated when the product was made; containment is checked anyway,
    // because this is a path chosen by stored data and read by a URL.
    const root = new WafLayout(wafRoot).moduleDir(product.moduleFolder);
    if (!root || !(await isFile(path.join(root, "definition.json")))) return null;
    return {
      kind: "checkout",
      root,
      output: checkoutOutputRoot(this.config.root, product.moduleFolder),
      moduleFolder: product.moduleFolder,
    };
  }

  /**
   * One module run of this activity, while it runs or once it succeeded; null for any other
   * run. A running assembly is played so its agent can check the module in the real player
   * before it finishes; a failed one never is: it leaves a half-written workspace behind.
   */
  private async namedRun(
    projectId: string,
    activityId: string,
    runId: string,
  ): Promise<ModuleSource | null> {
    const run = await this.generation.run(projectId, activityId, runId).catch(() => null);
    if (!run || run.kind !== "module") return null;
    if (run.status !== "running" && run.status !== "succeeded") return null;
    return { kind: "run", root: this.runRoot(run.runId) };
  }

  async document(
    projectId: string,
    activity: ActivityDetail,
    kind: ModuleDocumentKind,
    roots: readonly string[],
    edits = true,
  ): Promise<EffectiveDocument | null> {
    const refNums = [activity.refNum];
    const canonicalRefNum = this.activities.productOf(activity)?.canonicalRefNum ?? null;
    if (kind === "assessment" && canonicalRefNum != null && canonicalRefNum !== activity.refNum)
      refNums.push(canonicalRefNum);
    const files = refNums.map((refNum) => moduleDocumentPath(kind, activity.productCode, refNum));
    const edit = edits
      ? await this.activities.effectiveModuleDocument(projectId, activity, kind)
      : null;
    // An edit names the file an assembly writes it to: this ref's configuration, or the
    // canonical ref's assessment, which every ref shares.
    if (edit) return { file: files.at(-1)!, value: edit.value, edited: true, stale: edit.stale };
    for (const root of roots)
      for (const file of files) {
        const value = await readJsonObject(path.join(root, file));
        if (value) return { file, value, edited: false, stale: false };
      }
    return null;
  }
}
