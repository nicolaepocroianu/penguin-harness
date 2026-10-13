/**
 * "Run all stages": one click that takes an activity
 * from its script to an assembled module, or one stage re-run on its own.
 *
 * It is a sequencer over the runs that exist, not a second way of running anything. Each
 * step asks `ActivityGeneration.runAndAccept` for the same run an author could start by hand:
 * started, waited for, and accepted through the same accept the author would press. Every run
 * it starts is an ordinary run in the activity's history, with its own Session.
 *
 * Steps, in the order each needs the one before:
 *   spec    generate the specification from the script (applied when it completes)
 *   media   plan media from the specification (kept when already current)
 *   translations  translate and accept every narration another language lacks, or whose
 *           default-language line changed since it was translated
 *   speech  generate and accept every unbound narration with a usable script
 *   words   a decodable book only: record and accept every word pronunciation with sounds
 *           and no recording, said slowly sound by sound and then normally (pronunciation.ts)
 *   sounds  generate and accept every music and sound effect with a prompt and no file,
 *           with the chosen sound provider (ElevenLabs unless the sequence names another)
 *   images  generate and accept every unbound image with a description
 *   assessment  write and accept the assessment, when the specification uses one and this
 *           is the canonical ref that owns it
 *   module  assemble the WAF module (scaffold, configuration and behavior in one run)
 *   test    run the acceptance tests against the assembled module, when the specification
 *           has acceptance criteria and the test browser is installed
 *
 * A sequence belongs to the server that runs it: its live state is in memory, and a copy is
 * written to `activity_pipelines` as it progresses, so the Stages panel keeps every sequence
 * as history across restarts (one cut short by a restart reads as stopped). Its runs outlive
 * it in the generation history either way. A step that fails stops the sequence; nothing is
 * rolled back, and nothing after it runs.
 */
import { isBookWord, wordsMissingPhonemes } from "./book-words.js";
import { PHONEMES_RUN_MAX_WORDS } from "./phonemes-run.js";
import { speechModelFor } from "./audio.js";
import { KOKORO_VOICES } from "./local-audio-models.js";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import type { ActivityAcceptance } from "./acceptance-service.js";
import type { ActivityOutcomes } from "./outcomes.js";
import { acceptanceCriteria, failedChecks } from "./acceptance-collect.js";
import {
  DEFAULT_SPEECH_PROVIDER,
  ELEVENLABS_BUILTIN_VOICE_ID,
  ELEVENLABS_DEFAULT_VOICE,
  wordSpeechProvider,
  SPEECH_VOICES,
  isSpeechVoice,
  isVoiceOf,
} from "./voice-catalogue.js";
import { DEFAULT_LANGUAGE_CODE } from "./languages.js";
import { contentRevision, type ActivityRun } from "./domain.js";
import type { RunOutcome, RunRequest, RunSkip } from "./run-request.js";
import type { AssetManifest } from "./media.js";
import { soundPromptOf } from "./playback.js";
import { SOUND_PROMPT_MAX } from "./sound.js";
import type { SoundProviderId } from "./sound-types.js";
import { servesSoundKind } from "./audio-providers.js";
import {
  unrecordedWithSounds,
  unrecordedWithoutSounds,
  wordRecordingTargets,
} from "./pronunciation.js";
import type { SpeechProviderId } from "./speech-types.js";
import {
  PIPELINE_STEPS,
  type PipelineInput,
  type PipelineNote,
  type PipelineScope,
  type PipelineSelection,
  type PipelineState,
  type PipelineStep,
  type PipelineStepState,
} from "./pipeline-types.js";

export {
  PIPELINE_STEPS,
  type PipelineInput,
  type PipelineScope,
  type PipelineSelection,
  type PipelineState,
  type PipelineStep,
  type PipelineStepState,
  type PipelineStepStatus,
  type PipelineNote,
} from "./pipeline-types.js";

export function parseSelection(value: unknown): PipelineSelection {
  if (value === undefined || value === "all") return "all";
  if (value === "narration") return "narration";
  if (value === "assets") return "assets";
  if (typeof value === "string" && (PIPELINE_STEPS as readonly string[]).includes(value))
    return value as PipelineStep;
  throw new HttpError(
    400,
    "invalid_request",
    "stage must be all, narration, assets, or one of the pipeline steps.",
  );
}

export function stepsFor(selection: PipelineSelection): PipelineStep[] {
  if (selection === "all") return [...PIPELINE_STEPS];
  if (selection === "narration") return ["translations", "speech"];
  if (selection === "assets") return ["speech", "images"];
  return [selection];
}

/** The targets a scoped sequence may touch: one language, and one asset when it names one. */
export function inScope<T extends { language: string; assetKey: string }>(
  targets: readonly T[],
  scope: PipelineScope | undefined,
): T[] {
  if (!scope) return [...targets];
  return targets.filter(
    (target) =>
      target.language === scope.language &&
      (scope.assetKey === undefined || target.assetKey === scope.assetKey),
  );
}

