/**
 * Running one program: the single place the activities start a child process (git, npm and
 * npx, Node scripts, FFmpeg, Playwright's installer, espeak-ng, the confined acceptance checks).
 *
 * What it hides: the spawn options (no shell, no window, no prompt on stdin), Windows' shell
 * for `.cmd` wrappers and its quoting, the time limit, the caller's abort signal, stopping the
 * program together with everything it started, and keeping only the end of its output. What
 * comes back is one outcome, whatever the program was:
 *
 * - `exited`: it ended on its own, with `code` (null when a signal not ours ended it);
 * - `not_found`: there is no such program (ENOENT, not on PATH for cmd.exe, or the exit codes
 *   a shell gives a command it could not find: sh's 127, cmd's 9009);
 * - `timed_out`: it ran past `timeoutMs` and was stopped;
 * - `stopped`: the caller's signal aborted, or `stop()` was called;
 * - `failed_to_start`: it could not be started for another reason (`error` says which).
 *
 * Never throws, and never rejects.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** How much of the end of each stream, and of both together, is kept unless a caller says. */
export const PROGRAM_OUTPUT_MAX = 64 * 1024;

/** How long a stopped program has to exit on SIGTERM before it, and its group, are killed. */
const KILL_GRACE_MS = 10_000;

/** A line longer than this is handed on as it is rather than held for its newline. */
const LINE_MAX = 64 * 1024;

/** Exit codes that mean the program was not there: sh's 127, cmd's 9009. */
const NOT_FOUND_CODES = new Set([127, 9009]);

/** On POSIX each program leads its own process group, so the whole group can be signalled. */
const PROCESS_GROUPS = process.platform !== "win32";

export type ProgramStream = "stdout" | "stderr";

export type ProgramOutcome = "exited" | "not_found" | "timed_out" | "stopped" | "failed_to_start";

export interface ProgramSpec {
  command: string;
  args?: readonly string[];
  cwd?: string;
  /** The program's whole environment; absent, this process's. */
  env?: NodeJS.ProcessEnv;
  /**
   * The command is a `.cmd` wrapper on Windows (npm, npx), which only cmd.exe can run: there
   * it goes through cmd.exe with its arguments quoted for it. Ignored elsewhere.
   */
  windowsShell?: boolean;
  timeoutMs: number;
  /** Aborting it stops the program and everything it started. */
  signal?: AbortSignal;
  /** Written to stdin, which is then closed. */
  input?: string | Uint8Array;
  /** Keeps stdin open for `write` and `endInput`. */
  holdInput?: boolean;
  /** How many characters of the end of each stream, and of both together, are kept. */
  outputMax?: number;
  /** `bytes`: stdout is kept whole, as bytes, in `stdoutBytes`, and is not part of `output`. */
  stdout?: "text" | "bytes";
  /** Each line of text output as it is completed; a last line without a newline at the end. */
  onLine?: (line: string, stream: ProgramStream) => void;
  /**
   * A Node program's IPC channel: `message` is sent to it once it has started, and each message
   * it sends back is handed to `onMessage`, before its outcome is.
   */
  ipc?: { message: unknown; onMessage: (message: unknown) => void };
}

/** What a program printed: the end of each stream, and of both as they interleaved. */
export interface ProgramOutput {
  stdout: string;
  stderr: string;
  /** Both streams in the order they arrived, at most `outputMax` characters of the end. */
  output: string;
  /** How many characters of `output` were dropped from its front. */
  omitted: number;
}

export interface ProgramResult extends ProgramOutput {
  outcome: ProgramOutcome;
  /** The exit code, when there was one: an `exited` program's, or `not_found`'s 127 / 9009. */
  code: number | null;
  /** Why it did not start (`not_found` from the spawn, `failed_to_start`). */
  error?: string;
  /** All of stdout, when the spec asked for `bytes`. */
  stdoutBytes?: Buffer;
}

