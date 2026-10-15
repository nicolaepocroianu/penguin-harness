/**
 * A conversation about the activity, focused on what the author has open. The reply is the
 * result, and it is in the Session; a proposal the agent writes is read from the workspace.
 */
import { assistPrompt } from "../assist.js";
import type { AssistRun } from "../domain.js";
import type { RunRequestOf } from "../run-request.js";
import { DOCUMENT_RUN_MS, type SessionRunKind } from "./contract.js";

type AssistRequest = RunRequestOf<"assist">["assist"];

export const assistKind: SessionRunKind<RunRequestOf<"assist">, AssistRequest, AssistRun> = {
  run: "assist",
  runner: "session",
  // An author may ask for help writing the script, so an empty one is no reason to refuse.
  needsScript: false,
  // The run is the first reply, which may propose a whole specification; the conversation
  // goes on after it with no limit of the run's.
  limits: { wallClockMs: DOCUMENT_RUN_MS },
  check: async (_services, request) => request.assist,
  record: ({ focus }) => ({ assist: { focus } }),
  stage: async () => undefined,
  prompt: ({ prepared }) => assistPrompt(prepared.message, prepared.focus),
  outputs: [],
  async collect({ observed }) {
    return observed?.completed
      ? { settled: "succeeded" }
      : { settled: "failed", error: observed?.error ?? "The agent did not reply." };
  },
};