type MediaAsset = AssetManifest["assets"][string][number];
const TEXT_MAX = 5000;
const usable = (text: string | undefined) => !!text?.trim() && text.length <= TEXT_MAX;

/**
 * Whether a bound narration was spoken with another model or voice than it would be now,
 * Loom's changed generation profile: its model, provider or voice changed since, or, for one
 * with no voice of its own, the voice the run chose. What a clip did not record (an upload,
 * or one accepted before models and voices were recorded) is not compared, and neither is the
 * voice of one with no voice of its own when the run chose none: the author may have spoken
 * it with any voice in the editor, and the stage accepts what it makes unheard.
 */
function spokenDifferently(asset: MediaAsset, language: string, voices: SpeechVoices): boolean {
  const recorded = asset.generatedAudio;
  if (!recorded) return false;
  const provider = asset.speechProvider ?? DEFAULT_SPEECH_PROVIDER;
  const voiceCompared = !!asset.voice || !!voices.chosen;
  const voice = voiceFor(provider, asset.voice, voices.chosen, language);
  // The default ElevenLabs voice is compared as the voice it speaks with, as the clip records it.
  const spoken =
    voice === ELEVENLABS_DEFAULT_VOICE
      ? (voices.elevenLabsDefault ?? ELEVENLABS_BUILTIN_VOICE_ID)
      : voice;
  return (
    (recorded.model !== undefined && recorded.model !== speechModelFor(provider, asset)) ||
    (voiceCompared && recorded.voice !== undefined && recorded.voice !== spoken)
  );
}

/**
 * The voices a speech step speaks with: the one the run chose for narration with none of its
 * own, and the voice the default ElevenLabs voice resolves to (absent, Loom's).
 */
export interface SpeechVoices {
  chosen?: string;
  elevenLabsDefault?: string;
}

/**
 * Narration with a script the speech run accepts, in every language, in manifest order: unbound,
 * or spoken with another model or voice than it would be now, given the voice the run chose
 * for narration with none of its own. A book's word pronunciations are recorded with the
 * words, not as narration.
 */
export function speechTargets(
  manifest: AssetManifest,
  voices: SpeechVoices = {},
): { language: string; assetKey: string }[] {
  return Object.entries(manifest.assets).flatMap(([language, assets]) =>
    assets
      .filter(
        (asset: MediaAsset) =>
          asset.type === "audio" &&
          !asset.kind &&
          !isBookWord(asset) &&
          (!asset.path || spokenDifferently(asset, language, voices)) &&
          usable(asset.script),
      )
      .map((asset) => ({ language, assetKey: asset.key })),
  );
}

/**
 * Unbound music and sound effects with a prompt a sound run accepts (1 to 2 000 characters),
 * in every language, in manifest order.
 */
export function soundTargets(manifest: AssetManifest): { language: string; assetKey: string }[] {
  return Object.entries(manifest.assets).flatMap(([language, assets]) =>
    assets
      .filter((asset: MediaAsset) => {
        if (asset.type !== "audio" || !asset.kind || asset.path) return false;
        const prompt = soundPromptOf(asset.script);
        return !!prompt && prompt.length <= SOUND_PROMPT_MAX;
      })
      .map((asset) => ({ language, assetKey: asset.key })),
  );
}

/**
 * Narrations to translate, in every language but the default: those with no script yet,
 * and those translated from a default-language line that has since been rewritten. A
 * script with no recorded source was written by someone, not translated, and is left be.
 */
export function translationTargets(
  manifest: AssetManifest,
): { language: string; assetKey: string }[] {
  const sources = new Map(
    (manifest.assets[DEFAULT_LANGUAGE_CODE] ?? [])
      .filter((asset) => asset.type === "audio" && usable(asset.script))
      .map((asset) => [asset.key, asset.script!]),
  );
  return Object.entries(manifest.assets)
    .filter(([language]) => language !== DEFAULT_LANGUAGE_CODE)
    .flatMap(([language, assets]) =>
      assets
        .filter((asset: MediaAsset) => {
          const source = sources.get(asset.key);
          // Music and effects are not spoken, so there is nothing to translate.
          if (asset.type !== "audio" || asset.kind || isBookWord(asset) || source === undefined)
            return false;
          return (
            !asset.script?.trim() ||
            (asset.translatedFrom !== undefined && asset.translatedFrom !== source)
          );
        })
        .map((asset) => ({ language, assetKey: asset.key })),
    );
}

/** Unbound images with a description the image run accepts, in every language. */
export function imageTargets(manifest: AssetManifest): { language: string; assetKey: string }[] {
  return Object.entries(manifest.assets).flatMap(([language, assets]) =>
    assets
      .filter(
        (asset: MediaAsset) => asset.type === "image" && !asset.path && usable(asset.description),
      )
      .map((asset) => ({ language, assetKey: asset.key })),
  );
}

