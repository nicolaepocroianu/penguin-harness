import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_AGENT_ID,
  MEDIA_AGENT_ID,
  loadAgentVault,
  userText,
} from "@prismshadow/penguin-core";
import { Component, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Clock, Config, Channels, Log, Paths } from "../hmr/capabilities.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { AgentConfig, AgentLifecycle } from "../mechanisms/agents.js";
import { CODING_AGENT_PROVIDER } from "../coding-agents/session-runtime.js";
import type { Members, ProjectActivityWork, Projects } from "../mechanisms/projects.js";
import { publishToProjectUsers } from "../http/routes/events.js";
import type { ChannelHub } from "../runtime/channel.js";
import type { Sessions, SessionServiceIface } from "../runtime/session-manager.js";
import { HttpError } from "../http/errors.js";
import { atomicJson } from "./service.js";
import type { ActivityLock } from "./activity-lock.js";
import type { ActivityRuns } from "./run-store.js";
import type { ActivityOutcomes } from "./outcomes.js";
import type { RunLimit } from "./outcome-types.js";
import {
  RUN_LIMIT_SETTING,
  readRunLimitMinutes,
  timeLimitMessage,
  wallClockLimitMs,
} from "./run-limits.js";
import type { AudioResult } from "./audio.js";
import { SoundModelPorts } from "./sound-models.js";
import { LocalAudio, type LocalAudioRequest } from "./local-audio.js";
import {
  MediaHelperPorts,
  runMediaHelper,
  warmModuleDependencies,
  type MediaHelperScript,
} from "./media-helper-runner.js";
import { soundSetup, speechSetup } from "./audio-providers.js";
import type { SoundSetup } from "./sound-types.js";
import type { ElevenLabsVoices, SpeechSetup } from "./speech-types.js";
import {
  ELEVENLABS_DEFAULT_OPTION,
  ELEVENLABS_VOICE_KEY,
  elevenLabsDefaultVoiceId,
  SPEECH_MODEL,
  SPEECH_VOICES,
  speechCatalogue,
  type VoiceOption,
} from "./voice-catalogue.js";
import {
  ElevenLabsVoicesError,
  listElevenLabsVoices,
  withDefaultFirst,
} from "./elevenlabs-voices.js";
import { readArtifactBytes, readCandidate } from "./artifact.js";
import type { ImageResult } from "./generated-image.js";
import type { WafWorkspace } from "./waf-workspace.js";
import { MODULE_PACKAGES } from "./waf-module.js";
import {
  DISCARDED_PROPOSAL_FILE,
  PROPOSAL_FILE,
  PROPOSAL_MAX_BYTES,
  parseAssistProposal,
  type AssistProposal,
} from "./assist.js";
import type { BrowserServerHandle, TestBrowser } from "./test-browser.js";
import type { Settings } from "../mechanisms/settings.js";
import {
  VIDEO_EXPERIMENT_SETTING,
  experimentOff,
  readVideoExperiment,
} from "./video-experiment.js";
import {
  COMPOSITION_BRIDGE,
  COMPOSITION_BRIDGE_FILE,
  COMPOSITION_FILE,
  COMPOSITION_GSAP_FILE,
  COMPOSITION_MAX_BYTES,
  gsapSource,
  sha256,
  type CompositionFileContent,
} from "./composition.js";
import { IMAGE_MAX_BYTES as COMPOSITION_IMAGE_MAX_BYTES } from "./image.js";
import type { CompositionCandidate } from "./composition-types.js";
import { COMPOSITION_LOOK_FILE, sceneLook } from "./scene-looks.js";
import type { VideoCheck, VideoProblemCode, VideoResult, VideoTarget } from "./video-types.js";
import { RENDER_FPS } from "./video-render.js";
import { defaultTimeline, timelineIssues } from "./video-timeline.js";
import type { TimelineIssue, VideoTimeline, VideoTimelineView } from "./video-timeline-types.js";
import { mediaContentType } from "./media-origin.js";
import {
  newId,
  type ActivityDraft,
  type ActivityRun,
  type ActivityRunKind,
  type ActivityRunSummary,
  type AudioRun,
  type DeterministicRunKind,
} from "./domain.js";
import { normalizeMediaTags } from "./spec-normalization.js";
import type { RunAndAcceptOptions, RunOutcome, RunRequest } from "./run-request.js";
import { RUN_KINDS } from "./run-kinds/index.js";
import {
  RunRefusal,
  scriptRequired,
  type Acceptance,
  type AnyRunKind,
  type RunKindServices,
  type Observed,
  type ServerRunKind,
  type SessionRunKind,
  type StageInput,
} from "./run-kinds/contract.js";
import { modulePackagesRoot } from "./run-kinds/module.js";
import { assessmentKind } from "./run-kinds/assessment.js";
import { speechKind } from "./run-kinds/audio.js";
import { imageKind } from "./run-kinds/image.js";
import { mediaTextKind } from "./run-kinds/media-text.js";
import { phonemesKind } from "./run-kinds/phonemes.js";
import { videoKind } from "./run-kinds/video.js";
import { Sandbox, SandboxModule } from "../sandbox/service.js";
import { RUN_SANDBOX_MODE, sandboxUnavailable } from "./run-sandbox.js";

/** How long a Project's ElevenLabs voice list is reused before it is read again. */
const VOICE_LIBRARY_TTL_MS = 10 * 60 * 1000;

/** How far a cut may end past its recording, for rounding. */
const CUT_SLACK_MS = 50;

/** How often a run waited on is looked at besides being told when it ends. */
const SETTLE_CHECK_MS = 5000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Observer {
  unsubscribe: () => void;
  completed: boolean;
  error: string | null;
}

@Component()
export class ActivityGenerationService implements ActivityGeneration {
  @Use() private readonly projectWork!: ProjectActivityWork;
  @Use() private readonly config!: Config;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly agents!: AgentConfig;
  @Use() private readonly agentLifecycle!: AgentLifecycle;
  @Use() private readonly paths!: Paths;
  @Use() private readonly sessions!: Sessions;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly channels!: Channels;
  @Use() private readonly projects!: Projects;
  @Use() private readonly members!: Members;
  @Use() private readonly log!: Log;
  @Use() private readonly soundModels!: SoundModelPorts;
  @Use() private readonly localAudio!: LocalAudio;
  @Use() private readonly mediaHelper!: MediaHelperPorts;
  private readonly localRuns = new Map<string, AbortController>();
  @Use() private readonly settings!: Settings;
  @Use() private readonly wafWorkspace!: WafWorkspace;
  @Use() private readonly browser!: TestBrowser;
  @Use(SandboxModule) private readonly sandbox!: Sandbox;
  @Use() private readonly runs!: ActivityRuns;
  @Use() private readonly lock!: ActivityLock;
  @Use() private readonly outcomes!: ActivityOutcomes;
  @Use() private readonly clock!: Clock;
  private readonly observers = new Map<string, Observer>();
  /** What is waiting for a run to end, by run id: each looks at the run again when it does. */
  private readonly settling = new Map<string, Set<() => void>>();
  /** The test browser started for a confined run's checks, by run id; stopped when it ends. */
  private readonly browserServers = new Map<string, BrowserServerHandle>();
  private readonly operations = new Set<Promise<unknown>>();
  private stopped = false;
  private drained: Promise<void> | null = null;
  private tick: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  setup({ effect }: ClassCtx) {
    // A restart or hot replacement cannot prove an old task finished. Preserve its
    // workspace and record the uncertainty; retry always creates a new attempt.
    for (const run of this.runs.running())
      this.finish(run, "interrupted", "Server restarted. Review the session and retry explicitly.");
    this.timer = setInterval(() => {
      if (!this.tick && !this.stopped) {
        this.tick = this.reconcile()
          .catch((error: unknown) => {
            this.log.line(`[activities] Generation reconciliation failed: ${String(error)}`);
          })
          .finally(() => {
            this.tick = null;
          });
      }
    }, 1000);
    this.timer.unref();
    effect(() => this.stop());
  }

