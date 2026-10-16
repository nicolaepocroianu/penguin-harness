/**
 * git for deploys: the port every git command goes through (`clone.ts` speaks it), the real
 * one that spawns `git`, the branches a deploy works on, and comparing remotes.
 *
 * git authenticates with the host's own SSH keys; Penguin stores no git credential. So that
 * a missing key fails rather than waits on a prompt nobody sees, the child runs with
 * `GIT_TERMINAL_PROMPT=0` and SSH in batch mode. No shell, a time limit, bounded output.
 */
import { runProgram } from "./run-program.js";
import { moduleShortName } from "./waf-layout.js";

/** How long one git call may take unless the caller says otherwise. */
export const GIT_TIMEOUT_MS = 60_000;

/** How much of a git call's output is kept, per stream: the end, where errors are. */
export const GIT_OUTPUT_MAX = 64 * 1024;

export interface DeployGitResult {
  /** The exit code; null when git did not exit on its own (not started, or stopped). */
  code: number | null;
  stdout: string;
  stderr: string;
  /**
   * Why there is no exit code: git is not installed, it ran past its time limit, or the
   * caller's signal stopped it.
   */
  error?: "not_found" | "timed_out" | "not_started" | "stopped";
}

export interface DeployGitOptions {
  timeoutMs?: number;
  /** Stops git, and everything it started, as soon as it aborts. */
  signal?: AbortSignal;
  /** Added to the environment git runs in (never replaces the no-prompt settings). */
  env?: Record<string, string>;
  /** How many characters of each stream are kept (by default `GIT_OUTPUT_MAX`). */
  outputMax?: number;
}

/** Every git call a deploy makes. */
export interface DeployGit {
  run(args: string[], cwd: string, opts?: DeployGitOptions): Promise<DeployGitResult>;
}

/**
 * The environment git runs in: never prompts, SSH in batch mode. An operator's own
 * `GIT_SSH_COMMAND` or `GIT_SSH` (a particular key, a proxy) is kept as it is: replacing it
 * would break a server whose remotes only answer to that setup.
 */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const ownSsh = !!base.GIT_SSH_COMMAND || !!base.GIT_SSH;
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    ...(ownSsh ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" }),
  };
}

/** The real port: `git` on this server's PATH. Never throws. */
export const spawnGit: DeployGit = {
  async run(args, cwd, opts = {}) {
    const result = await runProgram({
      command: "git",
      args,
      cwd,
      env: gitEnv({ ...process.env, ...opts.env }),
      timeoutMs: opts.timeoutMs ?? GIT_TIMEOUT_MS,
      signal: opts.signal,
      outputMax: opts.outputMax ?? GIT_OUTPUT_MAX,
    });
    const { code, stdout, stderr } = result;
    switch (result.outcome) {
      case "exited":
        return { code, stdout, stderr };
      case "not_found":
        return { code, stdout, stderr: result.error ?? stderr, error: "not_found" };
      case "failed_to_start":
        return { code: null, stdout, stderr: result.error ?? stderr, error: "not_started" };
      default:
        return { code: null, stdout, stderr, error: result.outcome };
    }
  },
};

/** The module branch a deploy pushes, named as Loom named it so its branch is reused. */
export function deployBranchName(moduleFolder: string): string {
  return `loom/${moduleShortName(moduleFolder)}-deploy`;
}

/** The activity-data branch a deploy pushes, named as Loom named it so its branch is reused. */
export function activityDataBranchName(productCode: string): string {
  return `loom/${productCode}-activity-data`;
}

/** The branch every deploy starts from. */
export const BASE_BRANCH = "main";

/**
 * A remote reduced to `host/owner/repo`, lower-cased and without `.git`, so the SSH and
 * https spellings of one repository compare equal. Null when it does not look like a remote.
 */
export function remoteKey(remote: string): string | null {
  const raw = remote.trim().replace(/^git\+/, "");
  if (raw === "") return null;
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(raw);
  let host: string;
  let pathname: string;
  if (scp && !raw.includes("://")) {
    host = scp[1]!;
    pathname = scp[2]!;
  } else {
    try {
      const url = new URL(raw);
      host = url.host;
      pathname = url.pathname;
    } catch {
      return null;
    }
  }
  const tail = pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  if (!tail) return null;
  return `${host}/${tail}`.toLowerCase();
}

/** Whether two remotes name the same repository. */
export function sameRemote(a: string, b: string): boolean {
  const left = remoteKey(a);
  return left !== null && left === remoteKey(b);
}