export interface RunningProgram {
  /** True once the program is running; false when it never started (the result says why). */
  readonly started: Promise<boolean>;
  readonly result: Promise<ProgramResult>;
  /**
   * Writes to stdin (`holdInput`), waiting while its pipe is full. False once the program no
   * longer reads it.
   */
  write(chunk: string | Uint8Array): Promise<boolean>;
  /** Closes stdin. */
  endInput(): void;
  /** Stops the program and everything it started; the outcome is `stopped`. */
  stop(): void;
  /** What it has printed so far. */
  output(): ProgramOutput;
}

/**
 * Keeps the *end* of a log when there is too much of it, saying how much went before.
 *
 * The error is at the end. Truncating from the end would throw away the only part anyone
 * reads, which is what makes a log useless rather than merely long. `omitted` counts what was
 * already dropped before `log`.
 */
export function clampLog(log: string, max: number, omitted = 0): string {
  if (log.length <= max && omitted === 0) return log;
  const dropped = omitted + Math.max(0, log.length - max);
  return `… ${dropped} earlier characters omitted …\n${log.slice(-max)}`;
}

/** Runs a program to the end. */
export function runProgram(spec: ProgramSpec): Promise<ProgramResult> {
  return startProgram(spec).result;
}

/** Starts a program; its `result` settles when it has ended and its output is complete. */
export function startProgram(spec: ProgramSpec): RunningProgram {
  const tail = new OutputTail(spec.outputMax ?? PROGRAM_OUTPUT_MAX);
  const bytes: Buffer[] = [];
  const lines = spec.onLine
    ? {
        stdout: new LineSplitter("stdout", spec.onLine),
        stderr: new LineSplitter("stderr", spec.onLine),
      }
    : null;
  let child: ChildProcess | null = null;
  let spawned = false;
  let settled = false;
  let ending: "timed_out" | "stopped" | null = null;
  let timer: NodeJS.Timeout | undefined;
  let markStarted!: (started: boolean) => void;
  let settle!: (result: ProgramResult) => void;
  const started = new Promise<boolean>((resolve) => (markStarted = resolve));
  const result = new Promise<ProgramResult>((resolve) => (settle = resolve));

  const stop = (why: "timed_out" | "stopped") => {
    if (settled || ending) return;
    ending = why;
    if (child) stopTree(child);
  };
  const onAbort = () => stop("stopped");

  function finish(outcome: ProgramOutcome, code: number | null, error?: string) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    spec.signal?.removeEventListener("abort", onAbort);
    if (child) live.delete(child);
    lines?.stdout.flush();
    lines?.stderr.flush();
    markStarted(spawned);
    settle({
      outcome,
      code,
      ...(error !== undefined ? { error } : {}),
      ...tail.snapshot(),
      ...(spec.stdout === "bytes" ? { stdoutBytes: Buffer.concat(bytes) } : {}),
    });
  }

  const handle: RunningProgram = {
    started,
    result,
    write: (chunk) =>
      new Promise<boolean>((done) => {
        const proc = child;
        const stdin = proc?.stdin;
        if (!proc || !stdin || stdin.destroyed || settled || proc.exitCode !== null) {
          done(false);
          return;
        }
        if (stdin.write(chunk)) {
          done(true);
          return;
        }
        // Full pipe: wait for room, unless the program exits first.
        const drained = () => {
          proc.off("close", closed);
          done(true);
        };
        const closed = () => {
          stdin.off("drain", drained);
          done(false);
        };
        stdin.once("drain", drained);
        proc.once("close", closed);
      }),
    endInput: () => child?.stdin?.end(),
    stop: () => stop("stopped"),
    output: () => tail.snapshot(),
  };

  if (spec.signal?.aborted) {
    finish("stopped", null);
    return handle;
  }

  // cmd.exe reports a command it cannot find with exit code 1, like any failure, so a
  // command meant for it is looked up first.
  if (spec.windowsShell && process.platform === "win32" && !onWindowsPath(spec)) {
    finish("not_found", null, `${spec.command} was not found on PATH.`);
    return handle;
  }
  const [file, args, verbatim] = commandLine(spec);
  const piped = spec.input !== undefined || spec.holdInput === true;
  let proc: ChildProcess;
  try {
    proc = spawn(file, args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: [piped ? "pipe" : "ignore", "pipe", "pipe", ...(spec.ipc ? ["ipc" as const] : [])],
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      detached: PROCESS_GROUPS,
    });
  } catch (error) {
    finish(startFailure(spec, error as NodeJS.ErrnoException), null, (error as Error).message);
    return handle;
  }
  child = proc;
  track(proc);

  for (const stream of ["stdout", "stderr"] as const) {
    const readable = proc[stream];
    if (!readable) continue;
    if (stream === "stdout" && spec.stdout === "bytes") {
      readable.on("data", (chunk: Buffer) => bytes.push(chunk));
      continue;
    }
    // Decoded by the stream, not per chunk: a character whose bytes land in two chunks
    // would otherwise come out as two replacement characters.
    readable.setEncoding("utf8");
    readable.on("data", (text: string) => {
      tail.add(stream, text);
      lines?.[stream].push(text);
    });
  }
  if (proc.stdin) {
    // A program that exits before reading its input closes the pipe; that is its exit's to
    // report, not an unhandled stream error.
    proc.stdin.on("error", () => {});
    if (spec.input !== undefined) proc.stdin.end(spec.input);
  }

  timer = setTimeout(() => stop("timed_out"), spec.timeoutMs);
  timer.unref();
  spec.signal?.addEventListener("abort", onAbort, { once: true });

  if (spec.ipc) {
    const { message, onMessage } = spec.ipc;
    proc.on("message", onMessage);
    // A program that exits before reading it closes the channel; its exit says so.
    proc.on("spawn", () => proc.send(message as never, () => {}));
  }
  proc.on("spawn", () => {
    spawned = true;
    markStarted(true);
  });
  proc.on("error", (error: NodeJS.ErrnoException) => {
    // After a start, an error (a failed kill) is followed by `close`, which reports the end.
    if (!spawned) finish(startFailure(spec, error), null, error.message);
  });
  proc.on("close", (code) => {
    if (ending) finish(ending, null);
    else if (code !== null && NOT_FOUND_CODES.has(code)) finish("not_found", code);
    else finish("exited", code);
  });
  return handle;
}

