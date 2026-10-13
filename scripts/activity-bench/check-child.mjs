// Runs one check file against a played module with the evaluator's frozen harness and runner,
// all served from memory by check-hooks.mjs. The payload comes over IPC, never through the
// environment or the command line; the runner's results go back the same way.
import { register } from "node:module";

process.once("message", async (payload) => {
  let failure = null;
  try {
    register(new URL("./check-hooks.mjs", import.meta.url), { data: payload });
    await import(`${payload.base}run-acceptance.mjs`);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  // Sent after the results the runner posted, so the parent has both before the exit.
  process.send({ type: "done", failure }, () => process.exit(failure ? 1 : 0));
});