/** Reject unsupported saved providers before the sequence spends work on any targets. */
export function validateSpeechLanguages(
  manifest: AssetManifest | undefined,
  input: PipelineInput,
): void {
  if (!manifest) return;
  const steps = stepsFor(input.selection);
  const targets = [
    ...(steps.includes("speech") ? speechTargets(manifest, { chosen: input.voice }) : []),
    ...(steps.includes("speech") && steps.includes("translations")
      ? translationTargets(manifest)
      : []),
    ...(steps.includes("words") ? unrecordedWithSounds(manifest) : []),
  ];
  for (const target of inScope(targets, input.scope)) {
    const asset = manifest.assets[target.language]?.find((item) => item.key === target.assetKey);
    if (
      asset?.speechProvider === "kokoro" &&
      !asset.path &&
      !KOKORO_VOICES.some((voice) => voice.languages.includes(target.language))
    ) {
      throw new HttpError(
        422,
        "audio_invalid",
        `Kokoro does not support ${target.language} (${target.assetKey}). Choose another speech provider before starting the pipeline.`,
      );
    }
  }
}

/** Use the saved voice, the sequence's choice, or the provider's default for this language. */
export function voiceFor(
  provider: SpeechProviderId,
  saved: string | undefined,
  chosen: string | undefined,
  language = "en-US",
): string {
  if (provider === "kokoro") {
    const voices = KOKORO_VOICES.filter((voice) => voice.languages.includes(language));
    return (
      voices.find((voice) => voice.id === saved)?.id ??
      voices.find((voice) => voice.id === chosen)?.id ??
      voices[0]?.id ??
      ""
    );
  }
  if (provider === "elevenlabs")
    return isVoiceOf("elevenlabs", saved)
      ? saved!
      : isVoiceOf("elevenlabs", chosen)
        ? chosen!
        : ELEVENLABS_DEFAULT_VOICE;
  if (isSpeechVoice(saved)) return saved;
  return isSpeechVoice(chosen) ? chosen : SPEECH_VOICES[0];
}

/** Thrown inside a step once the author has asked the sequence to stop. */
class Stopped extends Error {}

/** A run that ended without success, with the run as it ended (none when it never started). */
class RunFailed extends Error {
  constructor(
    message: string,
    readonly run?: ActivityRun,
  ) {
    super(message);
  }
}

/**
 * What the stages ask of the activity and its runs, and nothing else: the one port a sequence
 * runs through, which tests fake whole.
 */
export type StagesPort = Pick<
  ActivityAuthoring,
  "getActivity" | "planMedia" | "bookWordsState" | "refreshBookWords" | "prepareWordRecordings"
> &
  Pick<
    ActivityGeneration,
    "runAndAccept" | "cancel" | "elevenLabsDefaultVoice" | "soundSetup" | "speechSetup"
  > &
  Pick<ActivitySandbox, "currentAssessment"> &
  Pick<ActivityAcceptance, "browserInstalled" | "testRun" | "state"> &
  Pick<ActivityOutcomes, "attribute">;

export interface PipelineDeps {
  stages: StagesPort;
  now?: () => string;
  newId?: () => string;
  /** Keeps a copy of the sequence as it stands (start, each step, each run, the end), for its history. */
  persist?: (state: PipelineState) => void;
}

/** How many past sequences the Stages panel is given. */
const HISTORY_LIMIT = 20;
const INTERRUPTED = "The server restarted before the stages finished.";

/**
 * What a run's skip reason is called in its step's note. An unusable provider is the images
 * step's to word, and only before its first image.
 */
const SKIP_NOTES: Record<RunSkip, PipelineNote | null> = {
  noAssessment: "noAssessment",
  notCanonical: "notCanonical",
  providerUnavailable: null,
};

export class PipelineRunner {
  private readonly states = new Map<string, PipelineState>();
  private readonly stopping = new Set<string>();
  /** Aborted to stop waiting on the run in flight: on Stop, and when the component goes. */
  private readonly signals = new Map<string, AbortController>();
  private readonly now: () => string;
  private readonly newId: () => string;
  private counter = 0;
  private disposed = false;

  constructor(private readonly deps: PipelineDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? (() => `pipeline_${Date.now().toString(36)}_${++this.counter}`);
  }

  /**
   * Stop stepping: the component is going away (a restart or a hot replacement). The run in
   * flight is left alone, an ordinary run its history still shows; nothing after it starts.
   */
  dispose(): void {
    this.disposed = true;
    for (const controller of this.signals.values()) controller.abort();
  }

  /** A copy to history; a failed write never stops the sequence. */
  private save(state: PipelineState): void {
    try {
      this.deps.persist?.(structuredClone(state));
    } catch {
      // The live state still serves the panel; only the history misses this moment.
    }
  }

  /** The activity's latest sequence, running or finished, or null when it has had none. */
  status(activityId: string): PipelineState | null {
    return this.states.get(activityId) ?? null;
  }

