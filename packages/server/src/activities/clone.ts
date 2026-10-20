/**
 * A clone, in the terms the WAF workspace and deploys speak of it: what it looks like, which
 * branch it is on and whether origin has it, putting it on a branch as origin has it, staging,
 * committing, pushing, tags and what they hold, and the sparse folders a media clone checks out.
 *
 * It hides the git command lines, the batching of long path lists, the parsing of what git
 * prints, and the three ways a clone is put on a branch as origin has it (see
 * `onBranchFromOrigin`). Every command runs through a `DeployGit` (by default `spawnGit`, on
 * `run-program.ts`), so the environment rules there (no prompt, the operator's own SSH) hold.
 *
 * A command that fails throws `CloneError`, carrying the command and what git said; a signal
 * that aborts throws `CloneStopped`. Reads that only ask (`state`) never throw. A clone opened
 * with `log` writes each command and what git printed to it, as the deploy log shows them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../http/errors.js";
import { spawnGit, type DeployGit, type DeployGitResult } from "./deploy-git.js";

/** How long asking a remote whether it has a branch may take, unless the clone says. */
const REMOTE_ASK_TIMEOUT_MS = 30_000;

/** Characters of paths one command may name, well under Windows' 32,767-character command line. */
const PATHS_BATCH_CHARS = 8_000;

/** How the message of a stash a deploy made begins, as earlier versions wrote it too. */
const SET_ASIDE = "penguin-harness deploy";

/** A stash a deploy made, as `git stash list --format=%gs` lists it: "On <branch>: <message>". */
const SET_ASIDE_ENTRY = new RegExp(`^On [^:]*: ${SET_ASIDE}(?::|$)`);

/** What git says when the repository it was asked about does not exist. */
export function repositoryMissing(stderr: string): boolean {
  return /repository not found|does not appear to be a git repository|not found/i.test(stderr);
}

/** git's own words for why it failed, or why it never ran. */
export function gitError(stderr: string, error?: string): string {
  if (error === "not_found") return "git is not installed on the server.";
  if (error === "timed_out") return "it took too long.";
  const text = stderr.trim();
  return text ? text.slice(-2000) : (error ?? "unknown error");
}

/** A git command that failed: which one, and what git said. */
export class CloneError extends Error {
  /** The command as it was run, `git …`. */
  readonly command: string;

  constructor(
    readonly args: readonly string[],
    readonly result: DeployGitResult,
  ) {
    super(`git ${args[0]} failed: ${gitError(result.stderr, result.error)}`);
    this.name = "CloneError";
    this.command = `git ${args.join(" ")}`;
  }

  /** git's own words for why it failed. */
  get reason(): string {
    return gitError(this.result.stderr, this.result.error);
  }
}

/** A branch that cannot be fast-forwarded to origin's: each has commits the other lacks. */
export class CloneDiverged extends CloneError {
  constructor(args: readonly string[], result: DeployGitResult) {
    super(args, result);
    this.name = "CloneDiverged";
  }
}

/** The clone's signal aborted. */
export class CloneStopped extends Error {
  constructor() {
    super("stopped");
    this.name = "CloneStopped";
  }
}

/** What a clone looks like; null for what git could not say. */
export interface CloneLook {
  /** The checked-out branch; null on a detached HEAD or when git could not say. */
  branch: string | null;
  /** Whether the working tree has no changes. */
  clean: boolean | null;
  /** How many commits the branch has that its upstream does not. */
  ahead: number | null;
  /** origin's URL. */
  origin: string | null;
}

/** Who commits. */
export interface CloneIdentity {
  name: string;
  email: string;
}

