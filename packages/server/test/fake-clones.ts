/**
 * Clones that answer from memory, for tests of what a deploy or the WAF workspace does with
 * them; `activity-clone.test.ts` proves the real ones against real repositories.
 *
 * Each repository is a `FakeRepo` keyed by its folder. A clone made through the fake (or
 * registered with `onDisk`) also gets a `.git` folder on disk, so code that looks at the disk
 * sees it. Every call is recorded in domain terms: `{ dir, op, args }`.
 */
import { existsSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CloneDiverged,
  CloneError,
  CloneStopped,
  type Clone,
  type CloneBranchMode,
  type CloneIdentity,
  type CloneLook,
  type CloneOptions,
  type Clones,
} from "../src/activities/clone.js";

export interface FakeRepo {
  origin: string | null;
  /** The checked-out branch; "main" unless named, null for a detached HEAD. */
  branch?: string | null;
  dirty?: boolean;
  /** Commits not pushed; null when the branch has no upstream. */
  ahead?: number | null;
  /** git cannot say whether the working tree is clean. */
  statusFails?: boolean;
  /** The clone's branches; ["main"] unless named. */
  branches?: string[];
  /** origin's branches; ["main"] unless named. */
  remoteBranches?: string[];
  /** origin cannot be reached. */
  unreachable?: boolean;
  /** The sparse folders; absent or null when the checkout is not sparse. */
  sparse?: string[] | null;
  /** What each fetch of the tags answers, in turn (the last one repeats), or asks each time. */
  tags?: string[][] | (() => string[]);
  /** Files HEAD has; true for every file. */
  inHead?: string[] | true;
  /** Files new or changed since HEAD. */
  changed?: string[];
  /** Nothing is staged when a commit is asked for. */
  nothingStaged?: boolean;
  /** The commit a commit makes; "0123abcd" unless named. */
  head?: string;
  /** Branches that have diverged from origin's. */
  diverged?: string[];
  /** No commit yet: carried work stays in place. */
  unborn?: boolean;
  /** Operations that fail, with what git says. */
  fail?: Partial<Record<string, string>>;
}

export interface FakeCall {
  dir: string;
  op: string;
  args: unknown[];
}

/**
 * One spelling per folder, the one the server reaches it by. The server finds the checkout
 * through `realpath`, and on the Windows CI runner the temp root a test builds it under is
 * spelled in 8.3 form (`RUNNER~1`), so a key from `path.resolve` alone missed every clone.
 * A folder not made yet keeps its name below its nearest existing ancestor.
 */
function key(dir: string): string {
  let existing = path.resolve(dir);
  const below: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(dir);
    below.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync.native(existing), ...below);
}

export class FakeClones implements Clones {
  readonly calls: FakeCall[] = [];
  private readonly repos = new Map<string, FakeRepo>();
  /** git is not installed. */
  gitMissing = false;
  /** The remotes that exist; every remote does unless set. */
  existingRemotes: Set<string> | null = null;
  /** A remote whose clone fails, and what git says. */
  failClone: { remote: string; stderr: string } | null = null;
  /** What every clone made through the fake starts with besides its origin and branch. */
  cloned: Partial<FakeRepo> = {};

  /** Registers a repository at `dir` without touching the disk. */
  add(dir: string, repo: FakeRepo): FakeRepo {
    this.repos.set(key(dir), repo);
    return repo;
  }

  /** Registers a repository at `dir`, with a `.git` folder on disk. */
  async onDisk(dir: string, repo: FakeRepo): Promise<FakeRepo> {
    await fs.mkdir(path.join(dir, ".git"), { recursive: true });
    return this.add(dir, repo);
  }

  repo(dir: string): FakeRepo | undefined {
    return this.repos.get(key(dir));
  }

  /** The operations asked of the clone at `dir`, or of any, in order. */
  ops(dir?: string): string[] {
    return this.calls
      .filter((call) => dir === undefined || key(call.dir) === key(dir))
      .map((call) => call.op);
  }

  record(dir: string, op: string, args: unknown[]) {
    this.calls.push({ dir, op, args });
  }

  async available(cwd: string): Promise<boolean> {
    this.record(cwd, "available", []);
    return !this.gitMissing;
  }

  open(dir: string, options: CloneOptions = {}): Clone {
    return new FakeClone(this, dir, options);
  }

  async cloneFrom(
    remote: string,
    dir: string,
    options: { branch?: string; partial?: boolean; timeoutMs?: number } = {},
  ): Promise<void> {
    this.record(dir, "cloneFrom", [remote, { branch: options.branch, partial: !!options.partial }]);
    if (this.failClone?.remote === remote)
      throw new CloneError(["clone", "--", remote, dir], {
        code: 128,
        stdout: "",
        stderr: this.failClone.stderr,
      });
    await this.onDisk(dir, {
      ...this.cloned,
      origin: remote,
      branch: options.branch ?? "main",
      ...(options.partial ? { sparse: [] } : {}),
    });
  }