  /**
   * Start a sequence. It returns at once with the plan; the steps run after. Resolves the
   * returned promise's `done` when the sequence has settled, which only tests wait for.
   */
  start(
    projectId: string,
    activityId: string,
    input: PipelineInput,
  ): { state: PipelineState; done: Promise<void> } {
    if (this.states.get(activityId)?.status === "running")
      throw new HttpError(
        409,
        "pipeline_running",
        "This activity is already running its stages. Stop it before starting again.",
      );
    const state: PipelineState = {
      pipelineId: this.newId(),
      projectId,
      activityId,
      selection: input.selection,
      scope: input.scope ?? null,
      status: "running",
      steps: stepsFor(input.selection).map((step) => ({
        step,
        status: "pending",
        detail: null,
        note: null,
        done: 0,
        total: 0,
        runIds: [],
      })),
      currentRunId: null,
      currentSessionId: null,
      error: null,
      startedAt: this.now(),
      finishedAt: null,
    };
    this.states.set(activityId, state);
    this.stopping.delete(activityId);
    this.signals.set(activityId, new AbortController());
    this.save(state);
    const planned = structuredClone(state);
    // What the steps start, accept and change is the Stages' doing, not the request's that
    // started them.
    const done = this.deps.stages.attribute({ actor: "stages" }, () => this.drive(state, input));
    return { state: planned, done };
  }

  /** Ask the running sequence to stop: the run in flight is cancelled, and nothing after it runs. */
  async stop(activityId: string): Promise<PipelineState | null> {
    const state = this.states.get(activityId);
    if (!state || state.status !== "running") return state ?? null;
    this.stopping.add(activityId);
    const runId = state.currentRunId;
    this.signals.get(activityId)?.abort();
    if (runId)
      await this.deps.stages.cancel(state.projectId, activityId, runId).catch(() => undefined);
    return state;
  }

  private async drive(state: PipelineState, input: PipelineInput): Promise<void> {
    for (const step of state.steps) {
      if (this.stopping.has(state.activityId) || this.disposed) break;
      step.status = "running";
      this.save(state);
      try {
        await this.runStep(state, step, input);
        if (step.status === "running") step.status = "succeeded";
      } catch (error) {
        const stopped = error instanceof Stopped || this.stopping.has(state.activityId);
        step.status = stopped ? "cancelled" : "failed";
        step.detail = stopped ? null : error instanceof Error ? error.message : String(error);
        if (!stopped) state.error = step.detail;
        break;
      } finally {
        state.currentRunId = null;
        state.currentSessionId = null;
        this.save(state);
      }
    }
    const failed = state.steps.some((step) => step.status === "failed");
    // Stopped by the author, or cut short because the server is going away: either way,
    // not every chosen stage ran.
    state.status = failed
      ? "failed"
      : this.stopping.has(state.activityId) || this.disposed
        ? "cancelled"
        : "succeeded";
    for (const step of state.steps)
      if (step.status === "pending" && state.status !== "succeeded") step.status = "cancelled";
    this.stopping.delete(state.activityId);
    this.signals.delete(state.activityId);
    state.finishedAt = this.now();
    this.save(state);
  }

