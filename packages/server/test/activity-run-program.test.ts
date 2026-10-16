/**
 * Running a program through the one module every activity child process goes through. Real
 * child processes (this Node, with `-e` scripts) prove the outcome taxonomy, the time limit,
 * the abort signal, the tree kill, the bounded output, line streaming and input, on whatever
 * platform the suite runs on.
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampLog,
  runProgram,
  startProgram,
  type ProgramSpec,
} from "../src/activities/run-program.js";

/** This Node running `script`. */
function node(script: string, spec: Partial<ProgramSpec> = {}): ProgramSpec {
  return { command: process.execPath, args: ["-e", script], timeoutMs: 20_000, ...spec };
}

/** Whether a process is still there. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Waits until a process is gone; false if it is still there after `ms`. */
async function gone(pid: number, ms = 10_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive(pid);
}

/**
 * A program that starts a grandchild (holding none of its pipes, so only a tree kill reaches
 * it), prints the grandchild's pid, and then never ends.
 *
 * On Windows the grandchild is detached: Node puts the children it starts in a job that dies
 * with it, which would kill the grandchild with its parent and hide a missing tree kill. A
 * program that is not Node (cmd.exe running npm.cmd) has no such job.
 */
const PARENT_OF_GRANDCHILD = `
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
  stdio: "ignore",
  detached: process.platform === "win32",
});
console.log("grandchild " + grandchild.pid);
setInterval(() => {}, 1000);
`;

/** Starts PARENT_OF_GRANDCHILD and answers the running program and its grandchild's pid. */
async function withGrandchild(spec: Partial<ProgramSpec> = {}) {
  let found: (pid: number) => void;
  const pid = new Promise<number>((resolve) => (found = resolve));
  const run = startProgram(
    node(PARENT_OF_GRANDCHILD, {
      ...spec,
      onLine: (line) => {
        const match = /^grandchild (\d+)$/.exec(line);
        if (match) found(Number(match[1]));
      },
    }),
  );
  return { run, grandchild: await pid };
}

describe("a program's outcome", () => {
  it("reports an exit with its code and what each stream printed", async () => {
    const result = await runProgram(
      node('console.log("to stdout"); console.error("to stderr"); process.exit(3);'),
    );
    expect(result.outcome).toBe("exited");
    expect(result.code).toBe(3);
    expect(result.stdout.trim()).toBe("to stdout");
    expect(result.stderr.trim()).toBe("to stderr");
    expect(result.output).toContain("to stdout");
    expect(result.output).toContain("to stderr");
    expect(result.omitted).toBe(0);
  });

  it("reports a clean exit as code 0", async () => {
    const result = await runProgram(node(""));
    expect(result).toMatchObject({ outcome: "exited", code: 0 });
  });

  it("recognises a missing program, started directly or through the Windows shell", async () => {
    const missing = "penguin-no-such-program-here";
    const direct = await runProgram({ command: missing, timeoutMs: 10_000 });
    expect(direct.outcome).toBe("not_found");
    expect(direct.error).toContain("ENOENT");
    // cmd.exe exits 1 for a command it cannot find, as for any failure; it is looked up first.
    const shelled = await runProgram({ command: missing, windowsShell: true, timeoutMs: 10_000 });
    expect(shelled.outcome).toBe("not_found");
  });

  it("treats a shell's codes for a command it could not find as not found", async () => {
    // sh's 127; cmd's 9009, which a .cmd wrapper such as npm exits with when its node is
    // missing (only Windows has exit codes past 255).
    for (const code of process.platform === "win32" ? [127, 9009] : [127]) {
      const result = await runProgram(node(`process.exit(${code})`));
      expect(result).toMatchObject({ outcome: "not_found", code });
    }
  });

  it("does not mistake a missing working folder for a missing program", async () => {
    const result = await runProgram(
      node("", { cwd: path.join(os.tmpdir(), "penguin-no-such-folder-here") }),
    );
    expect(result.outcome).toBe("failed_to_start");
  });
});

describe("stopping a program", () => {
  it("stops a program that runs past its time limit", async () => {
    const started = Date.now();
    const result = await runProgram(node("setInterval(() => {}, 1000);", { timeoutMs: 300 }));
    expect(result).toMatchObject({ outcome: "timed_out", code: null });
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("stops a program when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const running = runProgram(
      node('console.log("working"); setInterval(() => {}, 1000);', {
        signal: controller.signal,
        onLine: () => controller.abort(),
      }),
    );
    const result = await running;
    expect(result.outcome).toBe("stopped");
    expect(result.stdout).toContain("working");
  });

  it("does not start a program whose signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = startProgram(node("", { signal: controller.signal }));
    expect(await run.started).toBe(false);
    expect((await run.result).outcome).toBe("stopped");
  });

  it("kills what a timed-out program started, not only the program", async () => {
    const { run, grandchild } = await withGrandchild({ timeoutMs: 1_500 });
    expect(alive(grandchild)).toBe(true);
    expect((await run.result).outcome).toBe("timed_out");
    expect(await gone(grandchild)).toBe(true);
  });

  it("kills what a stopped program started, not only the program", async () => {
    const { run, grandchild } = await withGrandchild();
    run.stop();
    expect((await run.result).outcome).toBe("stopped");
    expect(await gone(grandchild)).toBe(true);
  });
});

