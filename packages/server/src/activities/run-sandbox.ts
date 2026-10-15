/**
 * The sandbox what an activity run's agent writes is run in: the agent's own commands, confined
 * to the run's workspace, and the server's builds of the module it wrote, confined to that
 * module. Unless an admin turned confinement off (System settings > WAF workspace), work that
 * nothing here can confine is refused before it starts rather than left to fail at its first
 * command.
 */
import type { SessionSandboxMode } from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";

/** The confinement an activity run's agent, and a build of its module, work under. */
export const RUN_SANDBOX_MODE: SessionSandboxMode = "workspace-write";

/** The refusal of a run, or of a build of what one wrote, that nothing can confine. */
export function sandboxUnavailable(problem: string): HttpError {
  return new HttpError(
    409,
    "sandbox_unavailable",
    "Activity runs need a sandbox so the WAF checkout stays read-only. Enable a " +
      "sandbox plugin for this project on the Plugins page (sandbox-dsh works on " +
      `Windows, macOS and Linux), then try again. (${problem})`,
  );
}
