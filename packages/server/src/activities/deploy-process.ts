/**
 * The programs a deploy runs besides git (npm, npx): started without a prompt, their output
 * streamed to the deploy's log line by line as it arrives, bounded, stopped at a time limit or
 * when the engineer presses Stop — and with them everything they started (`run-program.ts`).
 *
 * Tests replace the port with a fake.
 */
import { runProgram, type ProgramConfiner } from "./run-program.js";

/** How long one program may run unless the caller says otherwise. */
export const PROCESS_TIMEOUT_MS = 20 * 60 * 1000;

/** How much of a program's output is kept for the failure it reports: the end. */
export const PROCESS_TAIL_MAX = 8 * 1024;

export interface DeployProcessOptions {
  cwd: string;
  timeoutMs?: number;
  /** Aborting it stops the program and everything it started. */
  signal?: AbortSignal;
  /** The output as it arrives; the real port hands it on a whole line at a time. */
  onOutput?: (text: string) => void;
  /** Whether the program goes through the shell; on Windows by default, for npm and npx. */
  shell?: boolean;
  /** The program's whole environment; absent, this process's with git told never to prompt. */
  env?: NodeJS.ProcessEnv;
  /** The program runs confined (see `ProgramSpec.confine`); one it refuses does not start. */
  confine?: ProgramConfiner;
}

export interface DeployProcessResult {
  /** The exit code; null when the program did not exit on its own. */
  code: number | null;
  /** The end of its output, both streams. */
  tail: string;
  error?: "not_found" | "timed_out" | "stopped" | "not_started";
}

/** Runs one program. Never throws. */
export interface DeployProcess {
  run(command: string, args: string[], options: DeployProcessOptions): Promise<DeployProcessResult>;
}

/**
 * The real port. On Windows npm and npx are shell wrappers, so they go through the shell
 * unless the caller says otherwise (a program named by its path, whose arguments the shell
 * would split at their spaces).
 */
export const spawnDeployProcess: DeployProcess = {
  async run(command, args, options) {
    const result = await runProgram({
      command,
      args,
      cwd: options.cwd,
      env: options.env ?? { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      windowsShell: options.shell ?? true,
      ...(options.confine ? { confine: options.confine } : {}),
      timeoutMs: options.timeoutMs ?? PROCESS_TIMEOUT_MS,
      signal: options.signal,
      outputMax: PROCESS_TAIL_MAX,
      onLine: options.onOutput ? (line) => options.onOutput!(`${line}\n`) : undefined,
    });
    const { code, output: tail } = result;
    switch (result.outcome) {
      case "exited":
        return { code, tail };
      case "not_found":
        return { code, tail, error: "not_found" };
      case "failed_to_start":
        return { code: null, tail, error: "not_started" };
      default:
        return { code: null, tail, error: result.outcome };
    }
  },
};
