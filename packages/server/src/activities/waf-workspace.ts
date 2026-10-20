/**
 * The WAF workspace: the checkouts authoring, the sandbox and deploys work in — the framework,
 * the navbar module, the media repository, the activity-data repository, and one repository
 * per product module — laid out as a WAF checkout is, so everything that reads one reads this.
 *
 * Penguin makes and keeps these itself under `<PENGUIN_HOME>/waf`, so nobody has to clone
 * and maintain a WAF checkout by hand. An admin may instead name an existing checkout (or the
 * server may be started with WAF_ROOT_DIR); then Penguin only reads its state and never
 * clones, installs or fetches into it.
 *
 * Product modules may also come from a monorepo's modules folder (the `modulesRoot` setting,
 * or WAF_MODULES_DIR), read beside the checkout's own `modules/`, as Loom reads its two module
 * roots. Those modules share the monorepo's repository, so none of them is cloned here.
 *
 * Media is large and in Git LFS, so its clone is partial and sparse: it starts with no
 * folders and gains a product's folder when that product needs it, fetching only that
 * folder's LFS objects (the approach of the media-workspaces prototype).
 *
 * git authenticates with the host's own SSH keys; Penguin stores no git credential. Every
 * clone and npm call goes through `WafWorkspacePorts`, which a test replaces.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { Config } from "../hmr/capabilities.js";
import type { Settings } from "../mechanisms/settings.js";
import { CloneDiverged, CloneError, gitClones, type Clones } from "./clone.js";
import { sameRemote } from "./deploy-git.js";
import { spawnDeployProcess, type DeployProcess } from "./deploy-process.js";
import { DEPLOY_SETTINGS_KEY, normalizeRemote } from "./deploy-settings.js";
import { findWafRoot, setMonorepoModuleRoots, WAF_REPO_PATHS, WafLayout } from "./waf-layout.js";
import type {
  WafRepoId,
  WafRepoStatus,
  WafWorkspaceSettings,
  WafWorkspaceStatus,
} from "./waf-workspace-types.js";

export type {
  WafRepoId,
  WafRepoSetting,
  WafRepoStatus,
  WafWorkspaceSettings,
  WafWorkspaceStatus,
} from "./waf-workspace-types.js";

/** The `server_settings` key the workspace settings are stored under. */
export const WAF_WORKSPACE_SETTINGS_KEY = "wafWorkspace";

/** The directory under PENGUIN_HOME a managed workspace lives in. */
export const WAF_WORKSPACE_DIR = "waf";

/** How long one clone or install may take: a large history or dependency tree on a slow link. */
export const WAF_LONG_TIMEOUT_MS = 20 * 60 * 1000;

/** How many lines of the latest preparation's log are kept. */
export const WAF_LOG_LINES = 200;

/** The shared repositories every activity needs; product modules are cloned on demand. */
export const WAF_REPO_IDS: readonly WafRepoId[] = ["framework", "navbar", "media", "activityData"];

/** The repositories whose dependencies are installed: the player and navbar build with them. */
const INSTALLED: ReadonlySet<WafRepoId> = new Set(["framework", "navbar"]);

/** The placeholder a module remote template names the module folder with. */
export const MODULE_PLACEHOLDER = "{module}";

/** What git work on a product module's clone queues under (`WafWorkspace.serial`). */
export function moduleRepoKey(moduleFolder: string): string {
  return `module:${moduleFolder}`;
}

export function defaultWafWorkspaceSettings(): WafWorkspaceSettings {
  const github = (name: string) => `git@github.com:waterfordresearchinstitute/${name}.git`;
  return {
    externalRoot: "",
    modulesRoot: "",
    repos: {
      // v2 is the framework line modules build against; the repository's default is not.
      framework: { remote: github("waf-framework"), branch: "v2" },
      navbar: { remote: github("waf-module-navbar"), branch: "main" },
      media: { remote: github("waf-media"), branch: "main" },
      activityData: { remote: github("waf-activity-data"), branch: "main" },
    },
    moduleRemote: github(MODULE_PLACEHOLDER),
  };
}

type Group = Record<string, unknown>;
const asGroup = (value: unknown): Group =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Group) : {};

