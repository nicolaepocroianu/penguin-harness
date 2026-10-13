/**
 * The contract every kind of activity run keeps with the generation engine.
 *
 * A kind says whether a run may start (`check`, then `authorize` once the owning Agent is
 * known), what it records about itself, what it stages in its workspace, what its agent is
 * told, how what the agent wrote becomes the run's candidate, and how an accepted candidate
 * changes the draft. The engine does everything else: the activity's lock, the run store,
 * Sessions and their observers, cancellation, shutdown, and the shared tail that keeps a
 * candidate only while the draft is the one the run started from.
 */
import { libraryPlugin, type ProtectedRoot } from "@prismshadow/penguin-core";
import type { ActivityAuthoring } from "../../mechanisms/activities.js";
import { HttpError } from "../../http/errors.js";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRun,
  ActivityRunFields,
  ActivityRunSummary,
} from "../domain.js";
import type { RunRequest, RunSkip } from "../run-request.js";
import type { LocalAudio, LocalAudioRequest } from "../local-audio.js";
import type { MediaHelperPorts, MediaHelperScript } from "../media-helper-runner.js";
import type { SoundModelPorts } from "../sound-models.js";
import type { TestBrowser } from "../test-browser.js";
import type { VideoTimelineView } from "../video-timeline-types.js";
import type { WafWorkspace } from "../waf-workspace.js";

/** What the generation engine lends a run kind. */
export interface RunKindServices {
  readonly activities: ActivityAuthoring;
  readonly wafWorkspace: WafWorkspace;
  readonly browser: TestBrowser;
  readonly soundModels: SoundModelPorts;
  readonly localAudio: LocalAudio;
  readonly mediaHelper: MediaHelperPorts;
  /** Where the server keeps its data; the caches every run shares live under it. */
  readonly root: string;
  /** A run's folder, where its agent works. */
  workspace(runId: string): string;
  /** The activity's runs, newest first. */
  list(projectId: string, activityId: string): Promise<ActivityRunSummary[]>;
  /** One run of the activity, with its candidate; 404 `run_not_found` when there is none. */
  run(projectId: string, activityId: string, runId: string): Promise<ActivityRun>;
  /** 403 `experiment_off` unless an admin turned the scene-video experiment on. */
  requireVideoExperiment(): void;
  videoTimeline(
    projectId: string,
    activityId: string,
    language: string,
    assetKey: string,
  ): Promise<VideoTimelineView>;
  /** The names of the keys an Agent's Vault holds; never a value. */
  vaultKeys(projectId: string, agentId: string): Promise<string[]>;
  /** The voice the default ElevenLabs voice speaks with in this project. */
  elevenLabsDefaultVoice(projectId: string): Promise<string>;
  /**
   * Starts the test browser for a confined run and answers where its checks connect, or
   * undefined when there is none to start.
   */
  serveBrowser(runId: string): Promise<string | undefined>;
}

/** Everything a kind is given while its run is being started. */
export interface StageInput<Prepared, Run extends ActivityRun> {
  services: RunKindServices;
  activity: ActivityDetail;
  prepared: Prepared;
  run: Run;
  workspace: string;
  /** Whether Penguin's sandbox confines the run's commands to its workspace. */
  confined: boolean;
  /** The script with its media tags normalized, as `description.md` holds it. */
  description: string;
  expectedRevision: string;
}

/** What a run's Session last said about its request: completed, or why not. */
export interface Observed {
  completed: boolean;
  error: string | null;
}

/** Everything a kind is given to collect what its agent wrote. */
export interface CollectInput<Run extends ActivityRun> {
  services: RunKindServices;
  run: Run;
  workspace: string;
  observed: Observed | undefined;
  /** Whether the server is stopping: a run left running then is interrupted, never settled. */
  stopping(): boolean;
  /** Records the run as it is now, its candidate included. */
  save(run: ActivityRun): void;
}

/**
 * How a collected run ends. `null` from `collect` leaves it running, for the server that is
 * stopping to interrupt.
 */
export type Settlement =
  /** Settled at once, as it is, stopping or not: a conversation's reply is its result. */
  | { settled: "succeeded" }
  | { settled: "failed"; error: string }
  /**
   * The candidate is kept. Unless the server is stopping, the run then succeeds: after
   * `apply` when there is one; else, with `draftChanged`, only while the draft is still the
   * one the run started from (`verify` first, under the same admission), else at once.
   */
  | {
      kept: true;
      apply?: () => Promise<void>;
      draftChanged?: string;
      verify?: () => Promise<void>;
    };

/** How a successful candidate of a kind is accepted into the draft. */
export interface Acceptance<Run extends ActivityRun> {
  /** 409 with this code and message unless the run succeeded with a candidate of this kind. */
  readonly changed: { code: string; message: string };
  /** Whether the run holds what accepting needs besides a candidate. */
  ready?(run: Run): boolean;
  /** The refusal when the draft changed since the run started. */
  draftChanged(services: RunKindServices, run: Run): Promise<HttpError>;
  apply(
    services: RunKindServices,
    run: Run & { candidate: string },
    expectedRevision: string,
  ): Promise<ActivityDraft>;
}

