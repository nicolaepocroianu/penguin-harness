/**
 * Which FFmpeg this server runs, and running it.
 *
 * Penguin ships FFmpeg through the `ffmpeg-static` package (an optional dependency: its
 * install script downloads the binary for this platform; GPL, run as a separate program and
 * never linked). The one to run is, in order:
 *
 * 1. `PENGUIN_FFMPEG_PATH`, when an admin points at a build of their own;
 * 2. the bundled binary, resolved at run time from `ffmpeg-static` — the desktop app stages
 *    that package beside its server bundle (packages/desktop/scripts/build-assets.mjs), so the
 *    same lookup finds it there;
 * 3. `ffmpeg` on PATH.
 *
 * A missing FFmpeg is reported (503 `ffmpeg_missing`), never worked around.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { HttpError } from "../http/errors.js";

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
  return env.PENGUIN_FFMPEG_PATH?.trim() || bundledFfmpeg() || "ffmpeg";
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
  /** Stops FFmpeg; `finish` then rejects. */
  kill(): void;
  /** What FFmpeg has written to stderr so far, at most `stderrLimit` characters of its end. */
  stderr(): string;
}

/**
 * Starts FFmpeg with `args` (never through a shell), its stdin open for `write`. Rejects with
 * 503 `ffmpeg_missing` when there is no FFmpeg to start; `timeoutMs` bounds the whole run.
 */
export function startFfmpeg(
  args: string[],
  options: {
    purpose: string;
    timeoutMs: number;
    executable?: string;
    /** How much of the end of stderr is kept; 4 000 characters unless a caller reads it all. */
    stderrLimit?: number;
  },
): Promise<FfmpegRun> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(options.executable ?? ffmpegPath(), args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      reject(ffmpegMissing(options.purpose, error));
      return;
    }
    const out: Buffer[] = [];
    // The end of stderr, in the chunks it came in: whole chunks fall off the front once the
    // rest still holds the limit, so a long report is not copied again with every chunk.
    const limit = options.stderrLimit ?? 4000;
    const errChunks: string[] = [];
    let errLength = 0;
    const err = () => errChunks.join("").slice(-limit);
    let started = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      errChunks.push(text);
      errLength += text.length;
      while (errChunks.length > 1 && errLength - errChunks[0]!.length >= limit)
        errLength -= errChunks.shift()!.length;
    });
    // A closed pipe after FFmpeg failed is reported by its exit, not here.
    child.stdin.on("error", () => {});
    const exited = new Promise<number | null>((settle, fail) => {
      child.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        const missing = error.code === "ENOENT" ? ffmpegMissing(options.purpose, error) : error;
        if (!started) reject(missing);
        fail(missing);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        settle(code);
      });
    });
    // Swallowed here; `finish` reports it.
    exited.catch(() => {});
    child.on("spawn", () => {
      started = true;
      resolve({
        write: (chunk) =>
          new Promise<void>((done, fail) => {
            if (child.stdin.destroyed || child.exitCode !== null) {
              fail(new FfmpegError("ffmpeg stopped reading its input.", err().trim()));
              return;
            }
            if (child.stdin.write(chunk)) {
              done();
              return;
            }
            // Full pipe: wait for room, unless FFmpeg exits first.
            const drained = () => {
              child.off("close", closed);
              done();
            };
            const closed = () => {
              child.stdin.off("drain", drained);
              fail(new FfmpegError("ffmpeg stopped reading its input.", err().trim()));
            };
            child.stdin.once("drain", drained);
            child.once("close", closed);
          }),
        finish: async () => {
          child.stdin.end();
          const code = await exited;
          if (timedOut)
            throw new FfmpegError(`ffmpeg took longer than ${options.timeoutMs} ms.`, err().trim());
          if (code !== 0)
            throw new FfmpegError(
              err().trim() || `ffmpeg exited with ${code ?? "a signal"}`,
              err().trim(),
            );
          return Buffer.concat(out);
        },
        kill: () => child.kill(),
        stderr: err,
      });
    });
  });
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