/** The stored settings, read tolerantly: a missing or mistyped field takes its default. */
export function readWafWorkspaceSettings(raw: string | null): WafWorkspaceSettings {
  const out = defaultWafWorkspaceSettings();
  let stored: Group = {};
  try {
    stored = raw === null ? {} : asGroup(JSON.parse(raw));
  } catch {
    stored = {};
  }
  if (typeof stored.externalRoot === "string") out.externalRoot = stored.externalRoot;
  if (typeof stored.modulesRoot === "string") out.modulesRoot = stored.modulesRoot;
  if (typeof stored.moduleRemote === "string") out.moduleRemote = stored.moduleRemote;
  const repos = asGroup(stored.repos);
  for (const id of WAF_REPO_IDS) {
    const repo = asGroup(repos[id]);
    if (typeof repo.remote === "string") out.repos[id].remote = repo.remote;
    if (typeof repo.branch === "string") out.repos[id].branch = repo.branch;
  }
  return out;
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

function invalid(field: string, message: string): HttpError {
  return new HttpError(400, "waf_workspace_invalid", `${field} ${message}`, undefined, {
    field,
  });
}

/**
 * An update merged over the stored settings; a field left out keeps its value. Rejects the
 * whole update when any field is wrong, so nothing half-applies.
 */
export function normalizeWafWorkspaceSettings(
  current: WafWorkspaceSettings,
  input: unknown,
): WafWorkspaceSettings {
  const body = asGroup(input);
  const out: WafWorkspaceSettings = structuredClone(current);
  if (body.externalRoot !== undefined) {
    if (typeof body.externalRoot !== "string") throw invalid("externalRoot", "must be text.");
    const root = body.externalRoot.trim();
    if (root && !path.isAbsolute(root)) throw invalid("externalRoot", "must be an absolute path.");
    out.externalRoot = root;
  }
  if (body.modulesRoot !== undefined) {
    if (typeof body.modulesRoot !== "string") throw invalid("modulesRoot", "must be text.");
    const root = body.modulesRoot.trim();
    if (root && !path.isAbsolute(root)) throw invalid("modulesRoot", "must be an absolute path.");
    out.modulesRoot = root;
  }
  if (body.moduleRemote !== undefined) {
    if (typeof body.moduleRemote !== "string") throw invalid("moduleRemote", "must be text.");
    const template = body.moduleRemote.trim();
    if (!template.includes(MODULE_PLACEHOLDER))
      throw invalid("moduleRemote", `must name the module folder as ${MODULE_PLACEHOLDER}.`);
    normalizeRemote(template.replaceAll(MODULE_PLACEHOLDER, "waf-module-x"), "moduleRemote");
    out.moduleRemote = template;
  }
  const repos = asGroup(body.repos);
  for (const id of WAF_REPO_IDS) {
    const repo = asGroup(repos[id]);
    if (repo.remote !== undefined) {
      const remote = normalizeRemote(repo.remote, `repos.${id}.remote`);
      if (!remote) throw invalid(`repos.${id}.remote`, "is required.");
      out.repos[id].remote = remote;
    }
    if (repo.branch !== undefined) {
      const branch = typeof repo.branch === "string" ? repo.branch.trim() : "";
      if (!BRANCH.test(branch) || branch.includes(".."))
        throw invalid(`repos.${id}.branch`, "must be a branch name.");
      out.repos[id].branch = branch;
    }
  }
  return out;
}

/** A module folder a repository may be made for: one path segment, as WAF names them. */
export function checkModuleFolder(folder: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(folder) || folder.includes(".."))
    throw new HttpError(400, "module_folder_invalid", "Not a module folder name.");
  return folder;
}

/** A media folder a sparse checkout may add: relative, forward slashes, no traversal. */
export function checkMediaFolder(folder: string): string {
  const parts = folder.split("/");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9 _./()-]{0,299}$/.test(folder) ||
    parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  )
    throw new HttpError(400, "media_folder_invalid", `Not a media folder: ${folder}`);
  return folder;
}

/** The parts of the workspace that touch the outside world; a test replaces them. */
export abstract class WafWorkspacePorts extends Interface<{
  clones?: Clones;
  runProcess?: DeployProcess["run"];
  /**
   * Whether the server prepares a managed workspace that is not ready when it starts; true
   * unless PENGUIN_WAF_AUTO_PREPARE is "0". Tests turn it off, so nothing clones at boot.
   */
  autoPrepare?: boolean;
}>() {}

