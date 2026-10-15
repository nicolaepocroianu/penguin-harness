/**
 * The activity's journey, decided without a DOM: the header's six steps from the script to a
 * deploy, each with its state in words and a mark whose shape carries it, and the readiness
 * list behind the header's one next-step button — what stands between the activity and QA,
 * blockers first, each with where it is fixed.
 *
 * A blocker is exactly what a QA deploy would refuse: no module to ship, or a problem the
 * server says keeps the deploy's stages from starting. Everything else worth doing first is a
 * recommendation, since the deploy starts without it. The button reads "Ready for QA" only when
 * the deploy state has been read and holds no blocker, so it can never point at a deploy that
 * would be refused.
 */
import type {
  ActivityDetail,
  DeployProblem,
  DeployRepo,
  DeployStateResponse,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";
import { failingChecks, type ChecksFacts } from "./checks-model";
import {
  blockerProblem,
  isProdRun,
  isQaRun,
  problemText,
  qaResult,
  repoName,
} from "./deploy-model";
import type { StudioPanel, WorkspaceSection } from "./workspace-model";

export type JourneyStepKey = "script" | "specification" | "media" | "module" | "checks" | "deploy";

/**
 * A step's state as a shape — a tick, an alert, a lock, a cross, a turning ring or an empty
 * ring — so it reads without colour; the tone only confirms it.
 */
export type StepMark = "done" | "attention" | "blocked" | "failed" | "busy" | "todo";

/** Where something is done: a section of the work, or one of the right-edge tools. */
export type JourneyTarget =
  { kind: "section"; section: WorkspaceSection } | { kind: "tool"; tool: StudioPanel };

const section = (key: WorkspaceSection): JourneyTarget => ({ kind: "section", section: key });
const tool = (key: StudioPanel): JourneyTarget => ({ kind: "tool", tool: key });

/** Where the activity stands on QA, as the Deploy step reads it. */
export type QaFact = "deployed" | "deploying" | "failed" | "none";

/**
 * QA from the deploy state the Deploy section also reads: a QA deploy running now, a finished
 * one (which survives a reload in the stored stages), the latest QA run having failed, or none.
 */
export function qaFact(state: Pick<DeployStateResponse, "run" | "stages">): QaFact {
  const run = state.run;
  const qaRun = run && isQaRun(run) && !isProdRun(run) ? run : null;
  if (qaRun?.status === "running") return "deploying";
  if (qaResult(state.stages)) return "deployed";
  if (qaRun?.status === "failed") return "failed";
  return "none";
}

/** The deploy state, as far as the journey reads it. */
export interface DeployFacts {
  qa: QaFact;
  /** What keeps a QA deploy from starting, as the server lists it; empty when nothing does. */
  blocking: readonly DeployProblem[];
  /** QA has the activity, but not as it is now: it changed since its QA deploy. */
  qaBehind: boolean;
}

/**
 * The problems the stages' own blockers name, once each: what an answer without the server's
 * list still says. Each stage names only the first problem, so this may list fewer.
 */
function stageProblems(stages: readonly DeployStageState[]): DeployProblem[] {
  const seen = new Set<string>();
  const problems: DeployProblem[] = [];
  for (const stage of stages) {
    const problem = blockerProblem(stage.blocker);
    const key = problem && JSON.stringify(problem);
    if (!problem || !key || seen.has(key)) continue;
    seen.add(key);
    problems.push(problem);
  }
  return problems;
}

export function deployFacts(
  state: Pick<DeployStateResponse, "run" | "stages" | "production"> &
    Partial<Pick<DeployStateResponse, "blocking">>,
): DeployFacts {
  const qa = qaFact(state);
  return {
    qa,
    blocking: Array.isArray(state.blocking) ? state.blocking : stageProblems(state.stages),
    qaBehind: qa === "deployed" && state.production?.blocker?.code === "qa_outdated",
  };
}

/** What the module step reads. */
export interface ModuleFacts {
  /** A succeeded build exists, which a deploy ships. */
  built: boolean;
  /** When the newest build finished; null when not known. */
  builtAt: string | null;
  /** The newest build was assembled from an earlier draft than the saved one. */
  outdated: boolean;
  /** An assembly is running now. */
  building: boolean;
}

/** Everything the journey reads, each from where the studio already reads it. */
export interface JourneyFacts {
  status: ActivityDetail["draft"]["status"];
  /** A specification exists to validate. */
  hasSpec: boolean;
  scriptDirty: boolean;
  specDirty: boolean;
  /**
   * Clips with files, of all the plan holds, and how many of the bound ones are only the
   * placeholder; null before there is a plan.
   */
  media: { bound: number; total: number; placeholders?: number } | null;
  /** Kept scene videos whose final check found something to fix. */
  videosToCheck?: number;
  module: ModuleFacts;
  /** What the checks found; null until they have been read. */
  checks: ChecksFacts | null;
  /** The deploy state; null until it has been read, or when the read failed. */
  deploy: DeployFacts | null;
}

export interface JourneyStep {
  key: JourneyStepKey;
  label: string;
  /** The state in words: the mark's shape and tone never carry it alone. */
  state: string;
  tone: Tone;
  mark: StepMark;
  /** Where the step is worked on. */
  go: JourneyTarget;
}

type StepState = Pick<JourneyStep, "state" | "tone" | "mark">;
const done = (state: string): StepState => ({ state, tone: "success", mark: "done" });
const attention = (state: string): StepState => ({ state, tone: "attention", mark: "attention" });
const todo = (state: string): StepState => ({ state, tone: "muted", mark: "todo" });
const busy = (state: string): StepState => ({ state, tone: "busy", mark: "busy" });
const failed = (state: string): StepState => ({ state, tone: "danger", mark: "failed" });

function specState(facts: JourneyFacts): StepState {
  const words = S.activities.journey.states;
  if (facts.specDirty) return attention(words.unsaved);
  if (!facts.hasSpec) return todo(words.noSpec);
  if (facts.status === "invalid") return failed(words.invalid);
  if (facts.status === "draft") return attention(words.notValidated);
  return done(words.validated);
}

/**
 * Media: real files counted apart from placeholders, since a stand-in clip is not finished
 * media; once every clip has a file, whether a kept scene video failed its final check.
 */
function mediaState(facts: JourneyFacts): StepState {
  const words = S.activities.journey.states;
  const media = facts.media;
  if (!media) return todo(words.noPlan);
  const placeholders = media.placeholders ?? 0;
  const ready = media.bound - placeholders;
  const withPlaceholders = (state: string) =>
    placeholders > 0 ? `${state} · ${words.placeholders(placeholders)}` : state;
  if (media.bound < media.total)
    return attention(withPlaceholders(words.clips(ready, media.total)));
  const videos = facts.videosToCheck ?? 0;
  if (videos > 0) return attention(words.videosToCheck(videos));
  if (placeholders > 0) return attention(withPlaceholders(words.ready(ready)));
  return media.total ? done(words.ready(media.total)) : todo(words.noClips);
}

function moduleState(module: ModuleFacts, when: (iso: string) => string): StepState {
  const words = S.activities.journey.states;
  if (module.building) return busy(words.building);
  if (!module.built) return todo(words.notBuilt);
  if (module.outdated) return attention(words.outdated);
  return done(module.builtAt ? words.builtOn(when(module.builtAt)) : words.built);
}

function checksState(checks: ChecksFacts | null): StepState {
  const words = S.activities.journey.states;
  if (!checks) return todo(words.checksUnknown);
  if (checks.running) return busy(words.checksRunning);
  const failing = failingChecks(checks);
  if (failing || checks.quality?.failed)
    return failed(words.checksFailing(failing + (checks.quality?.findings ?? 0)));
  if (checks.quality?.findings) return attention(words.checksFindings(checks.quality.findings));
  if (checks.tests?.stale) return attention(words.checksOutdated);
  // Tests need criteria to run at all, so without them only quality is due.
  const testsDue = checks.criteria > 0 && !checks.tests;
  if (!checks.tests && !checks.quality) return todo(words.checksNotRun);
  if (testsDue || !checks.quality) return todo(words.checksPartly);
  return done(words.checksPassed);
}

function deployState(facts: JourneyFacts): StepState {
  const words = S.activities.journey.states;
  const deploy = facts.deploy;
  if (deploy?.qa === "deploying") return busy(words.deploying);
  if (!facts.module.built) return todo(words.needsModule);
  if (!deploy) return todo(words.deployUnknown);
  if (deploy.qa === "deployed" && !deploy.qaBehind) return done(words.onQa);
  if (deploy.blocking.length) return { state: words.blocked, tone: "attention", mark: "blocked" };
  if (deploy.qa === "failed") return failed(words.deployFailed);
  if (deploy.qaBehind) return attention(words.qaBehind);
  return todo(words.deployReady);
}

/** The six steps in authoring order, each with its state and where it is worked on. */
export function journeySteps(facts: JourneyFacts, when: (iso: string) => string): JourneyStep[] {
  const words = S.activities.journey;
  return [
    {
      key: "script",
      label: words.steps.script,
      ...(facts.scriptDirty ? attention(words.states.unsaved) : done(words.states.saved)),
      go: section("description"),
    },
    {
      key: "specification",
      label: words.steps.specification,
      ...specState(facts),
      go: section("specification"),
    },
    { key: "media", label: words.steps.media, ...mediaState(facts), go: section("scenes") },
    {
      key: "module",
      label: words.steps.module,
      ...moduleState(facts.module, when),
      go: section("module"),
    },
    { key: "checks", label: words.steps.checks, ...checksState(facts.checks), go: tool("checks") },
    { key: "deploy", label: words.steps.deploy, ...deployState(facts), go: section("deploy") },
  ];
}

/** The step a section belongs to, which the header marks as where the author is. */
const STEP_OF: Partial<Record<WorkspaceSection, JourneyStepKey>> = {
  description: "script",
  specification: "specification",
  features: "specification",
  scenes: "media",
  speech: "media",
  library: "media",
  stats: "media",
  module: "module",
  configuration: "module",
  assessment: "module",
  deploy: "deploy",
};

export function stepOf(open: WorkspaceSection): JourneyStepKey | null {
  return STEP_OF[open] ?? null;
}

// ---------------------------------------------------------------------------
// The readiness list
// ---------------------------------------------------------------------------

export interface ReadinessItem {
  /** Stable across reads, for a list's keys. */
  id: string;
  /** A blocker keeps the deploy from starting; a recommendation is worth doing first. */
  kind: "blocker" | "recommendation";
  /** What to do, as an instruction. */
  title: string;
  /** Why, in a sentence or two. */
  detail: string;
  /** The press that goes where it is fixed. */
  fix: { label: string; go: JourneyTarget };
}

/**
 * What one deploy problem asks for, and which problems one fix clears together, so that fix
 * is listed once: every empty setting, every clone Prepare clones makes, everything an admin
 * prepares in the WAF workspace.
 */
function problemFix(problem: DeployProblem): { group: string; title: string } {
  const words = S.activities.journey.fixes;
  const repo = (value: DeployRepo) => repoName(value);
  switch (problem.code) {
    case "settings_missing":
      return { group: "settings", title: words.settings };
    case "clone_missing":
      return problem.repo === "module"
        ? { group: "clones", title: words.clones }
        : { group: "workspace", title: words.workspace };
    case "media_path_missing":
      return { group: "clones", title: words.clones };
    case "workspace_not_ready":
      return { group: "workspace", title: words.workspace };
    case "remote_unreachable":
      return { group: "remote", title: words.remote };
    case "branch_missing":
      return {
        group: `branch:${problem.repo}:${problem.where}`,
        title: words.branch(problem.branch),
      };
    case "not_canonical":
      return { group: problem.code, title: words.canonical };
    case "no_module":
      return { group: problem.code, title: words.product };
    case "layout_unsupported":
      return { group: problem.code, title: words.layout };
    case "git_unavailable":
      return { group: problem.code, title: words.git };
    case "module_remote_invalid":
      return { group: problem.code, title: words.moduleRemote };
    case "clone_unknown":
      return { group: `unknown:${problem.repo}`, title: words.cloneUnknown(repo(problem.repo)) };
    case "clone_remote_mismatch":
      return { group: `mismatch:${problem.repo}`, title: words.cloneRemote(repo(problem.repo)) };
    case "clone_dirty":
      return { group: `dirty:${problem.repo}`, title: words.cloneDirty(repo(problem.repo)) };
    case "clone_ahead":
      return { group: `ahead:${problem.repo}`, title: words.cloneAhead(repo(problem.repo)) };
    case "clone_stash_left":
      return { group: `stash:${problem.repo}`, title: words.cloneStash(repo(problem.repo)) };
    default: {
      // A problem the server added and this list does not word yet fails the build here.
      const unworded: never = problem;
      return unworded;
    }
  }
}

/** The deploy's blockers, one item per fix, in the order the server listed the problems. */
function deployBlockers(blocking: readonly DeployProblem[]): ReadinessItem[] {
  const fix = { label: S.activities.journey.go.deployFix, go: section("deploy") };
  const items: ReadinessItem[] = [];
  for (const problem of blocking) {
    const { group, title } = problemFix(problem);
    const text = problemText(problem);
    const found = items.find((item) => item.id === `deploy:${group}`);
    if (found) {
      if (!found.detail.includes(text)) found.detail = `${found.detail} ${text}`;
    } else items.push({ id: `deploy:${group}`, kind: "blocker", title, detail: text, fix });
  }
  return items;
}

/** Which checks have not run on the draft as it is, in words. */
function dueText(testsDue: boolean, testsStale: boolean, qualityDue: boolean): string {
  const words = S.activities.journey.items;
  if (testsDue && qualityDue) return words.runBoth;
  if (testsDue) return testsStale ? words.testsOutdated : words.testsNotRun;
  return words.qualityNotRun;
}

function checksItems(checks: ChecksFacts | null): ReadinessItem[] {
  if (!checks || checks.running) return [];
  const words = S.activities.journey.items;
  const go = S.activities.journey.go;
  const items: ReadinessItem[] = [];
  const openChecks = { label: go.checks, go: tool("checks") };
  if (checks.criteria === 0)
    items.push({
      id: "criteria",
      kind: "recommendation",
      title: words.addCriteria,
      detail: words.addCriteriaDetail,
      fix: { label: go.specification, go: section("specification") },
    });
  const testsDue = checks.criteria > 0 && (!checks.tests || checks.tests.stale);
  if (testsDue || !checks.quality)
    items.push({
      id: "runChecks",
      kind: "recommendation",
      title: words.runChecks,
      detail: dueText(testsDue, checks.tests?.stale === true, !checks.quality),
      fix: openChecks,
    });
  const failing = {
    tests: checks.tests && !checks.tests.stale ? checks.tests.failed : 0,
    findings: checks.quality?.findings ?? 0,
    scenarios: checks.player?.failed ?? 0,
  };
  if (failing.tests || failing.findings || failing.scenarios || checks.quality?.failed)
    items.push({
      id: "checksFound",
      kind: "recommendation",
      title: words.fixFindings,
      detail: words.found(failing.tests, failing.findings, failing.scenarios),
      fix: openChecks,
    });
  if (checks.playerGap)
    items.push({
      id: "playerCheck",
      kind: "recommendation",
      title: words.playerCheck,
      detail: checks.playerGap === "noBrowser" ? words.playerNoBrowser : words.playerNotRun,
      fix: openChecks,
    });
  return items;
}

/** What the saved specification still wants: writing, fixing or validating; null once valid. */
function specAdvice(facts: JourneyFacts): { title: string; detail: string } | null {
  const words = S.activities.journey.items;
  if (!facts.hasSpec) return { title: words.writeSpec, detail: words.writeSpecDetail };
  if (facts.status === "invalid") return { title: words.fixSpec, detail: words.fixSpecDetail };
  if (facts.status === "draft")
    return { title: words.validateSpec, detail: words.validateSpecDetail };
  return null;
}

/** What stands between the activity and QA: blockers first, then recommendations. */
export function readinessItems(facts: JourneyFacts): ReadinessItem[] {
  const words = S.activities.journey.items;
  const go = S.activities.journey.go;
  const blockers: ReadinessItem[] = [];
  const recommended: ReadinessItem[] = [];
  const recommend = (item: Omit<ReadinessItem, "kind">) =>
    recommended.push({ ...item, kind: "recommendation" });

  if (!facts.module.built)
    blockers.push({
      id: "module",
      kind: "blocker",
      title: facts.module.building ? words.moduleBuilding : words.buildModule,
      detail: words.buildModuleDetail,
      // A module is built by running the stages, which the Stages tool follows.
      fix: { label: go.stages, go: tool("run") },
    });
  // What the deploy says only matters once there is a module for it to ship.
  if (facts.module.built && facts.deploy && facts.deploy.qa !== "deploying")
    blockers.push(...deployBlockers(facts.deploy.blocking));

  // The deploy ships the saved draft, so edits on screen go first.
  if (facts.scriptDirty)
    recommend({
      id: "saveScript",
      title: words.saveScript,
      detail: words.saveDetail,
      fix: { label: go.script, go: section("description") },
    });
  if (facts.specDirty)
    recommend({
      id: "saveSpec",
      title: words.saveSpec,
      detail: words.saveDetail,
      fix: { label: go.specification, go: section("specification") },
    });
  else {
    const advice = specAdvice(facts);
    if (advice)
      recommend({
        id: "spec",
        ...advice,
        fix: { label: go.specification, go: section("specification") },
      });
  }

  const media = facts.media;
  const toScenes = { label: go.media, go: section("scenes") };
  if (!media && facts.hasSpec)
    recommend({
      id: "planMedia",
      title: words.planMedia,
      detail: words.planMediaDetail,
      fix: toScenes,
    });
  if (media && media.bound < media.total)
    recommend({
      id: "bindMedia",
      title: words.bindMedia,
      detail: words.bindMediaDetail(media.total - media.bound, media.total),
      fix: toScenes,
    });
  const videos = facts.videosToCheck ?? 0;
  if (videos > 0)
    recommend({
      id: "videos",
      title: words.checkVideos,
      detail: words.checkVideosDetail(videos),
      fix: toScenes,
    });
  if (media?.placeholders)
    recommend({
      id: "placeholders",
      title: words.replacePlaceholders(media.placeholders),
      detail: words.placeholdersDetail(media.placeholders),
      fix: toScenes,
    });

  if (facts.module.built && facts.module.outdated && !facts.module.building)
    recommend({
      id: "rebuild",
      title: words.rebuild,
      detail: words.rebuildDetail,
      fix: { label: go.module, go: section("module") },
    });

  recommended.push(...checksItems(facts.checks));

  const deploy = facts.deploy;
  if (deploy?.qa === "failed")
    recommend({
      id: "qaFailed",
      title: words.qaFailed,
      detail: words.qaFailedDetail,
      fix: { label: go.deploy, go: section("deploy") },
    });
  if (deploy?.qaBehind)
    recommend({
      id: "qaBehind",
      title: words.qaBehind,
      detail: words.qaBehindDetail,
      fix: { label: go.deploy, go: section("deploy") },
    });
  return [...blockers, ...recommended];
}

/** The header's one next-step button: what it says, and how many items stand behind it. */
export interface NextStep {
  /**
   * `steps` while anything stands between the activity and QA, `ready` once nothing does,
   * `deploying` while a QA deploy runs, `onQa` once QA has the activity as it is now, and
   * `unknown` while the deploy state is not known and nothing else is listed.
   */
  state: "steps" | "ready" | "deploying" | "onQa" | "unknown";
  label: string;
  /** The label where the header is as narrow as a phone. */
  short: string;
  blockers: number;
  recommendations: number;
}

export function nextStep(facts: JourneyFacts, items: readonly ReadinessItem[]): NextStep {
  const words = S.activities.journey.next;
  const blockers = items.filter((item) => item.kind === "blocker").length;
  const counts = { blockers, recommendations: items.length - blockers };
  const deploy = facts.deploy;
  const as = (state: NextStep["state"], label: string, short: string): NextStep => ({
    state,
    label,
    short,
    ...counts,
  });
  if (deploy?.qa === "deploying") return as("deploying", words.deploying, words.short.deploying);
  if (deploy?.qa === "deployed" && !deploy.qaBehind)
    return as("onQa", words.onQa, words.short.onQa);
  if (items.length) return as("steps", words.steps(items.length), words.short.steps(items.length));
  // Ready only once the deploy has been read and holds nothing back.
  if (!deploy) return as("unknown", words.unknown, words.short.unknown);
  return as("ready", words.ready, words.short.ready);
}

/** The module facts from the activity's runs and its saved draft. */
export function moduleFacts(input: {
  /** Succeeded module builds, newest first. */
  builds: readonly { finishedAt?: string | null; createdAt: string; inputRevision?: string }[];
  /** A build only the sandbox knows of: a module in the WAF checkout. */
  sandboxModule: boolean;
  building: boolean;
  revision: string;
}): ModuleFacts {
  const newest = input.builds[0];
  return {
    built: !!newest || input.sandboxModule,
    builtAt: newest ? (newest.finishedAt ?? newest.createdAt) : null,
    outdated: !!newest?.inputRevision && newest.inputRevision !== input.revision,
    building: input.building,
  };
}