describe("a program's output", () => {
  it("keeps the end of each stream, where the error is", async () => {
    const result = await runProgram(
      node('process.stdout.write("x".repeat(200000)); process.stdout.write("THE END");', {
        outputMax: 1000,
      }),
    );
    expect(result.stdout.length).toBe(1000);
    expect(result.stdout.endsWith("THE END")).toBe(true);
    expect(result.output.length).toBe(1000);
    expect(result.omitted).toBe(200_000 + "THE END".length - 1000);
  });

  it("keeps a quiet stream's end while the other is chatty", async () => {
    const result = await runProgram(
      node('console.error("fatal: the real problem"); process.stdout.write("x".repeat(200000));', {
        outputMax: 1000,
      }),
    );
    expect(result.stderr.trim()).toBe("fatal: the real problem");
    expect(result.stdout.length).toBe(1000);
  });

  it("hands on each line as it is completed, per stream", async () => {
    const lines: string[] = [];
    await runProgram(
      node(
        'process.stdout.write("one\\ntwo\\r\\nthr"); setTimeout(() => { process.stdout.write("ee"); console.error("on stderr"); }, 50);',
        { onLine: (line, stream) => lines.push(`${stream}:${line}`) },
      ),
    );
    expect(lines.filter((line) => line.startsWith("stdout:"))).toEqual([
      "stdout:one",
      "stdout:two",
      "stdout:three",
    ]);
    expect(lines).toContain("stderr:on stderr");
  });

  it("keeps stdout as bytes when asked, apart from the text output", async () => {
    const result = await runProgram(
      node('process.stdout.write(Buffer.from([0, 1, 2, 255])); console.error("note");', {
        stdout: "bytes",
      }),
    );
    expect([...result.stdoutBytes!]).toEqual([0, 1, 2, 255]);
    expect(result.stdout).toBe("");
    expect(result.output.trim()).toBe("note");
  });

  it("says how much of a long log went before the end it keeps", () => {
    expect(clampLog("short", 30)).toBe("short");
    const log = `${"a".repeat(100)}ERROR: the real problem`;
    const clamped = clampLog(log, 30);
    expect(clamped).toContain("ERROR: the real problem");
    expect(clamped).toContain(`${log.length - 30} earlier characters omitted`);
    expect(clampLog("tail", 30, 500)).toContain("500 earlier characters omitted");
  });
});

describe("a program's input", () => {
  it("writes the input to stdin and closes it", async () => {
    const result = await runProgram(
      node("process.stdin.pipe(process.stdout);", { input: "from stdin" }),
    );
    expect(result.stdout).toBe("from stdin");
  });

  it("streams input written while it runs", async () => {
    const run = startProgram(node("process.stdin.pipe(process.stdout);", { holdInput: true }));
    expect(await run.started).toBe(true);
    expect(await run.write("first ")).toBe(true);
    expect(await run.write("second")).toBe(true);
    run.endInput();
    expect((await run.result).stdout).toBe("first second");
    expect(await run.write("late")).toBe(false);
  });
});

describe("a Node program's IPC channel", () => {
  it("sends it a message and hands on what it sends back before its outcome", async () => {
    const received: unknown[] = [];
    const result = await runProgram(
      node(
        'process.once("message", (m) => process.send({ echo: m }, () => process.send("bye", () => process.exit(0))));',
        { ipc: { message: { hello: "there" }, onMessage: (message) => received.push(message) } },
      ),
    );
    expect(result).toMatchObject({ outcome: "exited", code: 0 });
    expect(received).toEqual([{ echo: { hello: "there" } }, "bye"]);
  });
});

describe("arguments through the Windows shell", () => {
  it("reach the program as they were given", async () => {
    const args = ["plain", "with space", 'say "hi"', "100%", "a&b", "(paren)"];
    const result = await runProgram({
      command: process.execPath,
      args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", ...args],
      windowsShell: true,
      timeoutMs: 20_000,
    });
    expect(result.outcome).toBe("exited");
    expect(JSON.parse(result.stdout)).toEqual(args);
  });
});

describe("a confined program", () => {
  it("is started as its confiner rewrote it", async () => {
    const asked: (readonly string[])[] = [];
    const result = await runProgram(
      node("console.log('as given')", {
        confine: (argv) => {
          asked.push(argv);
          return [process.execPath, "-e", "console.log('as confined')"];
        },
      }),
    );
    expect(asked).toEqual([[process.execPath, "-e", "console.log('as given')"]]);
    expect(result).toMatchObject({ outcome: "exited", code: 0, stdout: "as confined\n" });
  });

  it("does not start when its confiner refuses, and says why", async () => {
    const result = await runProgram(
      node("console.log('ran')", {
        confine: () => {
          throw new Error("no sandbox backend is mounted");
        },
      }),
    );
    expect(result).toMatchObject({
      outcome: "failed_to_start",
      error: "no sandbox backend is mounted",
      output: "",
    });
  });

  it("reaches the Windows shell through its confiner, given a line cmd.exe runs as written", async () => {
    const asked: (readonly string[])[] = [];
    const spec = (args: string[]): ProgramSpec => ({
      command: "npm",
      args,
      windowsShell: true,
      timeoutMs: 60_000,
      confine: (argv) => (asked.push(argv), argv),
    });
    const plain = await runProgram(spec(["--version"]));
    expect(plain).toMatchObject({ outcome: "exited", code: 0 });
    const quoted = await runProgram(spec(["--version", "with space"]));
    if (process.platform === "win32") {
      expect(asked[0]).toEqual([
        process.env.ComSpec || "cmd.exe",
        "/d",
        "/s",
        "/c",
        "npm --version",
      ]);
      // A runner's own quoting of the line is not cmd's: refused rather than run as mangled.
      expect(quoted).toMatchObject({ outcome: "failed_to_start" });
      expect(quoted.error).toContain("cannot run confined");
    } else {
      expect(asked[0]).toEqual(["npm", "--version"]);
      expect(quoted.outcome).toBe("exited");
    }
  });
});