@Component()
export class DefaultWafWorkspacePorts implements WafWorkspacePorts {}

export abstract class WafWorkspace extends Interface<{
  /** The checkout's root when it can be used, else null. Replaces looking for one on disk. */
  root(): Promise<string | null>;
  /**
   * The checkout's root, or the refusal that says why there is none: 503
   * `waf_workspace_preparing` while it is being prepared, else 409 `waf_workspace_not_ready`
   * (naming why the last preparation failed, when it did).
   */
  requireRoot(): Promise<string>;
  status(): Promise<WafWorkspaceStatus>;
  /**
   * Clones whichever shared repositories are missing and installs their dependencies, in the
   * background; one preparation at a time. A no-op for an existing checkout.
   */
  prepare(): Promise<WafWorkspaceStatus>;
  /**
   * A product module's directory, cloned on first use. A module whose repository does not
   * exist yet starts as an empty repository with origin set, as Loom started one.
   */
  ensureModule(moduleFolder: string): Promise<string>;
  /** Adds media folders to the sparse checkout and fetches their LFS objects. */
  ensureMedia(folders: readonly string[]): Promise<void>;
  /**
   * Runs `work` on the media repository's folder once no git work on it runs (a clone, a branch
   * switch, folders a sparse checkout takes in), and starts none until it ends. Other writes to
   * the folder are not held back: a take written or accepted meanwhile goes ahead. Null, with
   * nothing run, unless the managed workspace is ready: an existing checkout's media is its
   * owner's, and may hold other servers' files.
   */
  withMedia<T>(work: (mediaDir: string) => Promise<T>): Promise<T | null>;
  /** The remote a product's module repository is cloned from and pushed to. */
  moduleRemote(moduleFolder: string): string;
  /**
   * A product module's directory to author in. In the managed workspace it is the module's
   * clone (see ensureModule); in an existing checkout it is made when missing and nothing is
   * cloned, since that checkout's repositories are its owner's.
   */
  authoringModule(moduleFolder: string): Promise<string>;
  /**
   * Runs `work` once the git work queued before it on the same repository has settled, and holds
   * later work off until it does: `key` is a shared repository's id (`media`) or a product
   * module's `moduleRepoKey`. Preparing, cloning a module, adding media folders and a deploy's git
   * work on those clones all queue here. `work` must not queue on the same key again.
   */
  serial<T>(key: string, work: () => Promise<T>): Promise<T>;
  settings(): WafWorkspaceSettings;
  saveSettings(input: unknown): WafWorkspaceSettings;
}>() {}

@Component()
export class WafWorkspaceService implements WafWorkspace {
  @Use() private readonly config!: Config;
  @Use() private readonly serverSettings!: Settings;
  @Use() private readonly ports!: WafWorkspacePorts;

  private preparing: Promise<void> | null = null;
  private lastError: string | null = null;
  private log: string[] = [];
  /** Git calls on one repository run one after another. */
  private queues = new Map<string, Promise<unknown>>();

  settings(): WafWorkspaceSettings {
    const raw = this.serverSettings.get(WAF_WORKSPACE_SETTINGS_KEY);
    const settings = readWafWorkspaceSettings(raw);
    // Until the workspace is saved once, a server that set the two remotes in its deploy
    // settings (where they used to be) keeps them.
    if (raw === null) {
      const deploy = asGroup(safeJson(this.serverSettings.get(DEPLOY_SETTINGS_KEY))).repos;
      const { activityDataRemote, mediaRemote } = asGroup(deploy);
      if (typeof activityDataRemote === "string" && activityDataRemote)
        settings.repos.activityData.remote = activityDataRemote;
      if (typeof mediaRemote === "string" && mediaRemote) settings.repos.media.remote = mediaRemote;
    }
    return settings;
  }

  moduleRemote(moduleFolder: string): string {
    return this.settings().moduleRemote.replaceAll(
      MODULE_PLACEHOLDER,
      checkModuleFolder(moduleFolder),
    );
  }