/** Why a spawn failed: no such program, unless it was the folder that was missing. */
function startFailure(spec: ProgramSpec, error: NodeJS.ErrnoException): ProgramOutcome {
  // Node reports a missing working folder as ENOENT too, which is not a missing program.
  if (error.code === "ENOENT" && (spec.cwd === undefined || existsSync(spec.cwd)))
    return "not_found";
  return "failed_to_start";
}

/** The file to spawn and its arguments, through cmd.exe for a Windows `.cmd` wrapper. */
function commandLine(spec: ProgramSpec): [string, string[], boolean] {
  const args = [...(spec.args ?? [])];
  if (!spec.windowsShell || process.platform !== "win32") return [spec.command, args, false];
  // With /s, cmd strips only the outer pair of quotes before running the rest as written.
  const line = [spec.command, ...args].map(quoteForCmd).join(" ");
  return [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], true];
}

/** Whether cmd.exe would find `spec.command`: in the working folder or on PATH, by PATHEXT. */
function onWindowsPath(spec: ProgramSpec): boolean {
  const env = spec.env ?? process.env;
  // A copied environment keeps Windows' spelling of its names (`Path`), but not their case
  // insensitivity.
  const read = (name: string) =>
    Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1] ?? "";
  const extensions = (read("PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const named = path.extname(spec.command) !== "" ? [""] : [];
  const candidates = [...named, ...extensions].map((ext) => spec.command + ext);
  const cwd = spec.cwd ?? process.cwd();
  if (/[\\/]/.test(spec.command))
    return candidates.some((file) => existsSync(path.resolve(cwd, file)));
  const dirs = [cwd, ...read("PATH").split(";").filter(Boolean)];
  return dirs.some((dir) => candidates.some((file) => existsSync(path.join(dir, file))));
}

/**
 * One token of a cmd.exe command line. A token with spaces, quotes or anything cmd would act
 * on (`&`, `|`, redirects) is quoted; cmd expands `%VARS%` even inside quotes, so each `%`
 * escapes as `^%` outside a fresh pair.
 */
function quoteForCmd(token: string): string {
  if (token !== "" && !/[\s"%&|<>^()]/.test(token)) return token;
  return `"${token.replaceAll('"', '""').replaceAll("%", '"^%"')}"`;
}

/**
 * Stops a program and everything it started.
 *
 * On Windows `npm` is a shell wrapper, so signalling the child kills the wrapper and leaves
 * webpack running: the process holds the workspace, `close` does not fire until the real
 * work finishes on its own, and a timeout that waits for it is not a timeout. There the tree
 * goes through `taskkill /T`; elsewhere the program leads its own process group, which a
 * negative pid reaches.
 */
function stopTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      // taskkill missing or refused: the program itself at least must not survive.
      killer.on("error", () => child.kill());
    } catch {
      child.kill();
    }
    return;
  }
  signalGroup(child, "SIGTERM");
  // A program ignoring SIGTERM would otherwise hold its workspace forever.
  setTimeout(() => signalGroup(child, "SIGKILL"), KILL_GRACE_MS).unref();
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, signal);
  } catch {
    // The group is gone, or the child never led one.
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
  }
}