  async create(dir: string, remote: string, options: { branch?: string } = {}): Promise<void> {
    this.record(dir, "create", [remote]);
    await this.onDisk(dir, {
      origin: remote,
      branch: options.branch ?? "main",
      branches: [],
      unborn: true,
    });
  }

  async remoteExists(remote: string, cwd: string): Promise<boolean> {
    this.record(cwd, "remoteExists", [remote]);
    return this.existingRemotes === null || this.existingRemotes.has(remote);
  }
}

class FakeClone implements Clone {
  constructor(
    private readonly owner: FakeClones,
    readonly dir: string,
    private readonly options: CloneOptions,
  ) {}

  /** Records the call, and fails it as the repository says. */
  private call(op: string, ...args: unknown[]): FakeRepo {
    this.owner.record(this.dir, op, args);
    if (this.options.signal?.aborted) throw new CloneStopped();
    const repo = this.owner.repo(this.dir);
    if (!repo)
      throw new CloneError([op], { code: 128, stdout: "", stderr: "not a git repository" });
    const words = repo.fail?.[op];
    if (words !== undefined)
      throw new CloneError([op, ...args.filter((arg) => typeof arg === "string")], {
        code: 1,
        stdout: "",
        stderr: words,
      });
    return repo;
  }

  async state(): Promise<CloneLook> {
    this.owner.record(this.dir, "state", []);
    const repo = this.owner.repo(this.dir);
    if (!repo) return { branch: null, clean: null, ahead: null, origin: null };
    return {
      branch: repo.branch === undefined ? "main" : repo.branch,
      clean: repo.statusFails ? null : !repo.dirty,
      ahead: repo.ahead === undefined ? 0 : repo.ahead,
      origin: repo.origin,
    };
  }

  async origin(): Promise<string> {
    return this.call("origin").origin ?? "";
  }

  async hasBranch(branch: string): Promise<boolean> {
    return (this.call("hasBranch", branch).branches ?? ["main"]).includes(branch);
  }

  async remoteHasBranch(branch: string): Promise<boolean> {
    const repo = this.call("remoteHasBranch", branch);
    if (repo.unreachable)
      throw new CloneError(["ls-remote"], {
        code: 128,
        stdout: "",
        stderr: "ssh: Could not resolve hostname",
      });
    return (repo.remoteBranches ?? ["main"]).includes(branch);
  }

  async includes(folder: string): Promise<boolean> {
    const { sparse } = this.call("includes", folder);
    return !sparse || sparse.some((have) => folder === have || folder.startsWith(`${have}/`));
  }

  async include(folders: readonly string[]): Promise<void> {
    const repo = this.call("include", [...folders]);
    if (!repo.sparse) return;
    for (const folder of folders)
      if (!repo.sparse.some((have) => folder === have || folder.startsWith(`${have}/`)))
        repo.sparse.push(folder);
  }

  async fetch(): Promise<void> {
    this.call("fetch");
  }

  async fetchTags(): Promise<string[]> {
    const lists = this.call("fetchTags").tags ?? [[]];
    if (typeof lists === "function") return lists();
    const reads = (fetchedTags.get(lists) ?? 0) + 1;
    fetchedTags.set(lists, reads);
    return lists[Math.min(reads - 1, lists.length - 1)]!;
  }

  async onBranchFromOrigin(
    branch: string,
    mode: CloneBranchMode,
  ): Promise<{ workInPlace: boolean }> {
    const repo = this.call("onBranchFromOrigin", branch, mode);
    if (mode.work !== "discard" && repo.diverged?.includes(branch))
      throw new CloneDiverged(["merge", "--ff-only", `origin/${branch}`], {
        code: 128,
        stdout: "",
        stderr: "fatal: Not possible to fast-forward, aborting.",
      });
    repo.branch = branch;
    if (mode.work === "discard") repo.dirty = false;
    return { workInPlace: mode.work === "carry" && !!repo.unborn && !!repo.dirty };
  }

  async branchFrom(branch: string, start: string): Promise<void> {
    this.call("branchFrom", branch, start).branch = branch;
  }

  async stage(paths?: readonly string[], options: { sparse?: boolean } = {}): Promise<void> {
    this.call("stage", paths ? [...paths] : "all", options);
  }

  async commitStaged(identity: CloneIdentity, message: string): Promise<string | null> {
    const repo = this.call("commitStaged", message, identity);
    if (repo.nothingStaged) return null;
    repo.dirty = false;
    repo.unborn = false;
    return repo.head ?? "0123abcd";
  }

  async push(branch: string, options: { lease?: boolean; track?: boolean } = {}): Promise<void> {
    const repo = this.call("push", branch, options);
    repo.remoteBranches = [...new Set([...(repo.remoteBranches ?? ["main"]), branch])];
  }

  async inHead(file: string): Promise<boolean> {
    const held = this.call("inHead", file).inHead ?? [];
    return held === true || held.includes(file);
  }

  async changed(file: string): Promise<boolean> {
    return (this.call("changed", file).changed ?? []).includes(file);
  }
}

/** How often each repository's tag lists were read, across every clone opened on it. */
const fetchedTags = new WeakMap<string[][], number>();