/**
 * How a clone is put on a branch as origin has it:
 *
 * - `carry`: the work in its working tree is set aside, the branch is checked out (made from
 *   origin's, or where the clone is when origin has none) and fast-forwarded to origin's, and
 *   the work is put back. When that fails, the clone goes back to the branch it was on with its
 *   work as it was. Work that conflicts with origin's stays set aside in git's stash, which
 *   `stashedWork` counts. A clone with no commit yet keeps its work in place, on the branch as
 *   origin has it, origin's files checked out beside it.
 * - `discard`: the branch is made as origin has it (else from origin's `from`, else the
 *   clone's own `from`), and whatever else is in the working tree is thrown away.
 * - `clean`: for a clone with no work of its own (the caller has made sure): origin's branch
 *   is fetched, switched to, and fast-forwarded; a branch that has diverged from origin's is
 *   left, back on the branch the clone was on.
 *
 * A branch that cannot be fast-forwarded throws `CloneDiverged`.
 */
export type CloneBranchMode =
  { work: "carry" } | { work: "discard"; from: string } | { work: "clean" };

export interface CloneOptions {
  /** Each command, and what git printed unless it was only asked a question. */
  log?: (line: string) => void;
  /** Aborting it stops the command running and refuses the next. */
  signal?: AbortSignal;
  /** How long each command may take; git's own limit when absent. */
  timeoutMs?: number;
  /** How long a command that reaches the remote may take (fetch, push, asking it). */
  networkTimeoutMs?: number;
}

/** One clone on disk. */
export interface Clone {
  readonly dir: string;
  /** Its branch, whether it is clean, how far it is ahead, and origin. Never throws. */
  state(): Promise<CloneLook>;
  /** origin's URL. */
  origin(): Promise<string>;
  /** Whether the clone has `branch`. */
  hasBranch(branch: string): Promise<boolean>;
  /** Whether origin has `branch`; this reaches the remote. */
  remoteHasBranch(branch: string): Promise<boolean>;
  /** Whether the checkout includes `folder`: a sparse folder that is it or holds it, or no sparse checkout at all. */
  includes(folder: string): Promise<boolean>;
  /** Adds the folders the checkout does not include yet; their files (and LFS files) arrive. */
  include(folders: readonly string[]): Promise<void>;
  /** Fetches origin. */
  fetch(): Promise<void>;
  /** Fetches origin's tags, and answers every tag the clone then has. */
  fetchTags(): Promise<string[]>;
  /** Puts the clone on `branch` as origin has it (see `CloneBranchMode`). */
  onBranchFromOrigin(branch: string, mode: CloneBranchMode): Promise<{ workInPlace: boolean }>;
  /** How many times a deploy set work aside in git's stash and could not put it back. */
  stashedWork(): Promise<number>;
  /** Makes `branch` at `start` and checks it out, carrying the working tree. */
  branchFrom(branch: string, start: string): Promise<void>;
  /** Stages everything, or only `paths` (in batches); `sparse` reaches folders not checked out. */
  stage(paths?: readonly string[], options?: { sparse?: boolean }): Promise<void>;
  /** Commits what is staged; the new commit, or null when nothing was staged. */
  commitStaged(identity: CloneIdentity, message: string): Promise<string | null>;
  /** Pushes `branch` to origin, with a lease on what the clone last saw of it, and tracking. */
  push(branch: string, options?: { lease?: boolean; track?: boolean }): Promise<void>;
  /** Whether HEAD's tree has `file`, which a partial clone knows without downloading it. */
  inHead(file: string): Promise<boolean>;
  /** Whether `file` is new or changed since HEAD (true when git cannot say). */
  changed(file: string): Promise<boolean>;
  /**
   * The paths new, changed or deleted since HEAD, as git names them; a new folder is one path.
   * Past what git's output keeps, the ones at its end, and maybe part of the first of those.
   */
  changes(): Promise<string[]>;
  /** The commit the clone's `branch` is at. */
  commitOf(branch: string): Promise<string>;
  /** Whether two commits hold the same files (false when git does not know one of them). */
  sameContent(a: string, b: string): Promise<boolean>;
  /** Whether release tag `tag` holds `commit`: it is that commit, or one made on top of it. */
  tagHolds(tag: string, commit: string): Promise<boolean>;
  /** The files `commit` has that release tag `tag` does not, or has otherwise. */
  tagDiffers(tag: string, commit: string): Promise<string[]>;
  /** What `file` holds in release tag `tag` or in `commit`; null when there is no such file. */
  fileAt(at: { tag: string } | { commit: string }, file: string): Promise<string | null>;
  /**
   * Writes the files `commit` holds into `dir`, a folder outside the clone, and nothing of the
   * repository: no `.git`, and a symbolic link as a file holding its target. The clone's index
   * and working tree stay as they are.
   */
  exportTo(commit: string, dir: string): Promise<void>;
}

