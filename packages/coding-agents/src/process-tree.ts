/**
 * Stop an agent and everything it started. An agent CLI is rarely one process: npm shims,
 * adapters over an SDK, and the shells a turn runs all hang below it, and killing only the
 * top pid leaves the rest holding the workspace. Windows has no process groups, so the tree
 * goes through `taskkill /T`; elsewhere the agent was spawned `detached` and leads its own
 * group, which a negative pid reaches.
 */
import { spawn, type ChildProcess } from "node:child_process";

export function killProcessTree(proc: ChildProcess): void {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    // taskkill missing or refused: the top process at least must not survive.
    killer.on("error", () => proc.kill());
    return;
  }
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    // The group is already gone; fall back to the process itself in case it never led one.
    try {
      proc.kill("SIGKILL");
    } catch {
      // Already exited.
    }
  }
}