interface RunKindBase<Request extends RunRequest, Prepared, Run extends ActivityRun> {
  /** The kind of run it records. */
  readonly run: Run["kind"];
  /** Speech, sound and images belong to the Media Agent: their helpers read its Vault. */
  readonly mediaAgent?: true;
  /** Refused while the scene-video experiment is off, before the draft is looked at. */
  readonly experimental?: true;
  /** Refused while the activity has no script. */
  readonly needsScript: boolean;
  /**
   * Whether the run may start on this activity, and what it needs if so: rejects with the
   * refusal a start would answer.
   */
  check(
    services: RunKindServices,
    request: Request,
    activity: ActivityDetail,
    projectId: string,
  ): Promise<Prepared>;
  /**
   * The refusals that depend on the owning Agent's Vault, checked once the Agent is known to
   * exist; may settle what `check` left open (a provider's model, a voice).
   */
  authorize?(
    services: RunKindServices,
    prepared: Prepared,
    owner: { projectId: string; agentId: string },
  ): Promise<void>;
  /**
   * What the run records about itself besides what every run does, as it opens. What only
   * staging learns, `stage` may add to `run`.
   */
  record(prepared: Prepared): Partial<ActivityRunFields>;
  /** What `input.json` carries besides the activity. */
  input?(prepared: Prepared): Record<string, unknown>;
  readonly accept?: Acceptance<Run>;
}

/** A kind whose agent works in a Session. */
export interface SessionRunKind<
  Request extends RunRequest,
  Prepared,
  Run extends ActivityRun,
  Staged = void,
> extends RunKindBase<Request, Prepared, Run> {
  readonly runner: "session";
  /**
   * Stages the run's workspace. It may record on `run` what it staged (a digest, say): the
   * engine saves the record before the run's Session starts, so the agent never works on a run
   * whose record lacks it.
   */
  stage(input: StageInput<Prepared, Run>): Promise<Staged>;
  prompt(input: StageInput<Prepared, Run>, staged: Staged): string;
  /** Roots the Session may read and never change. */
  protectedRoots?(input: StageInput<Prepared, Run>): ProtectedRoot[];
  /** The files the agent writes; its result is read from the first. */
  readonly outputs: readonly string[];
  /** How a failure names what the Session did not write, when not the outputs. */
  readonly missing?: string;
  collect(input: CollectInput<Run>): Promise<Settlement | null>;
  /** Records on a failed run what the failure was, when its kind keeps that. */
  failed?(run: Run, error: unknown): void;
}

/** A kind the server runs itself, with no agent: a provider helper, or a model on this machine. */
export interface ServerRunKind<
  Request extends RunRequest,
  Prepared,
  Run extends ActivityRun,
> extends RunKindBase<Request, Prepared, Run> {
  readonly runner: "server";
  /** The request for a model on this machine, when the run uses one. */
  local(prepared: Prepared): LocalAudioRequest | null;
  stage(input: StageInput<Prepared, Run>): Promise<void>;
  helper(prepared: Prepared): { script: MediaHelperScript; install: boolean };
  /** The file the helper must have written, named when it did not. */
  missing(run: Run): string;
  /** Keeps what the helper wrote as the run's candidate. */
  collect(input: CollectInput<Run>): Promise<{ draftChanged: string }>;
}

/** A kind of any request; the registry holds each kind with its own types. */
export type AnyRunKind = SessionRunKind<any, any, any, any> | ServerRunKind<any, any, any>;

/**
 * Whether a run may start: the refusal a start would answer, or none. Checks the activity and,
 * given the owning Agent, its Vault. The draft's revision, the Agent itself and the one run
 * per activity are the engine's to check.
 */
export async function canRun(
  kind: AnyRunKind,
  services: RunKindServices,
  request: RunRequest,
  activity: ActivityDetail,
  owner: { projectId: string; agentId?: string },
): Promise<{ ok: true } | { ok: false; refusal: HttpError; skip?: RunSkip }> {
  try {
    if (kind.experimental) services.requireVideoExperiment();
    if (kind.needsScript && !activity.draft.description.trim()) throw scriptRequired();
    const prepared: unknown = await kind.check(services, request, activity, owner.projectId);
    if (owner.agentId !== undefined)
      await kind.authorize?.(services, prepared, {
        projectId: owner.projectId,
        agentId: owner.agentId,
      });
    return { ok: true };
  } catch (error) {
    if (error instanceof RunRefusal) return { ok: false, refusal: error, skip: error.skip };
    if (error instanceof HttpError) return { ok: false, refusal: error };
    throw error;
  }
}

/**
 * A refusal its kind says leaves the work undone rather than failed: answered as any refusal
 * is, and told apart by `skip` where the work is done in stages.
 */
export class RunRefusal extends HttpError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly skip: RunSkip,
  ) {
    super(status, code, message);
  }
}

export function scriptRequired(): HttpError {
  return new HttpError(400, "description_required", "Add a description before generating.");
}

/** Refuses a run whose Session did not end its request completed. */
export function requireCompleted(observed: Observed | undefined, otherwise: string): void {
  if (!observed?.completed) throw new Error(observed?.error ?? otherwise);
}

/** Whether the draft holds a specification that passed its checks. */
export function hasValidSpec(activity: ActivityDetail): boolean {
  return !!activity.draft.spec && activity.draft.status === "valid";
}

/** A media helper the bundled agent-development plugin ships; 500 when it is missing. */
export function bundledMediaHelper(name: string, missingCode: string): string {
  const helper = libraryPlugin("agent-development")?.skills.find(
    (skill) => skill.name === "unified-llm-api",
  )?.files?.[`scripts/${name}`];
  if (!helper)
    throw new HttpError(
      500,
      missingCode,
      "The installed media helper is missing. Rebuild the bundled plugins.",
    );
  return helper;
}

/** A skill the bundled waf-authoring plugin ships, as its text; 500 when it is missing. */
export function authoringSkill(name: string, missingCode: string, what: string): string {
  const skill = libraryPlugin("waf-authoring")?.skills.find(
    (entry) => entry.name === name,
  )?.content;
  if (!skill)
    throw new HttpError(
      500,
      missingCode,
      `The installed ${what} is missing. Rebuild the bundled plugins.`,
    );
  return skill;
}