/** Every clone, and making them. */
export interface Clones {
  /** Whether git can be run at all. */
  available(cwd: string): Promise<boolean>;
  open(dir: string, options?: CloneOptions): Clone;
  /**
   * Clones `remote` into `dir`: one branch when `branch` is named, and, when `partial`, without
   * file contents or any folder checked out, LFS files left for `include` to fetch per folder.
   */
  cloneFrom(
    remote: string,
    dir: string,
    options?: { branch?: string; partial?: boolean; timeoutMs?: number },
  ): Promise<void>;
  /** Makes `dir` an empty repository on `branch` with origin set to `remote`. */
  create(
    dir: string,
    remote: string,
    options?: { branch?: string; timeoutMs?: number },
  ): Promise<void>;
  /** Whether `remote` exists; throws `CloneError` when it could not be asked. */
  remoteExists(remote: string, cwd: string): Promise<boolean>;
}

/** Clones over `git` (by default this server's own). */
export function gitClones(git: DeployGit = spawnGit): Clones {
  return {
    async available(cwd) {
      const result = await git.run(["--version"], cwd, { timeoutMs: 10_000 });
      return result.code === 0;
    },
    open: (dir, options) => new GitClone(git, dir, options),
    async cloneFrom(remote, dir, options = {}) {
      const args = [
        "clone",
        ...(options.branch ? ["--branch", options.branch, "--single-branch"] : []),
        ...(options.partial ? ["--filter=blob:none", "--sparse"] : []),
        "--",
        remote,
        dir,
      ];
      const timeout = options.timeoutMs ? { timeoutMs: options.timeoutMs } : {};
      const cloned = await git.run(args, path.dirname(dir), {
        ...timeout,
        // Smudging every LFS file of a partial clone would download the repository after all.
        ...(options.partial ? { env: { GIT_LFS_SKIP_SMUDGE: "1" } } : {}),
      });
      if (cloned.code !== 0) throw new CloneError(args, cloned);
      if (options.partial) {
        // Its hooks go where git-lfs puts them for whoever runs git in the clone by hand. git
        // run through `DeployGit` runs no hook (`Clone.push` uploads LFS files itself).
        const hooks = path.join(dir, ".git", "hooks").split(path.sep).join("/");
        const lfs = ["-c", `core.hooksPath=${hooks}`, "lfs", "install", "--local"];
        const installed = await git.run(lfs, dir, timeout);
        if (installed.code !== 0) throw new CloneError(lfs, installed);
      }
    },
    async create(dir, remote, options = {}) {
      const timeout = options.timeoutMs ? { timeoutMs: options.timeoutMs } : {};
      for (const args of [
        ["init", `--initial-branch=${options.branch ?? "main"}`],
        ["remote", "add", "origin", remote],
      ]) {
        const result = await git.run(args, dir, timeout);
        if (result.code !== 0) throw new CloneError(args, result);
      }
    },
    async remoteExists(remote, cwd) {
      const args = ["ls-remote", "--heads", "--", remote];
      const result = await git.run(args, cwd);
      if (result.code === 0) return true;
      if (repositoryMissing(result.stderr)) return false;
      throw new CloneError(args, result);
    },
  };
}

/** The git commands that change a repository's branches, index, working tree or remote. */
const CHANGES_REPOSITORY = new Set([
  "add",
  "checkout",
  "clean",
  "commit",
  "merge",
  "push",
  "reset",
  "switch",
]);