  saveSettings(input: unknown): WafWorkspaceSettings {
    const next = normalizeWafWorkspaceSettings(this.settings(), input);
    this.serverSettings.set(WAF_WORKSPACE_SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  /** The external checkout when one is named, else null: WAF_ROOT_DIR, then the setting. */
  private external(): string | null {
    return process.env.WAF_ROOT_DIR || this.settings().externalRoot || null;
  }

  /** The monorepo modules folder when one is named, else null: WAF_MODULES_DIR, then the setting. */
  private monorepoModules(): string | null {
    const dir = process.env.WAF_MODULES_DIR || this.settings().modulesRoot;
    return dir ? path.resolve(dir) : null;
  }

  /** Hands out a checkout root, with its monorepo modules folder set for every layout of it. */
  private withModuleRoots(root: string | null): string | null {
    if (root) {
      const modules = this.monorepoModules();
      setMonorepoModuleRoots(root, modules && fs.existsSync(modules) ? [modules] : []);
    }
    return root;
  }

  private managedRoot(): string {
    return path.join(this.config.root, WAF_WORKSPACE_DIR);
  }

  private clones(): Clones {
    return this.ports.clones ?? gitClones();
  }

  private process(): DeployProcess {
    const run = this.ports.runProcess;
    return run ? { run } : spawnDeployProcess;
  }

  private note(line: string) {
    this.log.push(line);
    if (this.log.length > WAF_LOG_LINES) this.log.splice(0, this.log.length - WAF_LOG_LINES);
  }

  serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    this.queues.set(key, next);
    // The caller sees a failure; this bookkeeping must not become an unhandled one.
    const done = () => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    };
    void next.then(done, done);
    return next;
  }

  async root(): Promise<string | null> {
    const external = this.external();
    if (external) return this.withModuleRoots(await findWafRoot(external, external));
    // Called on every request that needs the checkout, so only the disk is looked at; a
    // clone of the wrong remote is caught by status() and prepare(), never made by Penguin.
    const root = this.managedRoot();
    const checkout = new WafLayout(root);
    const has = (id: WafRepoId, entry: string) =>
      fs.existsSync(path.join(checkout.repo(id), entry));
    const ready = WAF_REPO_IDS.every(
      (id) => has(id, ".git") && (!INSTALLED.has(id) || has(id, "node_modules")),
    );
    return this.withModuleRoots(ready ? root : null);
  }

  private async repoStatus(root: string, id: WafRepoId, managed: boolean): Promise<WafRepoStatus> {
    const dir = new WafLayout(root).repo(id);
    const present = fs.existsSync(path.join(dir, ".git"));
    const installed = INSTALLED.has(id) ? fs.existsSync(path.join(dir, "node_modules")) : null;
    if (!present)
      return {
        id,
        path: dir,
        present,
        remote: null,
        remoteMatches: !managed,
        branch: null,
        branchMatches: !managed,
        dirty: null,
        installed,
      };
    const look = await this.clones().open(dir).state();
    const origin = look.origin;
    const current = look.branch;
    return {
      id,
      path: dir,
      present,
      remote: origin,
      remoteMatches:
        !managed || (origin !== null && sameRemote(origin, this.settings().repos[id].remote)),
      branch: current,
      branchMatches: !managed || current === this.settings().repos[id].branch,
      dirty: look.clean === null ? null : !look.clean,
      installed,
    };
  }

  async status(): Promise<WafWorkspaceStatus> {
    const external = this.external();
    const root = external ?? this.managedRoot();
    const repos = await Promise.all(WAF_REPO_IDS.map((id) => this.repoStatus(root, id, !external)));
    const usable = (id: WafRepoId) => {
      const repo = repos.find((entry) => entry.id === id)!;
      return repo.present && repo.remoteMatches && repo.branchMatches && repo.installed !== false;
    };
    // Every repository counts: deploys need the activity data as much as builds need the
    // framework, and a clone on another branch than the one configured builds something else.
    const ready = external
      ? (await findWafRoot(external, external)) !== null
      : WAF_REPO_IDS.every(usable);
    const modulesRoot = this.monorepoModules();
    return {
      managed: !external,
      root,
      modulesRoot,
      modulesRootPresent: modulesRoot === null ? null : fs.existsSync(modulesRoot),
      ready,
      repos,
      preparing: this.preparing !== null,
      lastError: this.lastError,
      log: [...this.log],
    };
  }