  private async runStep(
    state: PipelineState,
    step: PipelineStepState,
    input: PipelineInput,
  ): Promise<void> {
    const { projectId, activityId } = state;
    const { stages } = this.deps;
    const runtime = input.codingAgentId ? { codingAgentId: input.codingAgentId } : undefined;
    const current = () => stages.getActivity(projectId, activityId);

    if (step.step === "spec" || step.step === "mediaSpec") {
      if (step.step === "spec" && !(await current()).draft.description.trim())
        throw new Error("Write the activity script before generating the specification.");
      const kind = step.step === "mediaSpec" ? ("media-spec" as const) : ("spec" as const);
      // Loom's retry: a pass that wrote the wrong thing runs once more, told why.
      try {
        await this.run(state, step, input, { kind }, runtime);
      } catch (error) {
        if (error instanceof Stopped || this.stopping.has(state.activityId)) throw error;
        // Only a specification that failed its checks is retried; a Session, provider or
        // workspace failure would fail the same way again.
        const failed = error instanceof RunFailed ? error.run : undefined;
        if (failed?.status !== "failed" || !failed.repairable) throw error;
        await this.run(
          state,
          step,
          input,
          { kind, repair: failed.error ?? (error as Error).message },
          runtime,
        );
      }
      return;
    }

    if (step.step === "media") {
      const activity = await current();
      if (!activity.draft.spec || activity.draft.status !== "valid")
        throw new Error("Save a valid specification before planning media.");
      const plan = activity.draft.mediaPlan;
      if (plan && plan.specRevision === contentRevision(activity.draft.spec)) {
        step.status = "skipped";
        step.note = "planCurrent";
        return;
      }
      await stages.planMedia(projectId, activityId, activity.draft.contentRevision);
      return;
    }

    if (step.step === "translations") {
      const manifest = (await current()).draft.mediaPlan?.manifest;
      if (!manifest) throw new Error("Plan media before translating it.");
      const targets = inScope(translationTargets(manifest), input.scope);
      step.total = targets.length;
      if (!targets.length) {
        step.status = "skipped";
        step.note = "allTranslated";
        return;
      }
      for (const target of targets) {
        this.throwIfStopped(state);
        step.detail = `${target.assetKey} (${target.language})`;
        await this.run(
          state,
          step,
          input,
          { kind: "media-text", mediaText: { ...target, translate: true } },
          runtime,
        );
        step.done += 1;
      }
      step.detail = null;
      return;
    }

    if (step.step === "speech" || step.step === "images") {
      // Generated by the Media Agent whichever agent runs the stages, so no runtime is handed on.
      const manifest = (await current()).draft.mediaPlan?.manifest;
      if (!manifest) throw new Error("Plan media before generating it.");
      if (step.step === "speech")
        validateSpeechLanguages(manifest, { ...input, selection: "speech" });
      const targets = inScope(
        step.step === "speech"
          ? speechTargets(manifest, {
              chosen: input.voice,
              elevenLabsDefault: await stages.elevenLabsDefaultVoice(projectId),
            })
          : imageTargets(manifest),
        input.scope,
      );
      step.total = targets.length;
      if (!targets.length) {
        step.status = "skipped";
        step.note = step.step === "speech" ? "noNarration" : "noImages";
        return;
      }
      for (const target of targets) {
        this.throwIfStopped(state);
        const narration = manifest.assets[target.language]?.find(
          (item) => item.key === target.assetKey,
        );
        const voice = voiceFor(
          narration?.speechProvider ?? DEFAULT_SPEECH_PROVIDER,
          narration?.voice,
          input.voice,
          target.language,
        );
        step.detail = target.assetKey;
        const outcome = await this.run(
          state,
          step,
          input,
          step.step === "speech"
            ? { kind: "speech", speech: { ...target, voice } }
            : { kind: "image", image: target },
        );
        if (outcome.outcome === "skipped") {
          // No image provider: the images are left unbound, as missing sounds are, and the
          // module stage still runs and reports them missing.
          if (
            step.step === "images" &&
            step.done === 0 &&
            outcome.reason === "providerUnavailable"
          ) {
            step.status = "skipped";
            step.note = "imageProviderUnavailable";
            step.detail = null;
            return;
          }
          throw new Error(outcome.message);
        }
        step.done += 1;
      }
      step.detail = null;
      return;
    }

    if (step.step === "words") {
      await this.recordWords(state, step, input, runtime);
      return;
    }

    if (step.step === "sounds") {
      // Made by the Media Agent's helper whichever agent runs the stages.
      const manifest = (await current()).draft.mediaPlan?.manifest;
      if (!manifest) throw new Error("Plan media before generating it.");
      const targets = inScope(soundTargets(manifest), input.scope);
      step.total = targets.length;
      if (!targets.length) {
        step.status = "skipped";
        step.note = "noSounds";
        return;
      }
      const provider: SoundProviderId = input.soundProvider ?? "elevenlabs";
      // Asked once: a missing key or model is the same for every sound of a kind, and is not a
      // failure of the sequence, only of this provider for the Media Agent. A sound whose kind the
      // provider cannot make now is left for another provider rather than failing the stages.
      const status = (await stages.soundSetup(projectId)).providers.find(
        (entry) => entry.id === provider,
      );
      const served = status
        ? targets.filter((target) => {
            const kind = manifest.assets[target.language]?.find(
              (item) => item.key === target.assetKey,
            )?.kind;
            return !!kind && servesSoundKind(status, kind);
          })
        : [];
      step.total = served.length;
      if (!served.length) {
        step.status = "skipped";
        step.note = "soundProviderUnavailable";
        return;
      }
      for (const target of served) {
        this.throwIfStopped(state);
        step.detail = target.assetKey;
        await this.run(state, step, input, { kind: "sound", sound: { ...target, provider } });
        step.done += 1;
      }
      step.detail = null;
      return;
    }

    if (step.step === "assessment") {
      // The run's kind decides whether there is an assessment to write here, and says why not.
      const outcome = await this.run(
        state,
        step,
        input,
        {
          kind: "assessment",
          assessment: { current: await stages.currentAssessment(projectId, activityId) },
        },
        runtime,
      );
      if (outcome.outcome === "skipped") this.skip(step, outcome);
      return;
    }

    if (step.step === "test") {
      if (!acceptanceCriteria((await current()).draft.spec).length) {
        step.status = "skipped";
        step.note = "noCriteria";
        return;
      }
      if (!(await stages.browserInstalled())) {
        step.status = "skipped";
        step.note = "noBrowser";
        return;
      }
      // The tests play the build this sequence just made, when it made one, else what the
      // preview plays: the acceptance service resolves which (its testRun).
      const request = await stages.testRun(projectId, activityId, this.builtModule(state));
      if (!request) {
        step.status = "skipped";
        step.note = "noCriteria";
        return;
      }
      const tested = await this.run(state, step, input, request, runtime);
      if (tested.outcome !== "skipped")
        await this.repairRound(state, step, input, tested.run, runtime);
      return;
    }

    const outcome = await this.run(
      state,
      step,
      input,
      { kind: "module", ...(input.bookMode ? { bookMode: input.bookMode } : {}) },
      runtime,
    );
    // A module that only compiled is not one that was seen to play: the stage says so.
    const unchecked = outcome.outcome === "skipped" ? undefined : outcome.run.unchecked;
    if (unchecked)
      step.note = unchecked === "noBrowser" ? "moduleNotChecked" : "moduleCheckSkipped";
  }