/** The same commands' verbs that only ask, never change: `git stash list`, say. */
const ASKS = new Set(["list", "get-url", "show"]);

/** Whether `args` change the repository they run in (CHANGES_REPOSITORY, and the verbs that do). */
function changesRepository(args: readonly string[]): boolean {
  let at = 0;
  while (args[at] === "-c") at += 2;
  const command = args[at] ?? "";
  const verb = args[at + 1] ?? "";
  if (CHANGES_REPOSITORY.has(command)) return true;
  if (["stash", "remote", "sparse-checkout", "lfs"].includes(command)) return !ASKS.has(verb);
  // `symbolic-ref HEAD <ref>` moves HEAD; with only a name it reads it.
  if (command === "symbolic-ref")
    return args.slice(at + 1).filter((arg) => !arg.startsWith("-")).length > 1;
  return false;
}

interface RunOptions {
  /** Failing is an answer, not an error: the result comes back. */
  allowFailure?: boolean;
  /** Only a question: what git printed is not logged. */
  quiet?: boolean;
  /** Reaches the remote. */
  network?: boolean;
  /** Runs, and runs to its end, even once the signal has aborted: putting work back. */
  unstoppable?: boolean;
  timeoutMs?: number;
  /** How many characters of each stream are kept (by default `GIT_OUTPUT_MAX`). */
  outputMax?: number;
  /** Added to the environment git runs in. */
  env?: Record<string, string>;
}

class GitClone implements Clone {
  constructor(
    private readonly git: DeployGit,
    readonly dir: string,
    private readonly options: CloneOptions = {},
  ) {}

  private checkStopped() {
    if (this.options.signal?.aborted) throw new CloneStopped();
  }

  /** Set once git has said the clone's folder is its repository's root. */
  private ownRepository = false;

  /**
   * Refuses to change a clone whose folder is not its repository's root, as Loom's
   * `require_standalone_deploy_repository` does: a module folder inside another repository (the
   * waf-modules monorepo, say) has no `.git` of its own, and git run there would stage, stash,
   * check out and clean the whole of that repository. Only git's own answer lets a change
   * through, and only that answer is remembered: git that timed out or was stopped is asked
   * again next time. git that is not installed fails on the command itself.
   */
  private async requireOwnRepository(): Promise<void> {
    if (this.ownRepository) return;
    const args = ["rev-parse", "--show-toplevel"];
    const result = await this.git.run(args, this.dir, { timeoutMs: 30_000 });
    if (result.error === "not_found") return;
    if (result.error)
      throw new HttpError(
        503,
        "module_repository_unknown",
        `Could not tell whether ${this.dir} is its own Git repository (${gitError(result.stderr, result.error)}), so nothing was changed in it.`,
      );
    if (result.code !== 0)
      throw new HttpError(
        409,
        "module_not_repository",
        `${this.dir} is not a Git repository. Deploying needs the module to be its own Git repository.`,
      );
    const real = (dir: string) => fs.realpath(dir).catch(() => path.resolve(dir));
    const top = result.stdout.trim();
    if ((await real(top)) !== (await real(this.dir)))
      throw new HttpError(
        409,
        "module_shared_repository",
        `${this.dir} belongs to a shared Git repository at ${top}. Deploying needs the module to be its own Git repository, so nothing was changed in the shared one.`,
      );
    this.ownRepository = true;
  }

  private async run(args: string[], options: RunOptions = {}): Promise<DeployGitResult> {
    if (!options.unstoppable) this.checkStopped();
    if (changesRepository(args)) await this.requireOwnRepository();
    const { log } = this.options;
    const signal = options.unstoppable ? undefined : this.options.signal;
    log?.(`$ git ${args.join(" ")}`);
    const timeoutMs =
      options.timeoutMs ??
      (options.network ? this.options.networkTimeoutMs : undefined) ??
      this.options.timeoutMs;
    const result = await this.git.run(args, this.dir, {
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(signal ? { signal } : {}),
      ...(options.outputMax ? { outputMax: options.outputMax } : {}),
      ...(options.env ? { env: options.env } : {}),
    });
    if (log && !options.quiet)
      for (const line of `${result.stdout}\n${result.stderr}`.split(/\r?\n/))
        if (line.trim() !== "") log(line);
    if (!options.unstoppable) this.checkStopped();
    if (result.error === "stopped") throw new CloneStopped();
    if (result.code !== 0 && !options.allowFailure) throw new CloneError(args, result);
    return result;
  }

