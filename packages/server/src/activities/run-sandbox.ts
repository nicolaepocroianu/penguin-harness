/**
 * The sandbox what an activity run's agent writes is run in: the agent's own commands, confined
 * to the run's workspace, and the server's builds of the module it wrote, confined to that
 * module. Unless an admin turned confinement off (System settings > WAF workspace), work that
 * nothing here can confine is refused before it starts rather than left to fail at its first
 * command.
 */
import type { SessionSandboxMode, SpawnConfiner } from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import type { Settings } from "../mechanisms/settings.js";
import type { Sandbox } from "../sandbox/service.js";

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

/**
 * How work a run's agent wrote is to run, decided as it is about to start: through the session
 * sandbox's confiner while activity agents are confined, or unconfined (null) once an admin
 * turned that off. Throws `sandboxUnavailable` when it is to be confined and nothing can.
 */
export function runConfinement(
  settings: Pick<Settings, "getConfineActivityAgents">,
  sandbox: Pick<Sandbox, "confinementProblem" | "confiner">,
): SpawnConfiner | null {
  if (!settings.getConfineActivityAgents()) return null;
  const problem = sandbox.confinementProblem(RUN_SANDBOX_MODE);
  if (problem !== null) throw sandboxUnavailable(problem);
  return sandbox.confiner();
}