  /** The module build this sequence made, when its module step made one. */
  private builtModule(state: PipelineState): string | undefined {
    const step = state.steps.find((entry) => entry.step === "module");
    return step?.status === "succeeded" ? step.runIds.at(-1) : undefined;
  }

  /**
   * After a test run: when checks that ran saw the module do something wrong, one module run
   * repairs the build the tests played, told what they found, and the same tests run again on
   * what it builds. The step stays succeeded either way; its note says when checks still fail.
   * A check that never ran is a problem with the tests, which a module run cannot repair.
   */
  private async repairRound(
    state: PipelineState,
    step: PipelineStepState,
    input: PipelineInput,
    tested: ActivityRun,
    runtime?: { codingAgentId?: string },
  ): Promise<void> {
    const { projectId, activityId } = state;
    const found = await this.findings(projectId, activityId, tested.runId);
    if (!found.failing) return;
    const build = tested.test?.moduleRunId;
    if (!found.ran || !build) {
      step.note = "testsFailing";
      return;
    }
    let retested: ActivityRun;
    try {
      const repaired = await this.run(
        state,
        step,
        input,
        { kind: "module", repair: { fromRunId: build, testRunId: tested.runId } },
        runtime,
      );
      if (repaired.outcome === "skipped") throw new Error(repaired.message);
      const request = await this.deps.stages.testRun(projectId, activityId, repaired.run.runId);
      if (!request) throw new Error("The specification has no acceptance criteria to test.");
      const again = await this.run(state, step, input, request, runtime);
      if (again.outcome === "skipped") throw new Error(again.message);
      retested = again.run;
    } catch (error) {
      if (error instanceof Stopped || this.stopping.has(activityId)) throw error;
      // The round did not finish: what the first tests found stands.
      step.note = "testsFailing";
      return;
    }
    const again = await this.findings(projectId, activityId, retested.runId);
    // Only the same checks, run as they were handed, can show the repair worked.
    step.note = again.failing || !again.reused ? "testsStillFailing" : null;
  }

  /**
   * What a finished test run's report found: whether any check failed, whether any that ran
   * did, and whether the run ran the tests it was handed unchanged.
   */
  private async findings(
    projectId: string,
    activityId: string,
    runId: string,
  ): Promise<{ failing: boolean; ran: boolean; reused: boolean }> {
    const { report, runId: latest } = await this.deps.stages.state(projectId, activityId);
    if (!report || latest !== runId) return { failing: false, ran: false, reused: false };
    return {
      failing: report.overallStatus === "failed",
      ran: failedChecks(report).length > 0,
      reused: report.reused,
    };
  }

  /** A step its run's kind left undone, noted by the reason the kind gave. */
  private skip(step: PipelineStepState, outcome: { reason: RunSkip; message: string }): void {
    const note = SKIP_NOTES[outcome.reason];
    if (!note) throw new Error(outcome.message);
    step.status = "skipped";
    step.note = note;
  }