  /** Whether `ref` names a commit. */
  private async has(ref: string): Promise<boolean> {
    const result = await this.run(["rev-parse", "--verify", "--quiet", ref], {
      allowFailure: true,
      quiet: true,
    });
    return result.code === 0;
  }

  /** Runs `command -- <paths>` in batches, so hundreds of files never overflow the command line. */
  private async withPaths(command: readonly string[], paths: readonly string[]) {
    let batch: string[] = [];
    let size = 0;
    for (const file of paths) {
      if (batch.length && size + file.length + 1 > PATHS_BATCH_CHARS) {
        await this.run([...command, "--", ...batch]);
        batch = [];
        size = 0;
      }
      batch.push(file);
      size += file.length + 1;
    }
    if (batch.length) await this.run([...command, "--", ...batch]);
  }

  /** Fast-forwards the checked-out branch to origin's; `CloneDiverged` when it cannot. */
  private async fastForward(branch: string) {
    try {
      await this.run(["merge", "--ff-only", `origin/${branch}`]);
    } catch (error) {
      if (error instanceof CloneError) throw new CloneDiverged(error.args, error.result);
      throw error;
    }
  }

  async state(): Promise<CloneLook> {
    const ask = (args: string[]) => this.run(args, { allowFailure: true, quiet: true });
    const [head, status, ahead, origin] = await Promise.all([
      ask(["rev-parse", "--abbrev-ref", "HEAD"]),
      ask(["status", "--porcelain"]),
      ask(["rev-list", "--count", "@{u}..HEAD"]),
      ask(["remote", "get-url", "origin"]),
    ]);
    const branch = head.code === 0 ? head.stdout.trim() : "";
    const count = ahead.code === 0 ? Number.parseInt(ahead.stdout.trim(), 10) : Number.NaN;
    return {
      branch: branch && branch !== "HEAD" ? branch : null,
      clean: status.code === 0 ? status.stdout.trim() === "" : null,
      ahead: Number.isFinite(count) ? count : null,
      origin: origin.code === 0 ? origin.stdout.trim() || null : null,
    };
  }

  async origin(): Promise<string> {
    return (await this.run(["remote", "get-url", "origin"], { quiet: true })).stdout.trim();
  }