  async prepare(): Promise<WafWorkspaceStatus> {
    if (this.external()) return this.status();
    if (!this.preparing) {
      this.lastError = null;
      this.log = [];
      this.preparing = this.prepareAll()
        .catch((error: Error) => {
          this.lastError = error.message;
          this.note(`Failed: ${error.message}`);
        })
        .finally(() => {
          this.preparing = null;
        });
    }
    return this.status();
  }

  private async prepareAll(): Promise<void> {
    const root = this.managedRoot();
    await fsp.mkdir(new WafLayout(root).modulesDir, { recursive: true });
    for (const id of WAF_REPO_IDS) {
      const status = await this.repoStatus(root, id, true);
      if (status.present && !status.remoteMatches)
        throw new Error(
          `${WAF_REPO_PATHS[id]} is a clone of ${status.remote ?? "an unknown remote"}, not ${this.settings().repos[id].remote}. Move it aside to let Penguin clone it again.`,
        );
      if (!status.present) await this.serial(id, () => this.cloneShared(root, id));
      const switched =
        status.present && !status.branchMatches
          ? await this.serial(id, () => this.switchBranch(status))
          : false;
      if (INSTALLED.has(id) && (switched || !fs.existsSync(path.join(status.path, "node_modules"))))
        await this.install(status.path);
    }
    this.note("The workspace is ready.");
  }

  /**
   * Puts an existing clone on the branch the settings name, as origin has it: a changed
   * branch in Settings takes effect on the next Prepare. A clone with changes of its own is
   * left alone, and the preparation fails naming it, so nothing is lost.
   */
  private async switchBranch(status: WafRepoStatus): Promise<boolean> {
    const { branch } = this.settings().repos[status.id];
    const where = WAF_REPO_PATHS[status.id];
    if (status.dirty !== false)
      throw new Error(
        `${where} is on ${status.branch ?? "no branch"}, not ${branch}, and has changes of its own. Commit or move them aside, then prepare again.`,
      );
    this.note(`Switching ${where} from ${status.branch ?? "no branch"} to ${branch}…`);
    // A branch that has diverged from origin's is left, the clone back on the branch it was
    // on, so it reads as on another branch rather than as ready.
    const clone = this.clones().open(status.path, { timeoutMs: WAF_LONG_TIMEOUT_MS });
    try {
      await clone.onBranchFromOrigin(branch, { work: "clean" });
    } catch (error) {
      if (!(error instanceof CloneDiverged)) throw error;
      throw new Error(
        `${where}'s ${branch} has commits origin's does not, and origin's has commits it does not. Reconcile them, then prepare again. (${error.message})`,
      );
    }
    return true;
  }

  private async cloneShared(root: string, id: WafRepoId): Promise<void> {
    const { remote, branch } = this.settings().repos[id];
    const dir = new WafLayout(root).repo(id);
    if (fs.existsSync(dir) && (await fsp.readdir(dir)).length > 0)
      throw new Error(`${WAF_REPO_PATHS[id]} exists but is not a clone. Move it aside first.`);
    await fsp.mkdir(path.dirname(dir), { recursive: true });
    this.note(`Cloning ${remote} (${branch}) into ${WAF_REPO_PATHS[id]}…`);
    // Media is partial and sparse, with LFS objects left for ensureMedia to fetch per folder.
    try {
      await this.clones().cloneFrom(remote, dir, {
        branch,
        partial: id === "media",
        timeoutMs: WAF_LONG_TIMEOUT_MS,
      });
    } catch (error) {
      // The clone itself failing names the remote; a failure after it names git's command.
      if (error instanceof CloneError && error.args[0] === "clone")
        throw new Error(`Cloning ${remote} failed: ${error.reason}`);
      throw error;
    }
  }

  private async install(dir: string): Promise<void> {
    this.note(`Installing dependencies in ${path.relative(this.managedRoot(), dir)}…`);
    const result = await this.process().run("npm", ["install", "--ignore-scripts"], {
      cwd: dir,
      timeoutMs: WAF_LONG_TIMEOUT_MS,
    });
    if (result.code !== 0)
      throw new Error(
        `npm install failed in ${path.basename(dir)}: ${result.error ?? result.tail.slice(-2000)}`,
      );
  }