  private stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const controller of this.localRuns.values()) controller.abort();
    if (this.timer) clearInterval(this.timer);
    for (const observer of this.observers.values()) observer.unsubscribe();
    this.observers.clear();
    // Effects seal admissions synchronously. The App awaits shutdown's drain before
    // closing the DB or booting a successor, so an entered publication can commit its
    // matching terminal record before the remaining attempts become interrupted.
    const finishRemaining = () => {
      for (const run of this.runs.running())
        this.finish(run, "interrupted", "Server stopped before the result was published.");
    };
    if (this.operations.size) {
      this.drained = Promise.allSettled([...this.operations]).then(finishRemaining);
    } else {
      finishRemaining();
      this.drained = Promise.resolve();
    }
  }
  async shutdown(): Promise<void> {
    this.stop();
    await this.drained;
    await Promise.all(
      [...this.browserServers.values()].map((server) => server.close().catch(() => {})),
    );
    this.browserServers.clear();
  }

  /**
   * Starts the test browser for a confined run and returns where its checks connect, or
   * undefined when there is none to start. Its commands cannot start a browser themselves:
   * on Windows Chromium's process channel is refused to a restricted token.
   */
  private async serveBrowser(runId: string): Promise<string | undefined> {
    // The browser runs outside the sandbox, so it can open any file: with paths the
    // deployment hides from commands, handing it to the run would show them again. The
    // checks then report that they could not start the browser.
    if (this.sandbox.currentSettings().maskPaths?.length) return undefined;
    try {
      const server = (await this.browser.launchServer()) as BrowserServerHandle | null;
      if (server === null) return undefined;
      this.browserServers.set(runId, server);
      return server.endpoint;
    } catch (error) {
      // The checks then try to start the browser themselves and report why they could not.
      this.log.line(
        `[activities] test browser server for ${runId} did not start: ${String(error)}`,
      );
      return undefined;
    }
  }

  private workspace(run: ActivityRun): string {
    return this.runs.workspace(run.runId);
  }

  /** What a run kind may use of this engine. */
  private kindServices(): RunKindServices {
    return {
      activities: this.activities,
      wafWorkspace: this.wafWorkspace,
      browser: this.browser,
      soundModels: this.soundModels,
      localAudio: this.localAudio,
      mediaHelper: this.mediaHelper,
      root: this.config.root,
      workspace: (runId) => this.runs.workspace(runId),
      list: (projectId, activityId) => this.list(projectId, activityId),
      run: (projectId, activityId, runId) => this.getRun(projectId, activityId, runId),
      requireVideoExperiment: () => this.requireVideoExperiment(),
      videoTimeline: (projectId, activityId, language, assetKey) =>
        this.videoTimeline(projectId, activityId, language, assetKey),
      vaultKeys: async (projectId, agentId) =>
        (await this.agents.getVault(projectId, agentId)).entries.map((entry) => entry.key),
      elevenLabsDefaultVoice: (projectId) => this.defaultVoiceOf(projectId),
      serveBrowser: (runId) => this.serveBrowser(runId),
    };
  }

  /** Ends a run as `status`; `limit` names the limit the engine stopped it at, if it did. */
  private finish(
    run: ActivityRun,
    status: ActivityRun["status"],
    error: string | null = null,
    limit?: RunLimit,
  ) {
    run.status = status;
    run.error = error;
    run.finishedAt = new Date().toISOString();
    this.runs.save(run);
    if (status !== "running") this.outcomes.witness({ run, ...(limit ? { limit } : {}) });
    if (status !== "running")
      for (const check of [...(this.settling.get(run.runId) ?? [])]) check();
    this.observers.get(run.runId)?.unsubscribe();
    this.observers.delete(run.runId);
    const server = status === "running" ? undefined : this.browserServers.get(run.runId);
    if (server) {
      this.browserServers.delete(run.runId);
      void server.close().catch(() => {});
    }
    if (status !== "running") {
      publishToProjectUsers(
        this.channels as ChannelHub,
        this.projects,
        this.members,
        run.projectId,
        {
          type: "activity_run_finished",
          projectId: run.projectId,
          activityId: run.activityId,
          runId: run.runId,
          status,
        },
      );
    }
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
  }

  async list(projectId: string, activityId: string): Promise<ActivityRunSummary[]> {
    await this.activities.getActivity(projectId, activityId);
    return this.runs.summaries(projectId, activityId, { limit: 50 });
  }

  private async getRun(projectId: string, activityId: string, runId: string): Promise<ActivityRun> {
    await this.activities.getActivity(projectId, activityId);
    const run = this.runs.get(projectId, activityId, runId);
    if (!run) throw new HttpError(404, "run_not_found", "Generation not found.");
    return run;
  }

  /**
   * What an assist run's agent last proposed, read fresh each time: the Session goes on
   * after the run finishes, and each reply may replace the proposal. Null with no error
   * when there is none yet; an error, and no proposal, when the file is not one the studio
   * could apply.
   */
  async proposal(
    projectId: string,
    activityId: string,
    runId: string,
  ): Promise<{ proposal: AssistProposal | null; error: string | null }> {
    const run = await this.getRun(projectId, activityId, runId);
    if (run.kind !== "assist")
      throw new HttpError(404, "run_not_found", "That run is not a conversation.");
    let raw: string;
    try {
      raw = await readCandidate(path.join(this.workspace(run), PROPOSAL_FILE), PROPOSAL_MAX_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { proposal: null, error: null };
      return { proposal: null, error: (error as Error).message };
    }
    try {
      return { proposal: parseAssistProposal(raw), error: null };
    } catch (error) {
      return { proposal: null, error: (error as Error).message };
    }
  }

  async discardProposal(projectId: string, activityId: string, runId: string): Promise<void> {
    const run = await this.getRun(projectId, activityId, runId);
    if (run.kind !== "assist")
      throw new HttpError(404, "run_not_found", "That run is not a conversation.");
    const workspace = this.workspace(run);
    // Renamed, not deleted: what the agent proposed stays with the rest of its run.
    await fs
      .rename(path.join(workspace, PROPOSAL_FILE), path.join(workspace, DISCARDED_PROPOSAL_FILE))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    this.outcomes.witness({ run });
  }

  /**
   * Gives a Project created before the Media Agent existed that Agent, the Agents list's own
   * way (AgentLifecycle.provisionMissingBuiltins); one already on disk is left as it is.
   */
  private async provisionMediaAgent(projectId: string): Promise<void> {
    if (await this.agents.exists(projectId, MEDIA_AGENT_ID)) return;
    await this.agentLifecycle.provisionMissingBuiltins(projectId);
  }

  /** Which sound providers the Media Agent can use now, judged by the keys its Vault holds. */
  async soundSetup(projectId: string): Promise<SoundSetup> {
    await this.provisionMediaAgent(projectId);
    const keys = (await this.agents.getVault(projectId, MEDIA_AGENT_ID)).entries.map(
      (entry) => entry.key,
    );
    return {
      providers: soundSetup(keys, this.soundModels.agenthubModels, this.localAudio.availability()),
    };
  }

  /**
   * The voices and speech providers the picker offers: which providers the Media Agent's
   * Vault has keys for. Key names only, a value is never read; the ElevenLabs library is
   * `elevenLabsVoices`.
   */
  async speechSetup(projectId: string): Promise<SpeechSetup> {
    const base = {
      provider: "Gemini",
      model: SPEECH_MODEL,
      voices: SPEECH_VOICES,
      vaultKey: "GEMINI_API_KEY",
    };
    await this.provisionMediaAgent(projectId);
    const keys = (await this.agents.getVault(projectId, MEDIA_AGENT_ID)).entries.map(
      (entry) => entry.key,
    );
    return {
      ...base,
      catalogue: speechCatalogue(),
      providers: speechSetup(keys, this.localAudio.availability()),
    };
  }

  /** The last library read per Project, with the key and default voice it was read for. */
  private readonly voiceLibraries = new Map<
    string,
    { fingerprint: string; at: number; voices: VoiceOption[] }
  >();

  /**
   * The voice the default ElevenLabs voice speaks with in this Project: the Media Agent's
   * Vault ELEVENLABS_VOICE_ID, else Loom's. The speech step compares bound clips with it.
   */
  async elevenLabsDefaultVoice(projectId: string): Promise<string> {
    await this.provisionMediaAgent(projectId);
    return this.defaultVoiceOf(projectId);
  }

  private async defaultVoiceOf(projectId: string): Promise<string> {
    const vault = await loadAgentVault(this.paths.root, projectId, MEDIA_AGENT_ID);
    return elevenLabsDefaultVoiceId(vault[ELEVENLABS_VOICE_KEY]);
  }

  /**
   * The ElevenLabs voices the Media Agent's account can speak with, the default first and named,
   * for the voice picker. The Media Agent's ELEVENLABS_API_KEY is sent to ElevenLabs' voice
   * list and nowhere else; its ELEVENLABS_VOICE_ID says which voice the default is. A list is
   * kept ten minutes per Project and key; `refresh` reads it again.
   */
  async elevenLabsVoices(projectId: string, refresh = false): Promise<ElevenLabsVoices> {
    await this.provisionMediaAgent(projectId);
    const vault = await loadAgentVault(this.paths.root, projectId, MEDIA_AGENT_ID);
    const key = vault.ELEVENLABS_API_KEY?.trim();
    if (!key) return { voices: [ELEVENLABS_DEFAULT_OPTION], problem: "credential_missing" };
    const defaultVoiceId = elevenLabsDefaultVoiceId(vault[ELEVENLABS_VOICE_KEY]);
    const fingerprint = createHash("sha256").update(`${key}\n${defaultVoiceId}`).digest("hex");
    const cached = this.voiceLibraries.get(projectId);
    if (
      !refresh &&
      cached?.fingerprint === fingerprint &&
      Date.now() - cached.at < VOICE_LIBRARY_TTL_MS
    )
      return { voices: cached.voices };
    try {
      const voices = withDefaultFirst(
        ELEVENLABS_DEFAULT_OPTION,
        defaultVoiceId,
        await listElevenLabsVoices(key),
      );
      this.voiceLibraries.set(projectId, { fingerprint, at: Date.now(), voices });
      return { voices };
    } catch (error) {
      if (!(error instanceof ElevenLabsVoicesError)) throw error;
      return { voices: [ELEVENLABS_DEFAULT_OPTION], problem: error.problem };
    }
  }

  run(projectId: string, activityId: string, runId: string): Promise<ActivityRun> {
    return this.getRun(projectId, activityId, runId);
  }

  async candidate(projectId: string, activityId: string, runId: string): Promise<string | null> {
    return (await this.getRun(projectId, activityId, runId)).candidate;
  }

  start(
    projectId: string,
    activityId: string,
    requestedAgentId: string,
    expectedRevision: string,
    request: RunRequest,
    runtime?: { codingAgentId?: string },
  ): Promise<ActivityRun> {
    const kind: AnyRunKind = RUN_KINDS[request.kind];
    // Speech, sound and image runs belong to the Media Agent whichever agent or coding agent
    // the author chose: their helpers read the provider keys from its Vault.
    const agentId = kind.mediaAgent ? MEDIA_AGENT_ID : requestedAgentId;
    const codingAgentId = kind.mediaAgent ? undefined : runtime?.codingAgentId;
    return this.track(
      this.projectWork.run(projectId, () =>
        this.lock.run(activityId, async () => {
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          // Scene videos are refused while the experiment is off, before anything about the
          // draft is checked, so an author always learns first that the experiment is off.
          if (kind.experimental) this.requireVideoExperiment();
          const activity = await this.activities.getActivity(projectId, activityId);
          if (activity.draft.contentRevision !== expectedRevision)
            throw new HttpError(
              409,
              "draft_conflict",
              "Save or reload the draft before generating.",
            );
          if (kind.needsScript && !activity.draft.description.trim()) throw scriptRequired();
          const services = this.kindServices();
          const prepared: unknown = await kind.check(services, request, activity, projectId);
          // A run that needs no agent (decision 17) is the server's own work: nobody's agent's,
          // with no Session and no sandbox.
          const work = kind.runner === "session" ? (kind.serverWork?.(prepared) ?? null) : null;
          // The module stage comes minutes after the first stages: its packages are installed
          // into the shared cache meanwhile, so it links them rather than waiting on npm.
          void (this.mediaHelper.warmModuleDependencies ?? warmModuleDependencies)(
            MODULE_PACKAGES,
            modulePackagesRoot(this.config.root),
          );
          if (kind.mediaAgent) await this.provisionMediaAgent(projectId);
          // A coding agent's run is still a Session, filed under a Penguin Agent: the one
          // named, or the Project's default Agent when only the coding agent was.
          const owner = agentId || (codingAgentId ? DEFAULT_AGENT_ID : agentId);
          await this.agents.requireExists(projectId, owner);
          await kind.authorize?.(services, prepared, { projectId, agentId });
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          if (this.runs.hasActive(activityId))
            throw new HttpError(
              409,
              "generation_running",
              "This activity already has a running generation.",
            );
          const run = {
            kind: kind.run,
            ...kind.record(prepared),
            runId: newId("run"),
            activityId,
            projectId,
            draftId: activity.draft.draftId,
            inputRevision: activity.draft.contentRevision,
            agentId: work ? "" : owner,
            ...(codingAgentId && !work ? { codingAgentId } : {}),
            sessionId: null,
            status: "running",
            createdAt: new Date().toISOString(),
            finishedAt: null,
            error: null,
            candidate: null,
          } as ActivityRun;
          // A model on this machine runs no agent, and a coding agent runs its commands itself,
          // outside Penguin's sandbox.
          const local = kind.runner === "server" ? kind.local(prepared) : null;
          // Penguin's own agent runs a stage's commands confined to the run's workspace, so
          // the WAF checkout is read-only to them by enforcement, not by the prompt's word —
          // unless an admin turned confinement off for this server (System settings > WAF
          // workspace). With nothing able to confine, the run is refused here rather than left
          // to fail at its first command.
          const confined =
            !work && !codingAgentId && !local && this.settings.getConfineActivityAgents();
          if (confined) {
            const problem = this.sandbox.confinementProblem(RUN_SANDBOX_MODE);
            if (problem !== null) throw sandboxUnavailable(problem);
          }
          this.runs.open(run);
          this.outcomes.witness({ run });
          try {
            const workspace = this.workspace(run);
            await fs.mkdir(workspace, { recursive: true });
            if (local) {
              await atomicJson(path.join(workspace, "local-audio-input.json"), local);
              if (this.stopped)
                throw new HttpError(503, "activity_stopping", "Server is stopping.");
              const controller = new AbortController();
              this.localRuns.set(run.runId, controller);
              this.outcomes.witness({ run, server: `local:${local.provider}/${local.model}` });
              void this.track(this.generateLocal(run, local, controller)).catch(
                (error: unknown) => {
                  this.log.line(`[activities] Local audio settlement failed: ${String(error)}`);
                },
              );
              return run;
            }
            // Requirement hashes track editorial changes, not media file bytes. They belong
            // to draft reconciliation; exposing them to a generator invites false checksum claims.
            const description = normalizeMediaTags(activity.draft.description);
            const input = {
              ...activity,
              ...kind.input?.(prepared),
              draft: {
                ...activity.draft,
                description,
                ...(activity.draft.mediaPlan
                  ? { mediaPlan: { manifest: activity.draft.mediaPlan.manifest } }
                  : {}),
              },
            };
            await atomicJson(path.join(workspace, "input.json"), input);
            await fs.writeFile(path.join(workspace, "description.md"), description, "utf8");
            const stage: StageInput<unknown, ActivityRun> = {
              services,
              activity,
              prepared,
              run,
              workspace,
              confined,
              description,
              expectedRevision,
            };
            const staged: unknown = await kind.stage(stage);
            if (work && kind.runner === "session") {
              if (this.stopped)
                throw new HttpError(503, "activity_stopping", "Server is stopping.");
              // What the kind recorded on the run as it staged it is kept before the work
              // starts, as it is before a Session's.
              this.runs.save(run);
              const controller = new AbortController();
              this.localRuns.set(run.runId, controller);
              void this.track(
                this.workOnServer(run, kind, () => work(stage, controller.signal), controller),
              ).catch((error: unknown) => {
                this.log.line(`[activities] Server work settlement failed: ${String(error)}`);
              });
              return run;
            }
            if (kind.runner === "server") {
              // Speech and sound need no agent: the server runs the staged helper itself, as
              // Loom's audio stage calls its provider, and collects the clip as a Session's
              // would be. agenthub is installed first for Gemini speech and hub models.
              if (this.stopped)
                throw new HttpError(503, "activity_stopping", "Server is stopping.");
              const controller = new AbortController();
              this.localRuns.set(run.runId, controller);
              const helper = kind.helper(prepared);
              this.outcomes.witness({ run, server: `helper:${helper.script}` });
              void this.track(this.generateAudio(run as AudioRun, kind, helper, controller)).catch(
                (error: unknown) => {
                  this.log.line(`[activities] Audio settlement failed: ${String(error)}`);
                },
              );
              return run;
            }
            if (this.stopped) {
              this.finish(run, "interrupted", "Server stopped before generation started.");
              return run;
            }
            const prompt = kind.prompt(stage, staged);
            const protectedRoots = kind.protectedRoots?.(stage);
            const session = await this.sessionService.createSession({
              projectId,
              agentId: owner,
              // A coding agent runs the stage as an ordinary Session of its own model: the
              // same Trace, approvals, completion signal and collection as a Penguin agent's.
              ...(codingAgentId ? { provider: CODING_AGENT_PROVIDER, modelId: codingAgentId } : {}),
              workspace,
              ...(protectedRoots ? { protectedRoots } : {}),
              // Stages run unattended, so every tool call is approved; a protected root is
              // still refused, whatever the approval mode allows.
              approvalMode: "allow-all",
              // A coding agent runs its own commands; Penguin's sandbox cannot reach them.
              ...(confined ? { sandboxMode: RUN_SANDBOX_MODE } : {}),
            });
            run.sessionId = session.sessionId;
            // Saved before the task starts, on purpose: what the kind recorded on the run as it
            // staged it is kept before the agent can touch what was staged.
            this.runs.save(run);
            // The model as the Session was created with it: a Project default is resolved there.
            this.outcomes.witness({
              run,
              prompt,
              session: { provider: session.provider, modelId: session.modelId },
            });
            if (this.stopped) {
              this.finish(run, "interrupted", "Server stopped before generation started.");
              return run;
            }
            const observer: Observer = { unsubscribe: () => {}, completed: false, error: null };
            observer.unsubscribe = this.channels.get(session.sessionId).subscribe((event) => {
              if (event.event) return;
              const msg = JSON.parse(event.data) as {
                origin?: unknown[];
                payload?: { type?: string; status?: string; error_message?: string };
              };
              if (msg.origin?.length) return;
              const payload = msg.payload;
              if (payload?.type === "request_begin") observer.completed = false;
              if (payload?.type === "request_end") {
                observer.completed = payload.status === "completed";
                observer.error = observer.completed
                  ? null
                  : (payload.error_message ?? "The model request did not complete.");
              }
              if (payload?.type === "abort") {
                observer.completed = false;
                observer.error = "Session was stopped.";
              }
            });
            this.observers.set(run.runId, observer);
            await this.sessions.startTask(session.sessionId, [userText(prompt)], {
              queueIfBusy: false,
            });
          } catch (error) {
            this.finish(
              run,
              this.stopped ? "interrupted" : "failed",
              error instanceof HttpError
                ? error.message
                : "Could not start generation. Check the agent and model configuration.",
            );
          }
          return run;
        }),
      ),
    );
  }

  cancel(projectId: string, activityId: string, runId: string): Promise<ActivityRun> {
    return this.track(
      this.lock.run(activityId, async () => {
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        const run = await this.getRun(projectId, activityId, runId);
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        if (run.status === "running") {
          this.finish(run, "cancelled", "Generation cancelled.");
          this.localRuns.get(runId)?.abort();
          if (run.sessionId) this.sessions.abortTask(run.sessionId);
        }
        return run;
      }),
    );
  }

  private async generateLocal(
    run: ActivityRun,
    request: LocalAudioRequest,
    controller: AbortController,
  ): Promise<void> {
    try {
      const bytes = await this.localAudio.generate(request, controller.signal);
      await this.projectWork.run(run.projectId, () =>
        this.lock.run(run.activityId, async () => {
          const currentRun = await this.getRun(run.projectId, run.activityId, run.runId);
          if (currentRun.status !== "running" || this.stopped || controller.signal.aborted) return;
          const current = await this.activities.getActivity(run.projectId, run.activityId);
          if (current.draft.contentRevision !== run.inputRevision) {
            this.finish(currentRun, "conflict", "The draft changed during local audio generation.");
            return;
          }
          const result = await this.activities.storeAudio(
            run.projectId,
            run.activityId,
            run.runId,
            bytes,
          );
          currentRun.candidate = JSON.stringify(result);
          this.finish(currentRun, "succeeded");
        }),
      );
    } catch (error) {
      await this.lock.run(run.activityId, async () => {
        const current = await this.getRun(run.projectId, run.activityId, run.runId);
        if (current.status !== "running") return;
        this.finish(
          current,
          this.stopped ? "interrupted" : "failed",
          error instanceof Error ? error.message : "Local audio generation failed.",
        );
      });
    } finally {
      this.localRuns.delete(run.runId);
    }
  }

  /**
   * A speech or sound run's helper, run by the server: no Session, no model request. What it
   * wrote is collected as a Session's would be; a failure is the helper's own words.
   */
  private async generateAudio(
    run: AudioRun,
    kind: ServerRunKind<RunRequest, unknown, AudioRun>,
    helper: { script: MediaHelperScript; install: boolean },
    controller: AbortController,
  ): Promise<void> {
    const failed = async (error: unknown) => {
      await this.lock.run(run.activityId, async () => {
        const current = await this.getRun(run.projectId, run.activityId, run.runId);
        if (current.status !== "running") return;
        this.finish(
          current,
          this.stopped ? "interrupted" : "failed",
          error instanceof Error ? error.message : "Audio generation failed.",
        );
      });
    };
    try {
      const vault = await loadAgentVault(this.paths.root, run.projectId, MEDIA_AGENT_ID);
      const runHelper = this.mediaHelper.runHelper ?? runMediaHelper;
      const outcome = await runHelper({
        workspace: this.workspace(run),
        ...helper,
        // agenthub is installed once per version and shared by every run.
        cacheDir: path.join(this.config.root, "media-helper-cache"),
        vault,
        signal: controller.signal,
      });
      if (!outcome.ok) {
        await failed(new Error(outcome.error));
        return;
      }
      await this.lock.run(run.activityId, async () => {
        const current = (await this.getRun(run.projectId, run.activityId, run.runId)) as AudioRun;
        if (current.status !== "running" || this.stopped || controller.signal.aborted) return;
        try {
          const { draftChanged } = await kind.collect({
            services: this.kindServices(),
            run: current,
            workspace: this.workspace(current),
            observed: undefined,
            stopping: () => this.stopped,
            save: (saved) => this.runs.save(saved),
          });
          await this.succeedIfDraftUnchanged(current, draftChanged);
        } catch (error) {
          const conflict = error instanceof HttpError && error.code === "draft_conflict";
          this.finish(
            current,
            conflict ? "conflict" : "failed",
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? `The ${helper.script} helper ended without ${kind.missing(current)}.`
              : error instanceof Error
                ? error.message
                : "Could not collect the clip.",
          );
        }
      });
    } catch (error) {
      await failed(error);
    } finally {
      this.localRuns.delete(run.runId);
    }
  }

  /**
   * A Session kind's run whose work the server does itself (decision 17): what the work wrote is
   * collected as a completed Session's would be; a failure is the work's own words. A run
   * cancelled, or a server stopping, meanwhile is left as it is.
   */
  private async workOnServer(
    run: ActivityRun,
    kind: SessionKind,
    work: () => Promise<void>,
    controller: AbortController,
  ): Promise<void> {
    try {
      const failure = await work().then(
        () => null,
        (error: unknown) => ({ error }),
      );
      await this.lock.run(run.activityId, async () => {
        const current = this.runs.get(run.projectId, run.activityId, run.runId);
        if (!current || current.status !== "running" || this.stopped || controller.signal.aborted)
          return;
        if (failure) this.finish(current, "failed", messageOf(failure.error));
        else await this.settle(current, kind, { completed: true, error: null });
      });
    } finally {
      this.localRuns.delete(run.runId);
    }
  }

  /**
   * Ends a run as its kind's `collect` settles what its agent, or the server in its place, wrote.
   * A failure to collect fails the run, or makes it a conflict when the draft changed.
   */
  private async settle(
    run: ActivityRun,
    kind: SessionKind,
    observed: Observed | undefined,
  ): Promise<void> {
    try {
      const settlement = await kind.collect({
        services: this.kindServices(),
        run,
        workspace: this.workspace(run),
        observed,
        stopping: () => this.stopped,
        save: (saved) => this.runs.save(saved),
      });
      if (!settlement) return;
      if ("settled" in settlement) {
        this.finish(
          run,
          settlement.settled,
          settlement.settled === "failed" ? settlement.error : null,
        );
        return;
      }
      if (this.stopped) return;
      if (settlement.apply) {
        // Cancellation and completion share the activity lock. The run applies its own
        // result, whoever started it.
        await this.outcomes.attribute({ actor: "run", runId: run.runId }, settlement.apply);
        this.finish(run, "succeeded");
      } else if (settlement.draftChanged)
        await this.succeedIfDraftUnchanged(run, settlement.draftChanged, settlement.verify);
      else this.finish(run, "succeeded");
    } catch (error) {
      if (this.stopped && run.candidate === null) return;
      const conflict = error instanceof HttpError && error.code === "draft_conflict";
      kind.failed?.(run, error);
      const message =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? `The session ended without ${kind.missing ?? kind.outputs.join(" or ")}.`
          : error instanceof Error
            ? error.message
            : "Could not collect generation output.";
      this.finish(run, conflict ? "conflict" : "failed", message);
    }
  }

  /**
   * Succeeds a run that kept its candidate, as long as the draft is still the one the run
   * started from: `draft_conflict`, with this message, when it is not.
   */
  private succeedIfDraftUnchanged(
    run: ActivityRun,
    draftChanged: string,
    verify?: () => Promise<void>,
  ): Promise<void> {
    return this.projectWork.run(run.projectId, async () => {
      await verify?.();
      const current = await this.activities.getActivity(run.projectId, run.activityId);
      if (current.draft.contentRevision !== run.inputRevision)
        throw new HttpError(409, "draft_conflict", draftChanged);
      this.finish(run, "succeeded");
    });
  }

  openDeterministic(
    projectId: string,
    activityId: string,
    kind: DeterministicRunKind,
    target?: { video?: VideoTarget },
  ): Promise<ActivityRun> {
    return this.track(
      this.lock.run(activityId, async () => {
        if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
        const activity = await this.activities.getActivity(projectId, activityId);
        if (this.runs.hasActive(activityId))
          throw new HttpError(
            409,
            "generation_running",
            "This activity already has a running generation.",
          );
        const run = {
          kind,
          runId: newId("run"),
          activityId,
          projectId,
          draftId: activity.draft.draftId,
          inputRevision: activity.draft.contentRevision,
          ...(kind === "video" && target?.video ? { video: target.video } : {}),
          // Nobody's agent does this work; the server does.
          agentId: "",
          sessionId: null,
          status: "running",
          createdAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
          candidate: null,
        } as ActivityRun;
        this.runs.open(run);
        this.outcomes.witness({ run });
        await fs.mkdir(this.workspace(run), { recursive: true });
        return run;
      }),
    );
  }

  settleDeterministic(
    projectId: string,
    activityId: string,
    runId: string,
    status: "succeeded" | "failed",
    error: string | null,
    candidate?: string,
    videoProblem?: VideoProblemCode,
    videoCheck?: VideoCheck,
  ): Promise<boolean> {
    return this.track(
      this.lock.run(activityId, async () => {
        if (this.stopped) return false;
        const run = await this.getRun(projectId, activityId, runId);
        if (run.status !== "running" || run.sessionId) return false;
        if (status === "succeeded" && candidate !== undefined) run.candidate = candidate;
        if (status === "failed" && videoProblem && run.video)
          run.video = { ...run.video, problem: videoProblem };
        if (status === "succeeded" && videoCheck && run.video)
          run.video = { ...run.video, check: videoCheck };
        // The kept result says whether captions were kept beside the video; the run says it too,
        // so the studio knows without reading the result.
        if (status === "succeeded" && run.video && candidate !== undefined) {
          const kept = JSON.parse(candidate) as { captions?: unknown };
          if (kept.captions === true) run.video = { ...run.video, captions: true };
        }
        this.finish(run, status, error);
        return true;
      }),
    );
  }

  async isRunning(projectId: string, activityId: string, runId: string): Promise<boolean> {
    return this.runs.get(projectId, activityId, runId)?.status === "running";
  }

  async latestRun(
    projectId: string,
    activityId: string,
    kind: ActivityRun["kind"],
    status: ActivityRun["status"],
  ): Promise<ActivityRunSummary | null> {
    await this.activities.getActivity(projectId, activityId);
    return this.runs.summaries(projectId, activityId, { kind, status, limit: 1 })[0] ?? null;
  }

  async moduleBuilds(projectId: string, activityId: string): Promise<ActivityRunSummary[]> {
    await this.activities.getActivity(projectId, activityId);
    return this.runs.summaries(projectId, activityId, { kind: "module", status: "succeeded" });
  }

  async audioContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array> {
    const run = await this.getRun(projectId, activityId, runId).catch((error: unknown) => {
      if (error instanceof HttpError && error.code === "run_not_found") return null;
      throw error;
    });
    if (!run) {
      // A ref made from its template keeps the template's accepted clips, but not the runs
      // that made them; a clip this draft binds is still this ref's to play.
      const activity = await this.activities.getActivity(projectId, activityId);
      const bound = Object.values(activity.draft.mediaPlan?.manifest.assets ?? {})
        .flat()
        .find((asset) => asset.generatedAudio?.runId === runId)?.generatedAudio;
      if (!bound) throw new HttpError(404, "run_not_found", "Speech candidate not available.");
      return this.activities.readAudio(projectId, activityId, runId, bound.sha256, bound.format);
    }
    if (run.kind !== "audio" || !run.candidate || !["succeeded", "conflict"].includes(run.status))
      throw new HttpError(404, "run_not_found", "Speech candidate not available.");
    const result = JSON.parse(run.candidate) as AudioResult;
    return this.activities.readAudio(projectId, activityId, runId, result.sha256, result.format);
  }
  async imageCandidateContent(
    projectId: string,
    activityId: string,
    runId: string,
  ): Promise<Uint8Array> {
    const run = await this.getRun(projectId, activityId, runId);
    if (run.kind !== "image" || !run.candidate || !["succeeded", "conflict"].includes(run.status))
      throw new HttpError(404, "run_not_found", "Image candidate not available.");
    const result = JSON.parse(run.candidate) as ImageResult;
    if (result.runId !== runId)
      throw new HttpError(409, "image_changed", "Image candidate metadata changed.");
    return this.activities.readImage(projectId, activityId, runId, result.sha256);
  }
  /**
   * Accepts a successful candidate of a kind into the draft, as its kind says: only a run that
   * succeeded with one, and only on the draft it started from.
   */
  private accept<Run extends ActivityRun>(
    kind: { run: ActivityRunKind; experimental?: true; accept?: Acceptance<Run> },
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    const acceptance = kind.accept!;
    return this.track(
      this.projectWork.run(projectId, () =>
        this.lock.run(activityId, async () => {
          if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
          if (kind.experimental) this.requireVideoExperiment();
          const run = await this.getRun(projectId, activityId, runId);
          if (
            run.kind !== kind.run ||
            run.status !== "succeeded" ||
            !run.candidate ||
            !(acceptance.ready?.(run as Run) ?? true)
          )
            throw new HttpError(409, acceptance.changed.code, acceptance.changed.message);
          if (run.inputRevision !== expectedRevision)
            throw await acceptance.draftChanged(this.kindServices(), run as Run);
          // The draft change accepts this run, made by whoever asked: an author or the Stages.
          return this.outcomes.attribute({ runId }, () =>
            acceptance.apply(
              this.kindServices(),
              run as Run & { candidate: string },
              expectedRevision,
            ),
          );
        }),
      ),
    );
  }

  /**
   * Starts a run, waits for it to end, and accepts what it made: the whole of what an author
   * does by hand, as one call. A refusal its kind marks as a skip starts nothing; the draft must
   * still be the one the run started from when its candidate is accepted.
   */
  async runAndAccept(
    projectId: string,
    activityId: string,
    request: RunRequest,
    options: RunAndAcceptOptions,
  ): Promise<RunOutcome> {
    const kind: AnyRunKind = RUN_KINDS[request.kind];
    let run: ActivityRun;
    try {
      const activity = await this.activities.getActivity(projectId, activityId);
      run = await this.start(
        projectId,
        activityId,
        options.agentId,
        activity.draft.contentRevision,
        request,
        options.runtime,
      );
    } catch (error) {
      if (error instanceof RunRefusal)
        return { outcome: "skipped", reason: error.skip, message: error.message };
      return { outcome: "failed", error: messageOf(error) };
    }
    options.started?.(run);
    let settled: ActivityRun | null;
    try {
      settled = await this.settled(run, options.signal);
    } catch (error) {
      return { outcome: "failed", run, error: messageOf(error) };
    }
    // A run that ended as the caller stopped is not accepted: nothing after a stop runs.
    if (!settled || options.signal?.aborted)
      return { outcome: "stopped", ...(settled ? { run: settled } : {}) };
    if (settled.status !== "succeeded")
      return {
        outcome: "failed",
        run: settled,
        error: settled.error ?? `The ${settled.kind} run ended as ${settled.status}.`,
      };
    if (!kind.accept) return { outcome: "succeeded", run: settled };
    try {
      // Accepted on the draft as it is now, which accepting refuses unless it is still the one
      // the run started from.
      const current = await this.activities.getActivity(projectId, activityId);
      const draft = await this.accept(
        kind,
        projectId,
        activityId,
        run.runId,
        current.draft.contentRevision,
      );
      return { outcome: "accepted", run: settled, draft };
    } catch (error) {
      return { outcome: "failed", run: settled, error: messageOf(error) };
    }
  }

  /**
   * The run once it has ended, read again; null when the signal is aborted first. Told by
   * `finish` the moment it ends, and looked at now and then besides, since a run whose
   * project is deleted never ends.
   */
  private settled(run: ActivityRun, signal?: AbortSignal): Promise<ActivityRun | null> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return resolve(null);
      const waiting = this.settling.get(run.runId) ?? new Set<() => void>();
      this.settling.set(run.runId, waiting);
      const done = () => {
        clearInterval(timer);
        signal?.removeEventListener("abort", aborted);
        waiting.delete(check);
        if (!waiting.size && this.settling.get(run.runId) === waiting)
          this.settling.delete(run.runId);
      };
      const aborted = () => {
        done();
        resolve(null);
      };
      const check = () => {
        const current = this.runs.get(run.projectId, run.activityId, run.runId);
        if (!current) {
          done();
          reject(new Error(`Run ${run.runId} is no longer in the history.`));
        } else if (current.status !== "running") {
          done();
          resolve(current);
        }
      };
      const timer = setInterval(check, SETTLE_CHECK_MS);
      timer.unref();
      waiting.add(check);
      signal?.addEventListener("abort", aborted, { once: true });
      check();
    });
  }

  acceptImage(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.accept(imageKind, projectId, activityId, runId, expectedRevision);
  }
  acceptVideo(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.accept(videoKind, projectId, activityId, runId, expectedRevision);
  }
  acceptMediaText(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.accept(mediaTextKind, projectId, activityId, runId, expectedRevision);
  }
  acceptAssessment(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.accept(assessmentKind, projectId, activityId, runId, expectedRevision);
  }
  acceptPhonemes(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    return this.accept(phonemesKind, projectId, activityId, runId, expectedRevision);
  }
  acceptAudio(projectId: string, activityId: string, runId: string, expectedRevision: string) {
    // A sound run is an audio run too, accepted the same way as speech.
    return this.accept(speechKind, projectId, activityId, runId, expectedRevision);
  }

  async videoContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array> {
    const run = await this.getRun(projectId, activityId, runId).catch((error: unknown) => {
      if (error instanceof HttpError && error.code === "run_not_found") return null;
      throw error;
    });
    if (!run) {
      // A ref made from its template keeps the template's accepted recordings, but not the
      // runs that made them; a recording this draft binds is still this ref's to play.
      const activity = await this.activities.getActivity(projectId, activityId);
      const bound = Object.values(activity.draft.mediaPlan?.manifest.assets ?? {})
        .flat()
        .find((asset) => asset.generatedVideo?.runId === runId)?.generatedVideo;
      if (!bound) throw new HttpError(404, "run_not_found", "Video candidate not available.");
      return this.activities.readVideo(
        projectId,
        activityId,
        runId,
        bound.sha256,
        bound.format ?? "webm",
      );
    }
    if (run.kind !== "video" || !run.candidate || !["succeeded", "conflict"].includes(run.status))
      throw new HttpError(404, "run_not_found", "Video candidate not available.");
    const result = JSON.parse(run.candidate) as VideoResult;
    if (result.runId !== runId)
      throw new HttpError(409, "video_changed", "Video candidate metadata changed.");
    return this.activities.readVideo(
      projectId,
      activityId,
      runId,
      result.sha256,
      result.format ?? "webm",
    );
  }
  /**
   * The cuts of a timeline that end after their recording does: FFmpeg would stop at the
   * recording's end while every later cut and fade counted on the time asked for.
   */
  private async cutIssues(
    projectId: string,
    activityId: string,
    timeline: VideoTimeline,
  ): Promise<TimelineIssue[]> {
    const lengths = new Map<string, number | null>();
    const issues: TimelineIssue[] = [];
    for (const cut of timeline.cuts) {
      if (!lengths.has(cut.source.runId)) {
        const run = await this.getRun(projectId, activityId, cut.source.runId).catch(() => null);
        lengths.set(cut.source.runId, run?.video ? Math.round(run.video.seconds * 1000) : null);
      }
      const length = lengths.get(cut.source.runId);
      if (length != null && cut.outMs > length + CUT_SLACK_MS)
        issues.push({ code: "cut_past_recording", asset: cut.id });
    }
    return issues;
  }

  async videoTimeline(
    projectId: string,
    activityId: string,
    language: string,
    assetKey: string,
  ): Promise<VideoTimelineView> {
    this.requireVideoExperiment();
    const activity = await this.activities.getActivity(projectId, activityId);
    const assets = activity.draft.mediaPlan?.manifest.assets[language] ?? [];
    const asset = assets.find(
      (entry) => entry.key === assetKey && (entry.type === "video" || entry.type === "animation"),
    );
    if (!asset)
      throw new HttpError(404, "asset_not_found", "The media plan has no such video or animation.");
    if (asset.timeline)
      return {
        timeline: asset.timeline,
        saved: true,
        issues: [
          ...timelineIssues(asset.timeline, assets),
          ...(await this.cutIssues(projectId, activityId, asset.timeline)),
        ],
      };
    // The newest recording of this asset that came out; runs are listed newest first.
    for (const summary of await this.list(projectId, activityId)) {
      if (
        summary.kind !== "video" ||
        summary.status !== "succeeded" ||
        summary.video?.language !== language ||
        summary.video.assetKey !== assetKey ||
        // A finished video is what a timeline makes, never what it starts from.
        summary.video.fromTimeline
      )
        continue;
      const run = await this.getRun(projectId, activityId, summary.runId);
      if (!run.candidate || !run.video) continue;
      const result = JSON.parse(run.candidate) as VideoResult;
      const timeline = defaultTimeline(assets, assetKey, {
        runId: result.runId,
        sha256: result.sha256,
        format: result.format ?? "webm",
        seconds: run.video.seconds,
        width: run.video.width,
        height: run.video.height,
        fps: RENDER_FPS,
      });
      return { timeline, saved: false, issues: timelineIssues(timeline, assets) };
    }
    throw new HttpError(
      409,
      "video_recording_missing",
      "Record the scene's video first: a timeline starts from a recording.",
    );
  }
  /** Whether an admin turned the scene-video experiment on. */
  videoExperiment(): boolean {
    return readVideoExperiment(this.settings.get(VIDEO_EXPERIMENT_SETTING));
  }

  requireVideoExperiment(): void {
    if (!this.videoExperiment()) throw experimentOff();
  }

  /**
   * One file of a kept composition, for the preview origin to serve: the page, one of its
   * staged images, or the vendored scripts. The page and images are served only while their
   * bytes are the ones checked and staged; anything else is 404.
   */
  async compositionFile(
    projectId: string,
    activityId: string,
    runId: string,
    rawPath: string,
  ): Promise<CompositionFileContent> {
    const missing = () =>
      new HttpError(404, "composition_not_found", "Composition file not found.");
    const run = await this.getRun(projectId, activityId, runId);
    if (
      run.kind !== "composition" ||
      !run.composition ||
      !run.candidate ||
      !["succeeded", "conflict"].includes(run.status)
    )
      throw missing();
    let file: string;
    try {
      file = decodeURIComponent(rawPath);
    } catch {
      throw missing();
    }
    if (file === COMPOSITION_GSAP_FILE)
      return { contentType: "text/javascript; charset=utf-8", body: await gsapSource() };
    if (file === COMPOSITION_BRIDGE_FILE)
      return {
        contentType: "text/javascript; charset=utf-8",
        body: Buffer.from(COMPOSITION_BRIDGE, "utf8"),
      };
    if (file === COMPOSITION_LOOK_FILE) {
      const look = run.composition.look ? sceneLook(run.composition.look) : null;
      if (!look) throw missing();
      return { contentType: "text/css; charset=utf-8", body: Buffer.from(look.css, "utf8") };
    }
    const expected =
      file === COMPOSITION_FILE
        ? (JSON.parse(run.candidate) as CompositionCandidate).sha256
        : run.composition.images.find((image) => image.file === file)?.sha256;
    if (!expected) throw missing();
    let bytes: Buffer;
    try {
      bytes = await readArtifactBytes(
        path.join(this.workspace(run), ...file.split("/")),
        file === COMPOSITION_FILE ? COMPOSITION_MAX_BYTES : COMPOSITION_IMAGE_MAX_BYTES,
      );
    } catch {
      throw missing();
    }
    // Changed since it was checked or staged: the Session may still be writing here.
    if (sha256(bytes) !== expected) throw missing();
    return {
      contentType: file === COMPOSITION_FILE ? "text/html; charset=utf-8" : mediaContentType(file),
      body: bytes,
    };
  }

  /** Deterministic reconciliation entry used by the timer and lifecycle tests. */
  reconcile(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.track(this.collect());
  }

  private async collect(): Promise<void> {
    if (this.stopped) return;
    const active = this.runs.running();
    const liveIds = new Set(active.map((run) => run.runId));
    for (const [runId, observer] of this.observers) {
      if (!liveIds.has(runId)) {
        observer.unsubscribe();
        this.observers.delete(runId);
      }
    }
    // Read once a pass, so an admin's change reaches runs already working.
    const adminLimit = active.length
      ? readRunLimitMinutes(this.settings.get(RUN_LIMIT_SETTING))
      : null;
    for (const initial of active) {
      await this.lock.run(initial.activityId, async () => {
        if (this.stopped) return;
        const run = this.runs.running().find((item) => item.runId === initial.runId);
        if (!run) return;
        const kind = SESSION_KINDS.get(run.kind);
        if (!kind) return;
        // A Session that went idle has finished its work, and is settled whenever it is looked
        // at; one still working, or the server's work in its place, answers to its limit.
        if (!run.sessionId || this.sessions.statusOf(run.sessionId) !== "idle") {
          this.stopAtTimeLimit(run, kind, adminLimit);
          return;
        }
        try {
          await this.sessions.atIdleBoundary(run.sessionId, async () => {
            // A coding agent that stopped short said why (its request_end carries the reason);
            // that beats naming the file it never wrote.
            const stoppedShort = run.codingAgentId ? this.observers.get(run.runId) : undefined;
            if (stoppedShort && !stoppedShort.completed) {
              this.finish(run, "failed", stoppedShort.error ?? "The coding agent did not finish.");
              return;
            }
            await this.settle(run, kind, this.observers.get(run.runId));
          });
        } catch {
          // A user may have resumed this session between the idle probe and its lock.
          // Leave the run active for the next tick.
        }
      });
    }
  }

  /**
   * Fails a run that has worked longer than it may, its limit named, and then stops what is
   * still working on it in the order Stop does: so the Stages waiting on it move on at once, and
   * a Session that answers late finds its run already ended.
   */
  private stopAtTimeLimit(run: ActivityRun, kind: SessionKind, adminLimit: number | null): void {
    const limitMs = wallClockLimitMs(kind.limits, adminLimit);
    if (limitMs === undefined) return;
    if (this.clock.now().getTime() - Date.parse(run.createdAt) <= limitMs) return;
    const error = new Error(timeLimitMessage(run.kind, limitMs));
    kind.failed?.(run, error);
    this.finish(run, "failed", error.message, "time");
    this.localRuns.get(run.runId)?.abort();
    if (run.sessionId) this.sessions.abortTask(run.sessionId);
  }
}

/** A kind whose agent works in a Session, of any request. */
type SessionKind = SessionRunKind<RunRequest, unknown, ActivityRun, unknown>;

/** The kinds whose agent works in a Session, by the kind of run they record. */
const SESSION_KINDS = new Map<ActivityRunKind, SessionKind>(
  Object.values(RUN_KINDS).flatMap((kind) =>
    kind.runner === "session" ? [[kind.run as ActivityRunKind, kind] as const] : [],
  ),
);