  /**
   * The words step: a decodable book's word pronunciations with sounds and no recording, each
   * recorded by the ordinary speech run with its own provider and voice and accepted. A word
   * that names no provider is spoken by ElevenLabs when the agent can use it, else by Gemini,
   * and keeps that choice; its script is made for the provider before anything is recorded.
   */
  private async recordWords(
    state: PipelineState,
    step: PipelineStepState,
    input: PipelineInput,
    runtime?: { codingAgentId: string },
  ) {
    const { projectId, activityId } = state;
    const { stages } = this.deps;
    const current = () => stages.getActivity(projectId, activityId);
    const activity = await current();
    const manifest = activity.draft.mediaPlan?.manifest;
    const hasWords =
      !!manifest && Object.values(manifest.assets).some((group) => group.some(isBookWord));
    const recorded =
      activity.activityType === "book"
        ? ((await stages.bookWordsState(projectId, activityId)).bookMode ?? null)
        : null;
    // The product's reading mode decides; where it records none, the sequence's choice, and a
    // book that already has word pronunciations was refreshed as decodable.
    const mode = recorded ?? input.bookMode ?? (hasWords ? "decodable" : null);
    if (activity.activityType !== "book" || mode !== "decodable") {
      step.status = "skipped";
      step.note = "notDecodable";
      return;
    }
    if (!manifest) throw new Error("Plan media before recording the book's words.");
    validateSpeechLanguages(manifest, { ...input, selection: "words" });
    // For each language, the words are planned from the book's text first, with espeak-ng's
    // sounds, as the Book words panel's refresh does: a book taken through every stage has none
    // planned before. Words espeak-ng could not sound out (or every word, where it is not
    // installed) then get the sounds the stage's agent proposes, as the panel's "ask the
    // model" does, accepted as they come: a word without sounds cannot be recorded at all.
    const languages = input.scope?.language ? [input.scope.language] : Object.keys(manifest.assets);
    const revision = async () => (await current()).draft.contentRevision;
    for (const language of languages) {
      step.detail = language;
      await stages.refreshBookWords(projectId, activityId, language, await revision(), "decodable");
      // A run scoped to one word asks only about that word.
      const group = ((await current()).draft.mediaPlan!.manifest.assets[language] ?? []).filter(
        (asset) => input.scope?.assetKey === undefined || asset.key === input.scope.assetKey,
      );
      const missing = wordsMissingPhonemes(group);
      // As many runs as the words need: one run proposes at most PHONEMES_RUN_MAX_WORDS.
      for (let start = 0; start < missing.length; start += PHONEMES_RUN_MAX_WORDS) {
        this.throwIfStopped(state);
        await this.run(
          state,
          step,
          input,
          {
            kind: "phonemes",
            phonemes: { language, words: missing.slice(start, start + PHONEMES_RUN_MAX_WORDS) },
          },
          runtime,
        );
      }
    }
    step.detail = null;
    const planned = (await current()).draft.mediaPlan!.manifest;
    const waiting = inScope(unrecordedWithSounds(planned), input.scope);
    if (!waiting.length) {
      step.status = "skipped";
      step.note = inScope(unrecordedWithoutSounds(planned), input.scope).length
        ? "wordsMissingSounds"
        : "noWords";
      return;
    }
    const speech = await stages.speechSetup(projectId);
    const fallback: SpeechProviderId = speech.providers?.some(
      (entry) => entry.id === "elevenlabs" && entry.available,
    )
      ? "elevenlabs"
      : "gemini";
    const prepared = await stages.prepareWordRecordings(
      projectId,
      activityId,
      fallback,
      (await current()).draft.contentRevision,
      input.scope?.language,
    );
    const ready = prepared.mediaPlan!.manifest;
    const targets = inScope(wordRecordingTargets(ready), input.scope);
    step.total = targets.length;
    for (const target of targets) {
      this.throwIfStopped(state);
      const word = ready.assets[target.language]?.find((item) => item.key === target.assetKey);
      const provider = word ? wordSpeechProvider(word) : DEFAULT_SPEECH_PROVIDER;
      step.detail = target.assetKey;
      await this.run(state, step, input, {
        kind: "speech",
        speech: {
          ...target,
          voice: voiceFor(provider, word?.voice, input.voice, target.language),
          provider,
        },
      });
      step.done += 1;
    }
    step.detail = null;
  }

  /**
   * Ends the step when Stop was pressed: checked before each run a stage starts and once each
   * run has finished, since Stop cancels only the run under way, and one that had just finished
   * would otherwise be accepted and let the next start.
   */
  private throwIfStopped(state: PipelineState): void {
    if (this.stopping.has(state.activityId) || this.disposed) throw new Stopped();
  }

  /**
   * One run of a step, started, waited for and accepted in one call, and kept with the step as
   * soon as it starts. Anything but success ends the step with the run's own reason; Stop, or
   * the component going away, ends it as stopped. A skip is the step's to word.
   */
  private async run(
    state: PipelineState,
    step: PipelineStepState,
    input: PipelineInput,
    request: RunRequest,
    runtime?: { codingAgentId?: string },
  ): Promise<Exclude<RunOutcome, { outcome: "failed" | "stopped" }>> {
    const signal = this.signals.get(state.activityId)?.signal;
    const outcome = await this.deps.stages.runAndAccept(
      state.projectId,
      state.activityId,
      request,
      {
        agentId: input.agentId,
        ...(runtime ? { runtime } : {}),
        ...(signal ? { signal } : {}),
        started: (run) => {
          step.runIds.push(run.runId);
          state.currentRunId = run.runId;
          state.currentSessionId = run.sessionId;
          step.sessionId = run.sessionId;
          this.save(state);
        },
      },
    );
    if (outcome.outcome === "stopped") throw new Stopped();
    if (outcome.outcome === "failed") throw new RunFailed(outcome.error, outcome.run);
    this.throwIfStopped(state);
    return outcome;
  }
}

