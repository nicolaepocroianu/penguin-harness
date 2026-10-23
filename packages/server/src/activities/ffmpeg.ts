/**
 * Which FFmpeg this server runs, and running it.
 *
 * WAF Harness ships FFmpeg through the `ffmpeg-static` package (an optional dependency: its
 * install script downloads the binary for this platform; GPL, run as a separate program and
 * never linked). The one to run is, in order:
 *
 * 1. `WAFH_FFMPEG_PATH`, when an admin points at a build of their own;
 * 2. the bundled binary, resolved at run time from `ffmpeg-static` — the desktop app stages
 *    that package beside its server bundle (packages/desktop/scripts/build-assets.mjs), so the
 *    same lookup finds it there;
 * 3. `ffmpeg` on PATH.
 *
 * A missing FFmpeg is reported (503 `ffmpeg_missing`), never worked around.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { HttpError } from "../http/errors.js";
import { startProgram } from "./run-program.js";

let bundled: string | null | undefined;

/** The bundled FFmpeg's path, or null when the package or its binary is not installed. */
function bundledFfmpeg(): string | null {
  if (bundled !== undefined) return bundled;
  try {
    const found = createRequire(import.meta.url)("ffmpeg-static") as unknown;
    bundled = typeof found === "string" && fs.existsSync(found) ? found : null;
  } catch {
    bundled = null;
  }
  return bundled;
}

/** The FFmpeg executable to run: the admin's, the bundled one, or `ffmpeg` from PATH. */
export function ffmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.WAFH_FFMPEG_PATH?.trim() || bundledFfmpeg() || "ffmpeg";
}

/** Why FFmpeg could not be run at all, worded for what it was needed for. */
export function ffmpegMissing(purpose: string, cause: unknown): HttpError {
  return new HttpError(
    503,
    "ffmpeg_missing",
    `ffmpeg is needed ${purpose}, and it could not be run: ${(cause as Error).message}`,
  );
}

/** An FFmpeg run that started but did not finish well. */
export class FfmpegError extends Error {
  constructor(
    message: string,
    /** The end of what FFmpeg wrote to stderr. */
    readonly stderr: string,
  ) {
    super(message);
  }
}

export interface FfmpegRun {
  /** Writes to FFmpeg's stdin, waiting while its pipe is full. */
  write(chunk: Uint8Array): Promise<void>;
  /** Closes stdin and waits for FFmpeg to exit; answers stdout. Rejects unless it exited 0. */
  finish(): Promise<Buffer>;
  /** Stops FFmpeg and anything it started; `finish` then rejects. */
  kill(): void;
  /** What FFmpeg has written to stderr so far, at most `stderrLimit` characters of its end. */
  stderr(): string;
}

/**
 * Starts FFmpeg with `args` (never through a shell), its stdin open for `write`. Rejects with
 * 503 `ffmpeg_missing` when there is no FFmpeg to start; `timeoutMs` bounds the whole run, and
 * a run past it is stopped together with anything it started.
 */
export async function startFfmpeg(
  args: string[],
  options: {
    purpose: string;
    timeoutMs: number;
    executable?: string;
    /** How much of the end of stderr is kept; 4 000 characters unless a caller reads it all. */
    stderrLimit?: number;
  },
): Promise<FfmpegRun> {
  const run = startProgram({
    command: options.executable ?? ffmpegPath(),
    args,
    timeoutMs: options.timeoutMs,
    holdInput: true,
    stdout: "bytes",
    outputMax: options.stderrLimit ?? 4000,
  });
  if (!(await run.started)) {
    const failed = await run.result;
    throw ffmpegMissing(options.purpose, new Error(failed.error ?? failed.outcome));
  }
  const err = () => run.output().stderr;
  return {
    write: async (chunk) => {
      if (!(await run.write(chunk)))
        throw new FfmpegError("ffmpeg stopped reading its input.", err().trim());
    },
    finish: async () => {
      run.endInput();
      const result = await run.result;
      if (result.outcome === "timed_out")
        throw new FfmpegError(`ffmpeg took longer than ${options.timeoutMs} ms.`, err().trim());
      if (result.outcome !== "exited" || result.code !== 0)
        throw new FfmpegError(
          err().trim() || `ffmpeg exited with ${result.code ?? "a signal"}`,
          err().trim(),
        );
      return result.stdoutBytes ?? Buffer.alloc(0);
    },
    kill: () => run.stop(),
    stderr: err,
  };
}

/** Runs FFmpeg once on `input` (or nothing) and answers its stdout. */
export async function runFfmpeg(
  args: string[],
  options: { purpose: string; timeoutMs: number; input?: Uint8Array; executable?: string },
): Promise<Buffer> {
  const run = await startFfmpeg(args, options);
  if (options.input) await run.write(options.input).catch(() => {});
  return run.finish();
}

/**
 * Runs FFmpeg for what it reports rather than what it writes: an analysis (`-f null -`) whose
 * findings are on stderr. Answers all of stderr, up to 32 MB: the check's brightness of every
 * frame takes about 130 characters a frame, and the report's head (length, size) must survive.
 */
export async function ffmpegReport(
  args: string[],
  options: { purpose: string; timeoutMs: number; executable?: string },
): Promise<string> {
  const run = await startFfmpeg(args, { ...options, stderrLimit: 32_000_000 });
  await run.finish();
  return run.stderr();
}