/**
 * Programs still running. A program leading its own group no longer hears a terminal's
 * Ctrl-C, so the groups still running when this process exits are killed with it.
 */
const live = new Set<ChildProcess>();
let exitHooked = false;

function track(child: ChildProcess): void {
  if (!PROCESS_GROUPS) return;
  live.add(child);
  if (exitHooked) return;
  exitHooked = true;
  process.once("exit", () => {
    for (const left of live) signalGroup(left, "SIGKILL");
  });
}

/**
 * The end of a program's output, per stream and as the streams interleaved.
 *
 * Bounded as it arrives: a program looping on an error can print gigabytes, and the point of
 * keeping output is the end of it. Whole pieces fall off the front of a stream once the rest
 * of that stream still holds `max` characters, so a long log is not copied again with every
 * chunk. Nothing dropped from one stream can be within the last `max` characters of both
 * together, since `max` characters of that stream alone came after it.
 */
class OutputTail {
  private readonly pieces: Record<ProgramStream, { order: number; text: string }[]> = {
    stdout: [],
    stderr: [],
  };
  private readonly sizes: Record<ProgramStream, number> = { stdout: 0, stderr: 0 };
  private order = 0;
  private total = 0;

  constructor(private readonly max: number) {}

  add(stream: ProgramStream, text: string): void {
    if (text === "") return;
    const pieces = this.pieces[stream];
    pieces.push({ order: this.order++, text });
    this.sizes[stream] += text.length;
    this.total += text.length;
    while (pieces.length > 1 && this.sizes[stream] - pieces[0]!.text.length >= this.max)
      this.sizes[stream] -= pieces.shift()!.text.length;
  }

  snapshot(): ProgramOutput {
    const merged = [...this.pieces.stdout, ...this.pieces.stderr]
      .sort((a, b) => a.order - b.order)
      .map((piece) => piece.text)
      .join("")
      .slice(-this.max);
    return {
      stdout: this.stream("stdout"),
      stderr: this.stream("stderr"),
      output: merged,
      omitted: this.total - merged.length,
    };
  }

  private stream(stream: ProgramStream): string {
    return this.pieces[stream]
      .map((piece) => piece.text)
      .join("")
      .slice(-this.max);
  }
}

/** Splits one stream's text into lines as it arrives. */
class LineSplitter {
  private pending = "";

  constructor(
    private readonly stream: ProgramStream,
    private readonly emit: (line: string, stream: ProgramStream) => void,
  ) {}

  push(text: string): void {
    this.pending += text;
    let end: number;
    while ((end = this.pending.indexOf("\n")) !== -1) {
      this.emit(this.pending.slice(0, end).replace(/\r$/, ""), this.stream);
      this.pending = this.pending.slice(end + 1);
    }
    if (this.pending.length > LINE_MAX) this.flush();
  }

  flush(): void {
    if (this.pending !== "") this.emit(this.pending.replace(/\r$/, ""), this.stream);
    this.pending = "";
  }
}