/** "Run all stages" for one activity at a time, kept by the server that runs it. */
export abstract class ActivityPipelines extends Interface<{
  start(projectId: string, activityId: string, input: PipelineInput): Promise<PipelineState>;
  /** The activity's latest sequence in this project, or null when it has had none here. */
  status(projectId: string, activityId: string): Promise<PipelineState | null>;
  /** The activity's sequences, newest first (the running one included), at most `limit`. */
  history(projectId: string, activityId: string, limit?: number): Promise<PipelineState[]>;
  stop(projectId: string, activityId: string): Promise<PipelineState | null>;
}>() {}

@Component()
export class ActivityPipelineService implements ActivityPipelines {
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly acceptance!: ActivityAcceptance;
  @Use() private readonly outcomes!: ActivityOutcomes;
  @Use() private readonly db!: Db;
  private runner: PipelineRunner | null = null;

  setup({ effect }: ClassCtx) {
    // A sequence still marked running was cut short by a restart or a hot replacement:
    // nothing will finish it, so its history says it stopped.
    for (const state of this.rows("WHERE status = 'running'", [])) {
      state.status = "cancelled";
      state.error ??= INTERRUPTED;
      for (const step of state.steps)
        if (step.status === "running" || step.status === "pending") step.status = "cancelled";
      this.write(state);
    }
    const { activities, generation, sandbox, acceptance, outcomes } = this;
    const runner = new PipelineRunner({
      persist: (state) => this.write(state),
      stages: {
        getActivity: (projectId, activityId) => activities.getActivity(projectId, activityId),
        planMedia: (projectId, activityId, expectedRevision) =>
          activities.planMedia(projectId, activityId, expectedRevision),
        bookWordsState: (projectId, activityId) => activities.bookWordsState(projectId, activityId),
        refreshBookWords: (projectId, activityId, language, expectedRevision, mode) =>
          activities.refreshBookWords(projectId, activityId, language, expectedRevision, mode),
        prepareWordRecordings: (projectId, activityId, fallback, expectedRevision, language) =>
          activities.prepareWordRecordings(
            projectId,
            activityId,
            fallback,
            expectedRevision,
            language,
          ),
        runAndAccept: (projectId, activityId, request, options) =>
          generation.runAndAccept(projectId, activityId, request, options),
        cancel: (projectId, activityId, runId) => generation.cancel(projectId, activityId, runId),
        elevenLabsDefaultVoice: (projectId) => generation.elevenLabsDefaultVoice(projectId),
        soundSetup: (projectId) => generation.soundSetup(projectId),
        speechSetup: (projectId) => generation.speechSetup(projectId),
        currentAssessment: (projectId, activityId) =>
          sandbox.currentAssessment(projectId, activityId),
        browserInstalled: () => acceptance.browserInstalled(),
        testRun: (projectId, activityId, moduleRunId) =>
          acceptance.testRun(projectId, activityId, moduleRunId),
        state: (projectId, activityId) => acceptance.state(projectId, activityId),
        attribute: (cause, operation) => outcomes.attribute(cause, operation),
      },
    });
    this.runner = runner;
    effect(() => runner.dispose());
  }

  private active(): PipelineRunner {
    if (!this.runner) throw new HttpError(503, "pipeline_unavailable", "Stages are not ready yet.");
    return this.runner;
  }

  async start(projectId: string, activityId: string, input: PipelineInput) {
    // An unknown activity is refused here rather than as the first step's failure.
    const activity = await this.activities.getActivity(projectId, activityId);
    validateSpeechLanguages(activity.draft.mediaPlan?.manifest, input);
    return this.active().start(projectId, activityId, input).state;
  }

  // A sequence is keyed by activity; answering only inside its own project keeps one
  // project from reading or stopping another's, whatever id it names. Without one in memory
  // (a restart since), the latest from history still shows what last ran.
  async status(projectId: string, activityId: string) {
    const state = this.active().status(activityId);
    if (state) return state.projectId === projectId ? state : null;
    return (await this.history(projectId, activityId, 1))[0] ?? null;
  }

  async history(projectId: string, activityId: string, limit = HISTORY_LIMIT) {
    return this.rows(
      "WHERE project_id = ? AND activity_id = ? ORDER BY started_at DESC, pipeline_id DESC LIMIT ?",
      [projectId, activityId, limit],
    );
  }

  private rows(where: string, params: Array<string | number>): PipelineState[] {
    const found = this.db
      .prepare(`SELECT record_json FROM activity_pipelines ${where}`)
      .all(...params) as Array<{ record_json: string }>;
    return found.map((row) => JSON.parse(row.record_json) as PipelineState);
  }

  private write(state: PipelineState): void {
    this.db
      .prepare(
        `INSERT INTO activity_pipelines (pipeline_id, project_id, activity_id, status, record_json, started_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(pipeline_id) DO UPDATE SET status = excluded.status, record_json = excluded.record_json`,
      )
      .run(
        state.pipelineId,
        state.projectId,
        state.activityId,
        state.status,
        JSON.stringify(state),
        state.startedAt,
      );
  }

  async stop(projectId: string, activityId: string) {
    if (!(await this.status(projectId, activityId))) return null;
    return this.active().stop(activityId);
  }
}
