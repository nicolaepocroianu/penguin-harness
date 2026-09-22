/**
 * The runtime AI endpoint a previewed activity can call, and who is allowed to call it.
 *
 * Some WAF activities ask an AI service something while a learner is using them. Loom
 * serves that from its sandbox by spawning a child process per request, one at a time,
 * streaming events back. Penguin has agent Sessions for exactly that, so the execution is
 * not what needs porting — the admission rules are.
 *
 * They are the interesting half anyway. This endpoint is reachable from inside a preview,
 * which means it is reachable from module code an agent generated. Deciding what it will
 * refuse is a security question, not a plumbing one.
 */

/** How long a prompt from inside a preview may be. */
export const RUNTIME_PROMPT_MAX = 4_000;

export type AdmissionRefusal =
  /** Another run is already going for this preview. */
  | { kind: "busy"; message: string }
  /** The prompt is empty, too long, or not a string. */
  | { kind: "prompt_invalid"; message: string }
  /** This activity has not declared that it uses a runtime AI service. */
  | { kind: "not_declared"; message: string }
  /** The preview is not in a state where its module could be asking anything. */
  | { kind: "not_playable"; message: string };

export interface AdmissionState {
  /** Whether a runtime AI call is already in progress for this preview. */
  busy: boolean;
  /** Whether the activity's specification says it uses an AI service at runtime. */
  declared: boolean;
  /** Whether the preview is playable at all. */
  playable: boolean;
}

/**
 * Whether a runtime AI call is allowed, or why not.
 *
 * Checked in this order deliberately. `not_declared` comes before `busy` because an
 * activity that never declared the capability is not waiting for a turn — it is asking for
 * something it has no business asking for, and telling it to try again later would be a
 * lie that hides a generated module calling an endpoint nobody granted it.
 */
export function admitRuntimeAi(state: AdmissionState, prompt: unknown): AdmissionRefusal | null {
  if (!state.playable)
    return {
      kind: "not_playable",
      message: "This activity has no playable preview, so nothing in it can be asking.",
    };
  if (!state.declared)
    return {
      kind: "not_declared",
      message:
        "This activity does not declare a runtime AI service, so the preview will not call one on its behalf.",
    };
  if (typeof prompt !== "string" || !prompt.trim())
    return { kind: "prompt_invalid", message: "A runtime AI call needs a prompt." };
  if (prompt.length > RUNTIME_PROMPT_MAX)
    return {
      kind: "prompt_invalid",
      message: `A runtime AI prompt may be at most ${RUNTIME_PROMPT_MAX} characters; this one is ${prompt.length}.`,
    };
  if (state.busy)
    return {
      kind: "busy",
      message: "A runtime AI call is already in progress for this preview.",
    };
  return null;
}

/** The HTTP status each refusal deserves. */
export function refusalStatus(refusal: AdmissionRefusal): number {
  switch (refusal.kind) {
    case "busy":
      return 409;
    case "prompt_invalid":
      return 400;
    case "not_declared":
      // Forbidden rather than not-found: the endpoint exists, this activity may not use it.
      return 403;
    case "not_playable":
      return 409;
  }
}

/**
 * Whether a specification declares a runtime AI service.
 *
 * Read off the saved specification rather than configured per preview, so the answer is
 * the same for an author previewing and for the activity once it ships. A capability the
 * preview grants and production does not is a preview that lies.
 */
export function declaresRuntimeAi(spec: Record<string, unknown> | null): boolean {
  const runtime = spec?.["runtime"];
  if (!runtime || typeof runtime !== "object") return false;
  return (runtime as Record<string, unknown>)["usesAiService"] === true;
}
