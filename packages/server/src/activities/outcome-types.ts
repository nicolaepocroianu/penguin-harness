/**
 * The shapes of the outcome ledger, on their own so a client can import them without the
 * component that keeps it (see `outcomes.ts`).
 *
 * A run's recipe is what decided how its agent worked; its outcome is what became of it after
 * it ended. Runs with the same recipe can be compared, within one run kind.
 */
import type { ActivityDraft, ActivityRun, ActivityRunKind } from "./domain.js";

/** A limit the server stopped a run at: `time` when it worked longer than it may. */
export type RunLimit = "time";

/** A moment the ledger is shown: how a run, or an activity's draft, stands now. */
export type Witnessed =
  | {
      run: ActivityRun;
      /** As the run ends: the limit the server stopped it at, when it did. */
      limit?: RunLimit;
      /** The first message the run's agent is given, as its Session starts. */
      prompt?: string;
      /** The Session the run's agent works in, by its provider and model, as it was created. */
      session?: { provider: string; modelId: string };
      /**
       * What the server runs itself in place of a Session, as it starts: `helper:<script>` for
       * a media helper, `local:<provider>/<model>` for a model on this machine.
       */
      server?: string;
    }
  | {
      draft: {
        projectId: string;
        activityId: string;
        /** The draft as it was before the change. */
        before: ActivityDraft;
        /** The draft the change wrote. */
        after: ActivityDraft;
      };
    };

/**
 * Who makes the draft changes witnessed inside an operation: an author, the Stages, or a run
 * applying its own result; and, when the change accepts a run's candidate, which run.
 */
export interface OutcomeCause {
  actor?: "author" | "stages" | "run";
  runId?: string;
}

/** One skill a run was given, as it was staged. */
export interface RecipeSkill {
  name: string;
  /** The skill's own dated version. */
  version: string;
  /** SHA-256 of the skill's staged files, each by its path and digest. */
  sha256: string;
}

/** The skills one bundled plugin gave a run. */
export interface RecipeLibrary {
  plugin: string;
  /** The plugin's dated version. */
  version: string;
  skills: RecipeSkill[];
}

/** What decided how a run's agent worked. */
export interface RunRecipe {
  /**
   * Who answered: `agent:<provider>/<model>` for a Penguin agent's Session, `coding:<id>` for a
   * coding agent's, `helper:<script>` or `local:<provider>/<model>` for work the server runs
   * itself for an agent, and `server` for work no agent has any part in.
   */
  runtime: string;
  /** The bundled authoring files the run was given, matched by their digest. */
  library: RecipeLibrary[];
  /** The acceptance harness API a module or test run was given; absent for other kinds. */
  harness?: number;
  /** Penguin's version. */
  penguin: string;
}

/** What a tally groups runs by: the whole recipe, or one part of it. */
export type OutcomeDimension = "recipe" | "runtime" | "prompt" | "library" | "harness" | "penguin";

/** Which runs a tally counts. Outcomes compare within one run kind. */
export interface OutcomeQuery {
  kind: ActivityRunKind;
  /** The recipe by default. */
  by?: OutcomeDimension;
  projectId?: string;
  activityIds?: string[];
  /** Runs started at or after this time (ISO). */
  since?: string;
  /** Runs started before this time (ISO). */
  until?: string;
}

/**
 * The runs of one recipe, or of one value of a recipe's part, counted. Named metrics, summed
 * over the runs: how many ended each way (`succeeded`, `failed`, …), `seconds` they took, and
 * what was found and done after they ended (`tests.failed`, `superseded`, `deployed.qa`, …).
 */
export interface OutcomeTally {
  /** The recipe's id, or the part's value; null when the runs' recipes have no such part. */
  key: string | null;
  /** The recipe, when the tally is by recipe. */
  recipe: RunRecipe | null;
  runs: number;
  metrics: Record<string, number>;
}

/**
 * What the ledger records happening: to a run (`opened` … `deployed`), or to an activity's draft
 * (`pinned`, a module build pinned to play, which names no run).
 */
export type OutcomeFactName =
  | "opened"
  | "started"
  | "settled"
  | "checks"
  | "judged"
  | "superseded"
  | "discarded"
  | "part"
  | "accepted"
  | "deployed"
  | "pinned";

/** One thing that happened to a run, with when. */
export interface OutcomeFact {
  fact: OutcomeFactName;
  at: string;
  /** Numbers, digests and ids only: never what an author or an agent wrote. */
  detail: Record<string, unknown>;
}

/** A run as the ledger knows it, oldest fact first. */
export interface RunStory {
  runId: string;
  activityId: string;
  kind: ActivityRunKind;
  startedAt: string;
  /** Null when the run started before the ledger, or ended before its agent started. */
  recipe: RunRecipe | null;
  facts: OutcomeFact[];
}

/** GET /api/admin/activity-outcomes/tally */
export interface OutcomeTallyResponse {
  tallies: OutcomeTally[];
}

/** GET /api/admin/activity-outcomes/history */
export interface OutcomeHistoryResponse {
  runs: RunStory[];
}

/** The runs of one tally: its query, and the key it groups them under. */
export interface OutcomeRunsQuery extends OutcomeQuery {
  /** The tally's key; null for the runs whose recipes have no such part. */
  key: string | null;
}

/** One run a tally counted, as a list of them shows it. */
export interface OutcomeRun {
  runId: string;
  projectId: string;
  activityId: string;
  startedAt: string;
  /** How it ended, or `running`. */
  status: ActivityRun["status"];
}

/** GET /api/admin/activity-outcomes/runs */
export interface OutcomeRunsResponse {
  runs: OutcomeRun[];
}

/** GET /api/admin/activity-outcomes/projects */
export interface OutcomeProjectsResponse {
  projects: string[];
}

/** One file of a bundled skill a run may be given. */
export interface LibraryFile {
  plugin: string;
  /** The plugin's dated version. */
  version: string;
  skill: string;
  /** The skill's own dated version. */
  skillVersion: string;
  /** Its path inside the skill: `SKILL.md`, `scripts/generate-image.mjs`, … */
  file: string;
  sha256: string;
  bytes: number;
}
