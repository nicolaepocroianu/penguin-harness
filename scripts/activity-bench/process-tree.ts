/**
 * Starting and stopping a process with everything it started: the bench's servers and check
 * runners leave no process behind, so nothing graded outlives its block.
 */
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

const WINDOWS = process.platform === "win32";

/** Spawns a process that can be stopped with its descendants: its own group off Windows. */
export function spawnTree(command: string, args: string[], options: SpawnOptions): ChildProcess {
  return spawn(command, args, { ...options, detached: !WINDOWS, windowsHide: true });
}

/** Stops a process and every process it started; never throws. */
export function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  if (WINDOWS) {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  return Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 15_000))]);
}

/** The environment a child gets: the system plumbing only, never this process's secrets. */
export function plainEnv(extra: Record<string, string> = {}): Record<string, string> {
  const keep =
    /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)$/i;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && keep.test(key)) env[key] = value;
  return { ...env, ...extra };
}