  async requireRoot(): Promise<string> {
    const root = await this.root();
    if (root) return root;
    if (this.preparing)
      throw new HttpError(
        503,
        "waf_workspace_preparing",
        "The WAF workspace is being prepared. Cloning and installing can take several minutes.",
      );
    throw new HttpError(
      409,
      "waf_workspace_not_ready",
      this.lastError
        ? `The WAF workspace is not prepared: ${this.lastError} An admin can try again in Settings.`
        : "The WAF workspace is not prepared. An admin can prepare it in Settings.",
    );
  }

  /** A managed workspace that is not ready is prepared in the background as the server starts. */
  setup() {
    const enabled = this.ports.autoPrepare ?? process.env.PENGUIN_WAF_AUTO_PREPARE !== "0";
    if (!enabled || this.external()) return;
    void this.root()
      .then((root) => (root ? undefined : this.prepare()))
      .catch(() => {
        /* status() reports what went wrong; startup goes on regardless. */
      });
  }

  async ensureModule(moduleFolder: string): Promise<string> {
    const folder = checkModuleFolder(moduleFolder);
    const root = await this.requireRoot();
    const dir = new WafLayout(root).module(folder).root;
    return this.serial(moduleRepoKey(folder), async () => {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
      if (fs.existsSync(dir) && (await fsp.readdir(dir)).length > 0)
        throw new HttpError(
          409,
          "module_not_a_clone",
          `modules/${folder} exists but is not a git repository.`,
        );
      const remote = this.moduleRemote(folder);
      const clones = this.clones();
      let exists: boolean;
      try {
        exists = await clones.remoteExists(remote, root);
      } catch (error) {
        if (!(error instanceof CloneError)) throw error;
        throw new HttpError(
          502,
          "module_remote_unreachable",
          `Could not reach ${remote}: ${error.reason}`,
        );
      }
      if (exists) {
        try {
          await clones.cloneFrom(remote, dir, { timeoutMs: WAF_LONG_TIMEOUT_MS });
        } catch (error) {
          if (!(error instanceof CloneError)) throw error;
          throw new HttpError(
            502,
            "module_clone_failed",
            `Cloning ${remote} failed: ${error.reason}`,
          );
        }
        return dir;
      }
      // A new module: its repository is made by whoever owns the organisation; the first
      // deploy pushes main to it.
      await fsp.mkdir(dir, { recursive: true });
      await clones.create(dir, remote, { timeoutMs: WAF_LONG_TIMEOUT_MS });
      return dir;
    });
  }

  async authoringModule(moduleFolder: string): Promise<string> {
    const folder = checkModuleFolder(moduleFolder);
    // A monorepo's module is authored where it is: it has no repository of its own to clone.
    const root = await this.root();
    const checkout = root ? new WafLayout(root) : null;
    if (checkout?.inMonorepo(folder)) return checkout.module(folder).root;
    if (!this.external()) return this.ensureModule(folder);
    const dir = new WafLayout(await this.requireRoot()).module(folder).root;
    return this.serial(moduleRepoKey(folder), async () => {
      // A module the checkout already has is its owner's, repository and all.
      if (fs.existsSync(dir)) return dir;
      // A new one starts as Loom started one: an empty repository on main with origin set,
      // so a deploy can later push it. Nothing is fetched from the remote.
      await fsp.mkdir(dir, { recursive: true });
      await this.clones().create(dir, this.moduleRemote(folder), {
        timeoutMs: WAF_LONG_TIMEOUT_MS,
      });
      return dir;
    });
  }

  async withMedia<T>(work: (mediaDir: string) => Promise<T>): Promise<T | null> {
    if (this.external()) return null;
    const root = await this.root();
    if (!root) return null;
    const dir = new WafLayout(root).repo("media");
    return this.serial("media", () => work(dir));
  }

  async ensureMedia(folders: readonly string[]): Promise<void> {
    const wanted = [...new Set(folders.map(checkMediaFolder))];
    if (!wanted.length) return;
    const root = await this.requireRoot();
    // An existing checkout belongs to whoever made it; its media is theirs to fetch.
    if (this.external()) return;
    const dir = new WafLayout(root).repo("media");
    await this.serial("media", () =>
      this.clones().open(dir, { timeoutMs: WAF_LONG_TIMEOUT_MS }).include(wanted),
    );
  }
}

function safeJson(raw: string | null): unknown {
  try {
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}