  async hasBranch(branch: string): Promise<boolean> {
    const args = ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`];
    const result = await this.run(args, { allowFailure: true, quiet: true });
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw new CloneError(args, result);
  }

  async remoteHasBranch(branch: string): Promise<boolean> {
    const result = await this.run(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], {
      quiet: true,
      timeoutMs: this.options.networkTimeoutMs ?? REMOTE_ASK_TIMEOUT_MS,
    });
    return result.stdout.trim() !== "";
  }

  /** The sparse folders, or null when the checkout is not sparse. */
  private async sparseFolders(): Promise<string[] | null> {
    const args = ["sparse-checkout", "list"];
    const list = await this.run(args, { allowFailure: true, quiet: true });
    if (list.code !== 0) {
      if (/not sparse/i.test(list.stderr)) return null;
      throw new CloneError(args, list);
    }
    return list.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\/+$/, ""))
      .filter(Boolean);
  }

  async includes(folder: string): Promise<boolean> {
    const folders = await this.sparseFolders();
    return folders === null || folders.some((have) => covers(have, folder));
  }

  async include(folders: readonly string[]): Promise<void> {
    const have = await this.sparseFolders();
    if (have === null) return;
    const missing = folders.filter((folder) => !have.some((entry) => covers(entry, folder)));
    // Adding a folder checks out only its files, and the LFS filter smudges them as it goes.
    // Never `git lfs pull`: it lists the whole tree with sizes, which in a partial clone
    // fetches every blob of the repository one at a time, and takes hours.
    if (missing.length) await this.run(["sparse-checkout", "add", "--", ...missing]);
  }

  async fetch(): Promise<void> {
    await this.run(["fetch", "origin"], { network: true });
  }

  async fetchTags(): Promise<string[]> {
    await this.run(["fetch", "--tags", "origin"], { network: true });
    const listed = await this.run(["tag", "--list"], { quiet: true });
    return listed.stdout.split(/\r?\n/);
  }

  async onBranchFromOrigin(
    branch: string,
    mode: CloneBranchMode,
  ): Promise<{ workInPlace: boolean }> {
    if (mode.work === "discard") {
      await this.fetch();
      let start = mode.from;
      if (await this.has(`refs/remotes/origin/${branch}`)) start = `origin/${branch}`;
      else if (await this.has(`refs/remotes/origin/${mode.from}`)) start = `origin/${mode.from}`;
      await this.run(["checkout", "-f", "-B", branch, start]);
      await this.run(["clean", "-fd"]);
      return { workInPlace: false };
    }
    if (mode.work === "clean") {
      // A single-branch clone fetches only its first branch until told of another.
      await this.run(["remote", "set-branches", "--add", "origin", branch]);
      await this.run(["fetch", "origin", branch], { network: true });
      // A branch the clone already has keeps its commits; one it has not is made from origin's.
      await this.run(["switch", branch]);
      try {
        await this.fastForward(branch);
      } catch (error) {
        // Left on the branch, the clone would read as origin's although it is not: it goes
        // back to where it was.
        if (error instanceof CloneDiverged) await this.run(["checkout", "-"]);
        throw error;
      }
      return { workInPlace: false };
    }
    return this.carry(branch);
  }

  private async carry(branch: string): Promise<{ workInPlace: boolean }> {
    const status = await this.run(["status", "--porcelain"], { quiet: true });
    const work = status.stdout.trim() !== "";
    // Where the work goes back to should the branch not come up to origin's.
    const from = work ? await this.head() : "";
    const message = `${SET_ASIDE}: work set aside to bring ${branch} up to origin`;
    const stash = ["stash", "push", "--include-untracked", "-m", message];
    // Setting the work aside runs to its end: a stop that comes meanwhile is met below, where
    // the work is put back, never between the stash and the code that knows of it.
    const once = { allowFailure: true, unstoppable: true };
    let stashed = work && (await this.run(stash, once)).code === 0;
    // git cannot stash in a repository with no commit yet, whose work then stays where it
    // is. A stash that failed for any other reason (a conflict, say) fails with git's words.
    if (work && !stashed && (await this.has("HEAD"))) {
      await this.run(stash, { unstoppable: true });
      stashed = true;
    }
    if (work && !stashed) return this.keepInPlace(branch);
    try {
      const local = await this.has(`refs/heads/${branch}`);
      const remote = await this.has(`refs/remotes/origin/${branch}`);
      if (local) await this.run(["checkout", branch]);
      else if (remote) await this.run(["checkout", "-b", branch, `origin/${branch}`]);
      else await this.run(["checkout", "-B", branch]);
      if (remote) await this.fastForward(branch);
    } catch (error) {
      if (stashed) await this.putBack(from);
      throw error;
    }
    // Work that conflicts with origin's stays in the stash, and git's output says so.
    if (stashed) await this.run(["stash", "pop"], { unstoppable: true });
    return { workInPlace: false };
  }

  /**
   * A repository with no commit yet keeps its work where it is: the branch starts as origin
   * has it, the work left as changes to it; with no such branch on origin either, it is born
   * when the work is committed.
   */
  private async keepInPlace(branch: string): Promise<{ workInPlace: boolean }> {
    const remote = await this.has(`refs/remotes/origin/${branch}`);
    await this.run(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
    if (remote) {
      await this.run(["reset", "--mixed", `origin/${branch}`]);
      // Origin's files the clone never had would read as deleted and be committed away:
      // they are checked out, and only the clone's own work is a change.
      const deleted = await this.run(["ls-files", "--deleted", "-z"], { quiet: true });
      await this.withPaths(["checkout"], deleted.stdout.split("\0").filter(Boolean));
    }
    return { workInPlace: true };
  }

  /** The checked-out branch, or the commit a detached HEAD is at. */
  private async head(): Promise<string> {
    const args = ["symbolic-ref", "--quiet", "--short", "HEAD"];
    const branch = await this.run(args, { allowFailure: true, quiet: true });
    if (branch.code === 0) return branch.stdout.trim();
    return (await this.run(["rev-parse", "HEAD"], { quiet: true })).stdout.trim();
  }

  /**
   * Puts the work `carry` set aside back where it was taken from, after a failure: on `from`,
   * what was staged staged again. It runs even once the signal has aborted, so a stopped deploy
   * never leaves the work behind; what git cannot put back stays in the stash, and its output
   * says why.
   */
  private async putBack(from: string) {
    const always = { allowFailure: true, unstoppable: true };
    if ((await this.run(["checkout", from], always)).code !== 0) return;
    await this.run(["stash", "pop", "--index"], always);
  }

  async stashedWork(): Promise<number> {
    const listed = await this.run(["stash", "list", "--format=%gs"], { quiet: true });
    return listed.stdout.split(/\r?\n/).filter((line) => SET_ASIDE_ENTRY.test(line)).length;
  }

  async branchFrom(branch: string, start: string): Promise<void> {
    await this.run(["checkout", "-B", branch, start]);
  }

  async stage(paths?: readonly string[], options: { sparse?: boolean } = {}): Promise<void> {
    if (!paths) await this.run(["add", "--all"]);
    else await this.withPaths(["add", options.sparse ? "--sparse" : "--all"], paths);
  }

  async commitStaged(identity: CloneIdentity, message: string): Promise<string | null> {
    const staged = await this.run(["diff", "--cached", "--quiet"], {
      allowFailure: true,
      quiet: true,
    });
    if (staged.code === 0) return null;
    await this.run([
      "-c",
      `user.name=${identity.name}`,
      "-c",
      `user.email=${identity.email}`,
      "commit",
      "-m",
      message,
    ]);
    return (await this.run(["rev-parse", "HEAD"], { quiet: true })).stdout.trim();
  }

  async push(branch: string, options: { lease?: boolean; track?: boolean } = {}): Promise<void> {
    // git runs no hook here (`deploy-git.ts`), git-lfs's pre-push hook included, so the LFS
    // files of a branch that routes files through LFS are uploaded before the push.
    if (await this.usesLfs(branch))
      await this.run(["lfs", "push", "origin", branch], { network: true });
    await this.run(
      [
        "push",
        ...(options.lease ? ["--force-with-lease"] : []),
        ...(options.track ? ["-u"] : []),
        "origin",
        branch,
      ],
      { network: true },
    );
  }

  /** Whether `branch` has a `.gitattributes` that routes files through LFS. */
  private async usesLfs(branch: string): Promise<boolean> {
    const args = ["grep", "-q", "-e", "filter=lfs", `refs/heads/${branch}`, "--"];
    const found = await this.run([...args, ":(glob)**/.gitattributes"], {
      allowFailure: true,
      quiet: true,
    });
    return found.code === 0;
  }

  async inHead(file: string): Promise<boolean> {
    const listed = await this.run(["ls-tree", "--name-only", "HEAD", "--", file], {
      allowFailure: true,
      quiet: true,
    });
    return listed.code === 0 && listed.stdout.trim() !== "";
  }

  async changed(file: string): Promise<boolean> {
    const status = await this.run(["status", "--porcelain", "--", file], {
      allowFailure: true,
      quiet: true,
    });
    return status.code !== 0 || status.stdout.trim() !== "";
  }

  async changes(): Promise<string[]> {
    const listed = await this.run(["status", "--porcelain", "-z"], { quiet: true });
    const entries = listed.stdout.split("\0");
    const paths: string[] = [];
    for (let index = 0; index < entries.length; index++) {
      // Output past its bound keeps its end: a first entry cut short is skipped when it no
      // longer reads as one, and names what is left of its path when it still does.
      const entry = STATUS_ENTRY.exec(entries[index]!);
      if (!entry) continue;
      paths.push(entry[3]!);
      // A rename or copy names the path it came from in the entry after it.
      if (/[RC]/.test(entry[1]! + entry[2]!)) index++;
    }
    return paths;
  }

  async commitOf(branch: string): Promise<string> {
    const args = ["rev-parse", "--verify", `refs/heads/${branch}`];
    return (await this.run(args, { quiet: true })).stdout.trim();
  }

  async sameContent(a: string, b: string): Promise<boolean> {
    const trees = await this.run(["rev-parse", `${a}^{tree}`, `${b}^{tree}`], {
      allowFailure: true,
      quiet: true,
    });
    if (trees.code !== 0) return false;
    const [left, right] = trees.stdout.trim().split(/\r?\n/);
    return !!left && left === right;
  }

  async tagHolds(tag: string, commit: string): Promise<boolean> {
    const args = ["merge-base", "--is-ancestor", commit, `refs/tags/${tag}`];
    const result = await this.run(args, { allowFailure: true, quiet: true });
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw new CloneError(args, result);
  }

  async tagDiffers(tag: string, commit: string): Promise<string[]> {
    // Files the tag adds are not the commit's, so they are not asked about.
    const args = ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=DMT"];
    args.push(commit, `refs/tags/${tag}`, "--");
    const listed = await this.run(args, { quiet: true, outputMax: FILE_OUTPUT_MAX });
    return listed.stdout.split("\0").filter((file) => file !== "");
  }

  async fileAt(at: { tag: string } | { commit: string }, file: string): Promise<string | null> {
    const revision = "tag" in at ? `refs/tags/${at.tag}` : at.commit;
    const shown = await this.run(["show", `${revision}:${file}`], {
      allowFailure: true,
      quiet: true,
      outputMax: FILE_OUTPUT_MAX,
    });
    // A file past the bound is cut, so it reads as none rather than as what is left of it.
    if (shown.code !== 0 || shown.stdout.length >= FILE_OUTPUT_MAX) return null;
    return shown.stdout;
  }

  async exportTo(commit: string, dir: string): Promise<void> {
    // Through an index of the export's own, beside the folder, so the clone's is never touched;
    // one an export cut short left, or its lock, is not this one's.
    const env = { GIT_INDEX_FILE: `${dir}.index` };
    const prefix = `${dir.split(path.sep).join("/")}/`;
    await removeIndex(env.GIT_INDEX_FILE);
    try {
      await this.run(["read-tree", commit], { env, quiet: true });
      await this.run(
        ["-c", "core.symlinks=false", "checkout-index", "--all", "--force", `--prefix=${prefix}`],
        { env, quiet: true },
      );
    } finally {
      await removeIndex(env.GIT_INDEX_FILE);
    }
  }
}

/** Removes an index file of git's and its lock. */
async function removeIndex(index: string): Promise<void> {
  await fs.rm(index, { force: true });
  await fs.rm(`${index}.lock`, { force: true });
}

/** How much of a file, or of a list of files, git's output may carry. */
const FILE_OUTPUT_MAX = 16 * 1024 * 1024;

/** One `git status --porcelain -z` entry: the index's and the working tree's state, and the path. */
const STATUS_ENTRY = /^([ MTADRCU?!])([ MTADRCU?!]) (.+)$/s;

/** Whether sparse folder `have` checks out `folder`: it is that folder or holds it. */
function covers(have: string, folder: string): boolean {
  return folder === have || folder.startsWith(`${have}/`);
}
