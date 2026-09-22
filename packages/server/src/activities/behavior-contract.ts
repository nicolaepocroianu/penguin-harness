/**
 * What an implementation run must leave behind, and what to say when it did not.
 *
 * `implement_behavior` is the heaviest stage in the pipeline: an agent writes the module's
 * real behaviour, and then a second pass reviews it. Two agent passes over generated code
 * is a lot of trust, so what makes it checkable is a contract — the files that must exist
 * when it finishes, which differ by path and by layout.
 *
 * The three path lists are Loom's, read out of `implement_behavior.py`. The checking is the
 * part worth having here: Loom asserts these paths exist, and the useful version names
 * every one that does not rather than stopping at the first.
 */
import type { BehaviorPath } from "./behavior-path.js";

/** The state machine implemented across an `activity/` directory. */
const MACHINE_NESTED = [
  "package.json",
  "definition.json",
  "src/index.ts",
  "src/activity/index.ts",
  "src/activity/events.ts",
  "src/runtime/assets.ts",
  "src/runtime/media.ts",
  "res/layout.html",
  "res/style.scss",
] as const;

/** The same machine, implemented in one file. Simple activities land here. */
const MACHINE_FLAT = [
  "package.json",
  "definition.json",
  "src/index.ts",
  "src/activity.ts",
  "res/layout.html",
  "res/style.scss",
] as const;

const SEQUENCE_REQUIRED = [
  "package.json",
  "definition.json",
  "src/index.js",
  "src/activity-state.js",
  "src/preview-start.js",
  "src/sequence.js",
  "res/layout.html",
  "res/style.scss",
] as const;

export type MachineLayout = "nested" | "flat";

/**
 * Which machine layout a module is using.
 *
 * Read from what is there rather than chosen: `src/activity/index.ts` means the nested
 * layout. Deciding for the agent would mean rejecting a flat implementation that works.
 */
export function machineLayout(present: readonly string[]): MachineLayout {
  return present.includes("src/activity/index.ts") ? "nested" : "flat";
}

/** The files an implementation must have produced. */
export function requiredPaths(path: BehaviorPath, present: readonly string[]): readonly string[] {
  if (path === "sequence") return SEQUENCE_REQUIRED;
  return machineLayout(present) === "nested" ? MACHINE_NESTED : MACHINE_FLAT;
}

export interface ContractResult {
  ok: boolean;
  /** Which layout the check judged against, so a report can say what it expected. */
  layout: MachineLayout | "sequence";
  missing: string[];
  message: string;
}

/**
 * Whether an implementation satisfied its contract.
 *
 * Every missing path is named. An agent told only the first missing file fixes it, the run
 * is re-reviewed, and the next one is reported — which turns one round trip into six, each
 * of them a paid agent pass.
 */
export function checkBehaviorContract(
  path: BehaviorPath,
  present: readonly string[],
): ContractResult {
  const layout = path === "sequence" ? ("sequence" as const) : machineLayout(present);
  const required = requiredPaths(path, present);
  const have = new Set(present);
  const missing = required.filter((file) => !have.has(file));
  if (!missing.length)
    return {
      ok: true,
      layout,
      missing: [],
      message:
        layout === "sequence"
          ? "The module implements the sequence contract."
          : `The module implements the ${layout} state-machine contract.`,
    };
  const described =
    layout === "sequence" ? "the sequence contract" : `the ${layout} state-machine contract`;
  return {
    ok: false,
    layout,
    missing,
    message: `The implementation is missing ${missing.length} ${missing.length === 1 ? "file" : "files"} required by ${described}: ${missing.join(", ")}.`,
  };
}

/**
 * Whether a review pass is worth starting.
 *
 * Loom always runs the review. Skipping it when the contract is not met is the one place
 * this port deliberately differs: a review pass over an implementation that has not
 * produced its required files spends a second agent run to be told what the contract check
 * already knows, and its findings are about code that is about to be rewritten anyway.
 */
export function reviewWorthStarting(result: ContractResult): boolean {
  return result.ok;
}
