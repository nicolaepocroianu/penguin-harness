import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  PipelineRunner,
  ActivityPipelineService,
  type StagesPort,
  validateSpeechLanguages,
  imageTargets,
  inScope,
  parseSelection,
  soundTargets,
  speechTargets,
  stepsFor,
  translationTargets,
} from "../src/activities/pipeline-run.js";
import { contentRevision, type ActivityRun } from "../src/activities/domain.js";
import type { AcceptanceReport } from "../src/activities/acceptance-types.js";
import type { RunAndAcceptOptions, RunOutcome, RunRequest } from "../src/activities/run-request.js";
import { runKindOf } from "../src/activities/run-kinds/index.js";
import { ACCEPTANCE_RESULTS_FILE } from "../src/activities/acceptance-harness.js";
import { PLAYER_CHECK_DIR } from "../src/activities/waf-module.js";
import type { AssetManifest, MediaAsset } from "../src/activities/media.js";
import { drawnOutScript, geminiScript, syncWordScripts } from "../src/activities/pronunciation.js";
import type { SpeechProviderId } from "../src/activities/speech-types.js";
import {
  ELEVENLABS_BUILTIN_VOICE_ID,
  ELEVENLABS_DEFAULT_VOICE,
} from "../src/activities/voice-catalogue.js";

const usage = [{ sceneId: "intro", sourceKey: "k", occurrence: 1, sceneOccurrenceCount: 1 }];

/** Where the fake runs' folders are, one folder per world: only player checks write there. */
const workspaces = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-pipeline-run-"));
let worlds = 0;
afterAll(() => fs.rmSync(workspaces, { recursive: true, force: true }));

/** A test run's report: each check passed, failed on what it saw, or never ran. */
function testReport(checks: ("passed" | "failed" | "notRun")[], reused = false): AcceptanceReport {
  return {
    overallStatus: checks.every((check) => check === "passed") ? "passed" : "failed",
    results: checks.map((check, index) => ({
      criterion: `criterion ${index + 1}`,
      testName: check === "notRun" ? "" : `check ${index + 1}`,
      status: check === "passed" ? "passed" : "failed",
      durationMs: 1,
      error: check === "failed" ? "saw nothing happen" : null,
      ...(check === "notRun" ? { code: "not_run" as const } : {}),
    })),
    checkedAt: "2026-10-13T12:00:00Z",
    specRevision: null,
    reused,
  };
}

function manifest(withRomanian = false): AssetManifest {
  return {
    productCode: "words",
    refNum: 1,
    assets: {
      "en-US": [
        { key: "hello", type: "audio", description: "Greeting", script: "Hello", usages: usage },
        {
          key: "bound",
          type: "audio",
          description: "Done",
          script: "Hi",
          path: "a.wav",
          usages: usage,
        },
        { key: "silent", type: "audio", description: "No script", usages: usage },
        { key: "cat", type: "image", description: "A cat", usages: usage },
        { key: "clip", type: "video", description: "A clip", usages: usage },
      ],
      "es-MX": [
        { key: "hello", type: "audio", description: "Saludo", script: "Hola", usages: usage },
      ],
      ...(withRomanian
        ? { "ro-RO": [{ key: "hello", type: "audio", description: "Salut", usages: usage }] }
        : {}),
    },
  };
}

/** The asset a speech, sound, image or media text request is for. */
function assetTarget(request: RunRequest): { language: string; assetKey: string } | undefined {
  switch (request.kind) {
    case "speech":
      return request.speech;
    case "sound":
      return request.sound;
    case "image":
      return request.image;
    case "media-text":
      return request.mediaText;
    default:
      return undefined;
  }
}
describe("choosing the work", () => {
  it("also preflights unrecorded book words, respecting the selected asset", () => {
    const media = manifest();
    media.assets["es-MX"]!.push({
      key: "word",
      type: "audio",
      role: "bookWord",
      description: "Word",
      phonemes: ["a"],
      speechProvider: "kokoro",
      usages: [],
    });
    expect(() => validateSpeechLanguages(media, { selection: "words", agentId: "agent" })).toThrow(
      "Kokoro does not support es-MX (word)",
    );
    expect(() =>
      validateSpeechLanguages(media, {
        selection: "words",
        agentId: "agent",
        scope: { language: "es-MX", assetKey: "hello" },
      }),
    ).not.toThrow();
  });
  it.each(["es-MX", "ro-RO"])(
    "refuses saved Kokoro for %s before starting a pipeline",
    async (language) => {
      const media = manifest(true);
      media.assets[language]![0]!.speechProvider = "kokoro";
      const start = vi.fn();
      const pipelines = new ActivityPipelineService();
      Object.assign(pipelines, {
        activities: { getActivity: async () => ({ draft: { mediaPlan: { manifest: media } } }) },
        runner: { start },
      });
      await expect(
        pipelines.start("proj", "act", { selection: "narration", agentId: "agent" }),
      ).rejects.toThrow(`Kokoro does not support ${language}`);
      expect(start).not.toHaveBeenCalled();
      expect(() =>
        validateSpeechLanguages(media, {
          selection: "narration",
          agentId: "agent",
          scope: { language: "en-US" },
        }),
      ).not.toThrow();
      expect(() =>
        validateSpeechLanguages(media, { selection: "images", agentId: "agent" }),
      ).not.toThrow();
      media.assets[language]![0]!.path = "recorded.wav";
      expect(() =>
        validateSpeechLanguages(media, { selection: "narration", agentId: "agent" }),
      ).not.toThrow();
    },
  );
  it("finds unbound narration with a script and unbound described images, in every language", () => {
    expect(speechTargets(manifest())).toEqual([
      { language: "en-US", assetKey: "hello" },
      { language: "es-MX", assetKey: "hello" },
    ]);
    expect(imageTargets(manifest())).toEqual([{ language: "en-US", assetKey: "cat" }]);
  });

  it("speaks a bound narration again when the model it would use now is not the one it was spoken with", () => {
    const media = manifest();
    const bound = media.assets["en-US"]!.find((asset) => asset.key === "bound")!;
    const take = { runId: `run_${"a".repeat(32)}`, sha256: "b".repeat(64), format: "mp3" as const };
    const targets = () => speechTargets(media).map((target) => target.assetKey);
    // Spoken with the default ElevenLabs model, which is still the one it would use.
    bound.generatedAudio = { ...take, model: "eleven_v3" };
    expect(targets()).toEqual(["hello", "hello"]);
    // The author chose another model.
    bound.speechModel = "eleven_v4";
    expect(targets()).toEqual(["hello", "bound", "hello"]);
    bound.generatedAudio = { ...take, model: "eleven_v4" };
    expect(targets()).toEqual(["hello", "hello"]);
    // Another provider means another model.
    bound.speechProvider = "gemini";
    expect(targets()).toEqual(["hello", "bound", "hello"]);
    // A clip that names no model, as every one accepted before models were recorded, is kept.
    bound.generatedAudio = take;
    expect(targets()).toEqual(["hello", "hello"]);
  });

  it("speaks a bound narration again when the voice it would use now is not the one it was spoken with", () => {
    const media = manifest();
    const bound = media.assets["en-US"]!.find((asset) => asset.key === "bound")!;
    const take = { runId: `run_${"a".repeat(32)}`, sha256: "b".repeat(64), format: "mp3" as const };
    const other = "AbCdEfGhIj0123456789";
    const targets = (chosen?: string, elevenLabsDefault?: string) =>
      speechTargets(media, { chosen, elevenLabsDefault }).map((target) => target.assetKey);
    // No voice of its own: spoken with the default, which still resolves to Loom's voice.
    bound.generatedAudio = { ...take, model: "eleven_v3", voice: ELEVENLABS_BUILTIN_VOICE_ID };
    expect(targets()).toEqual(["hello", "hello"]);
    // With no voice of its own and none chosen by the run, its voice is not compared: the
    // author may have spoken it with any voice, and the stage would replace it unheard.
    expect(targets(undefined, other)).toEqual(["hello", "hello"]);
    expect(targets(undefined, ELEVENLABS_BUILTIN_VOICE_ID)).toEqual(["hello", "hello"]);
    // The run chose another voice for narration with none of its own.
    expect(targets(other)).toEqual(["hello", "bound", "hello"]);
    // Its own voice wins over the run's, so the clip stays whatever the run chose.
    bound.voice = other;
    bound.generatedAudio = { ...take, model: "eleven_v3", voice: other };
    expect(targets(ELEVENLABS_DEFAULT_VOICE)).toEqual(["hello", "hello"]);
    // The author chose another voice for it.
    bound.voice = ELEVENLABS_DEFAULT_VOICE;
    expect(targets()).toEqual(["hello", "bound", "hello"]);
    // A clip that names no voice is not compared by it.
    bound.generatedAudio = { ...take, model: "eleven_v3" };
    expect(targets(other)).toEqual(["hello", "hello"]);
  });

  it("runs every step for all, one step on its own, and refuses an unknown one", () => {
    expect(stepsFor(parseSelection(undefined))).toEqual([
      "spec",
      "mediaSpec",
      "media",
      "translations",
      "speech",
      "words",
      "sounds",
      "images",
      "assessment",
      "module",
      "test",
    ]);
    expect(stepsFor(parseSelection("speech"))).toEqual(["speech"]);
    expect(stepsFor(parseSelection("words"))).toEqual(["words"]);
    expect(stepsFor(parseSelection("test"))).toEqual(["test"]);
    expect(stepsFor(parseSelection("narration"))).toEqual(["translations", "speech"]);
    // A ref made from its template speaks and draws what it cleared, and nothing else.
    expect(stepsFor(parseSelection("assets"))).toEqual(["speech", "images"]);
    expect(() => parseSelection("deploy")).toThrow(/stage must be/);
  });

  it("runs every step from one on, in the order all runs them", () => {
    expect(stepsFor(parseSelection({ from: "images" }))).toEqual([
      "images",
      "assessment",
      "module",
      "test",
    ]);
    expect(stepsFor(parseSelection({ from: "test" }))).toEqual(["test"]);
    expect(stepsFor(parseSelection({ from: "spec" }))).toEqual(stepsFor("all"));
    // Only the step is kept from what was sent.
    expect(parseSelection({ from: "module", extra: 1 })).toEqual({ from: "module" });
    for (const value of [{ from: "deploy" }, { from: "all" }, {}, null, ["images"]])
      expect(() => parseSelection(value)).toThrow(/stage must be/);
  });
});

/** An activity and the two services, faked closely enough to show what the sequence does. */
function world(
  options: {
    fail?: ActivityRun["kind"];
    /** What a succeeding module run reports about its player check. */
    unchecked?: ActivityRun["unchecked"];
    /**
     * A succeeding module run's player check: whether its run changed the files the check
     * rests on, and the results it wrote, if any.
     */
    playerCheck?: { untrusted?: boolean; results?: ("passed" | "failed")[] };
    /** The Media Agent has no image provider key: an image run is refused. */
    noImageKey?: boolean;
    description?: string;
    romanian?: boolean;
    usesAssessment?: boolean;
    canonical?: boolean;
    /** The specification's acceptance criteria. */
    criteria?: string[];
    /** Whether the test browser is installed. */
    browser?: boolean;
    /** Add two sound effects to the plan: one bound, one with a prompt and no file. */
    sounds?: boolean;
    /** Whether the chosen agent can use each sound provider (all can when absent). */
    soundProviders?: Partial<Record<"elevenlabs" | "agenthub", boolean>>;
    /** The model hub's sound models, as its setup lists them (none when absent). */
    hubModels?: {
      id: string;
      kinds: ("music" | "sfx")[];
      credential: string;
      available: boolean;
    }[];
    /** Add an unbound music asset with a prompt to the plan, next to the sound effects. */
    music?: boolean;
    /** What each test run reports, in turn; every check passes when absent. */
    reports?: AcceptanceReport[];
    /** A module run that repairs a build fails. */
    failRepair?: boolean;
    /** The tests a repair was handed were rewritten before they ran again. */
    testsRewritten?: boolean;
  } = {},
) {
  let revision = 1;
  const spec = {
    id: "words",
    title: "Words",
    activityDescription: "d",
    scenes: [],
    ...(options.criteria ? { acceptance_criterias: options.criteria } : {}),
    ...(options.usesAssessment !== undefined
      ? { runtime: { usesAssessment: options.usesAssessment } }
      : {}),
  };
  const accepted: string[] = [];
  const assessmentInputs: unknown[] = [];
  const activity = {
    id: "act",
    productCode: "words",
    refNum: 1,
    draft: {
      contentRevision: "r1",
      description: options.description ?? "Scene 1: Intro",
      status: "draft" as string,
      spec: null as Record<string, unknown> | null,
      mediaPlan: undefined as
        | { specRevision: string; requirements: Record<string, string>; manifest: AssetManifest }
        | undefined,
    },
  };
  const bump = () => (activity.draft.contentRevision = `r${++revision}`);
  const runs: ActivityRun[] = [];
  const started: string[] = [];
  const cancelled: string[] = [];
  const soundSetups: string[] = [];
  /** The build each test run was asked to play, and the repairs asked for. */
  const tested: (string | undefined)[] = [];
  const repairs: unknown[] = [];
  const reports = new Map<string, AcceptanceReport>();
  const asset = (language: string, key: string) =>
    activity.draft.mediaPlan!.manifest.assets[language]!.find((item) => item.key === key)!;
  const workspace = path.join(workspaces, `world_${++worlds}`);

  /** While held, every run stays under way until the test lets go or the sequence stops it. */
  let holding: Promise<void> | null = null;
  let letGo: () => void = () => {};
  const hold = () => {
    holding = new Promise((resolve) => (letGo = resolve));
    return () => {
      holding = null;
      letGo();
    };
  };
  const aborted = (signal?: AbortSignal) =>
    new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));

  let plans = 0;
  /** The causes the sequence ran under, and how many runs it started outside them. */
  const causes: unknown[] = [];
  let attributed = 0;
  let outside = 0;
  // The generation service's run and accept, as the stages see it: a run starts, settles as a
  // finished Session would, and what it made is accepted onto the draft it started from.
  const stages = {
    async attribute(cause: unknown, operation: () => Promise<unknown>) {
      causes.push(cause);
      attributed++;
      try {
        return await operation();
      } finally {
        attributed--;
      }
    },
    async runAndAccept(
      _p: string,
      _a: string,
      request: RunRequest,
      { agentId, runtime, started: told, signal }: RunAndAcceptOptions,
    ): Promise<RunOutcome> {
      if (!attributed) outside++;
      // The refusals the kinds leave undone rather than fail, as they raise them.
      if (request.kind === "image" && options.noImageKey)
        return {
          outcome: "skipped",
          reason: "providerUnavailable",
          message: "Add GEMINI_API_KEY first.",
        };
      if (request.kind === "assessment") {
        if (!activity.draft.spec || activity.draft.status !== "valid")
          return {
            outcome: "failed",
            error: "Save a valid specification before generating the assessment.",
          };
        const used = (activity.draft.spec.runtime as { usesAssessment?: unknown } | undefined)
          ?.usesAssessment;
        if (used !== true)
          return { outcome: "skipped", reason: "noAssessment", message: "No assessment." };
        if (!(options.canonical ?? true))
          return { outcome: "skipped", reason: "notCanonical", message: "Not canonical." };
        assessmentInputs.push(request.assessment);
      }
      const kind = runKindOf(request);
      // An asset run keeps its target as its run does: a sound's as the run's audio.
      const target = assetTarget(request);
      const run = {
        kind,
        runId: `run_${runs.length + 1}`,
        sessionId: `session_${runs.length + 1}`,
        status: "running",
        error: null,
        agentId,
        codingAgentId: runtime?.codingAgentId,
        ...(kind === "audio" || kind === "image" || kind === "media-text"
          ? { [kind === "media-text" ? "mediaText" : kind]: target }
          : {}),
      } as unknown as ActivityRun;
      runs.push(run);
      if (request.kind === "sound")
        started.push(
          `sound:${request.sound.provider}:${request.sound.language}:${request.sound.assetKey}`,
        );
      else if (request.kind === "module" && request.repair) {
        started.push("module-repair");
        repairs.push(request.repair);
        // It records the test file it was handed, as the module kind does.
        run.repair = { ...request.repair, testSha256: "sha-of-the-tests" };
      } else started.push(target ? `${kind}:${target.language}:${target.assetKey}` : kind);
      // Every test run is handed the earlier tests; a repair that rewrote them hands on others.
      if (request.kind === "test")
        run.test = {
          ...(request.test.moduleRunId ? { moduleRunId: request.test.moduleRunId } : {}),
          cachedTestHash: options.testsRewritten ? "sha-of-rewritten-tests" : "sha-of-the-tests",
        } as ActivityRun["test"];
      told?.(run);
      if (holding) await Promise.race([holding, aborted(signal)]);
      if (signal?.aborted) return { outcome: "stopped", run };
      if (
        options.fail === run.kind ||
        (request.kind === "module" && request.repair && options.failRepair)
      ) {
        run.status = "failed";
        run.error = `${run.kind} broke`;
        // A specification pass fails on what its agent wrote, as the real checks do.
        if (run.kind === "spec" || run.kind === "media-spec") run.repairable = true;
        return { outcome: "failed", run, error: run.error };
      }
      run.status = "succeeded";
      if (run.kind === "module" && options.unchecked) run.unchecked = options.unchecked;
      if (run.kind === "module" && options.playerCheck) {
        const { untrusted, results } = options.playerCheck;
        run.playerCheck = { staged: {}, ...(untrusted ? { untrusted: true } : {}) };
        if (results) {
          const dir = path.join(workspace, run.runId, PLAYER_CHECK_DIR);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, ACCEPTANCE_RESULTS_FILE),
            JSON.stringify({ results: results.map((status) => ({ status })) }),
          );
        }
      }
      if (run.kind === "test")
        reports.set(run.runId, options.reports?.[reports.size] ?? testReport(["passed"], true));
      if (run.kind === "spec") {
        activity.draft.spec = spec;
        activity.draft.status = "valid";
        bump();
      }
      // The media pass saves the specification again, with its media listed.
      if (run.kind === "media-spec") {
        activity.draft.spec = { ...spec, mediaListed: true };
        bump();
      }
      if (run.kind === "audio") {
        asset(run.audio!.language, run.audio!.assetKey).path = (run.audio as { provider?: string })
          .provider
          ? `${run.runId}.mp3`
          : `${run.runId}.wav`;
      } else if (run.kind === "image")
        asset(run.image!.language, run.image!.assetKey).path = `${run.runId}.png`;
      else if (run.kind === "assessment") accepted.push(run.runId);
      else if (run.kind === "media-text") {
        const text = run.mediaText!;
        const translated = asset(text.language, text.assetKey);
        const source = asset("en-US", text.assetKey);
        translated.script = `translated ${source.script}`;
        translated.translatedFrom = source.script;
      } else return { outcome: "succeeded", run };
      bump();
      return { outcome: "accepted", run, draft: structuredClone(activity.draft) as never };
    },
    async cancel(_p: string, _a: string, runId: string) {
      cancelled.push(runId);
      const run = runs.find((item) => item.runId === runId)!;
      run.status = "cancelled";
      return run;
    },
    async soundSetup(projectId: string) {
      soundSetups.push(projectId);
      return {
        providers: (["elevenlabs", "agenthub"] as const).map((id) => ({
          id,
          kinds: ["music", "sfx"],
          available: options.soundProviders?.[id] ?? true,
          ...(id === "agenthub"
            ? {
                modelChoices: options.hubModels ?? [
                  {
                    id: "hub-sound",
                    kinds: ["music", "sfx"],
                    credential: "HUB_KEY",
                    available: options.soundProviders?.agenthub ?? true,
                  },
                ],
              }
            : {}),
        })),
      };
    },
    // No Vault voice: the default ElevenLabs voice is Loom's.
    async elevenLabsDefaultVoice() {
      return ELEVENLABS_BUILTIN_VOICE_ID;
    },
    async getActivity() {
      return structuredClone(activity);
    },
    async planMedia(_p: string, _a: string, expected: string) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      plans++;
      activity.draft.mediaPlan = {
        specRevision: contentRevision(activity.draft.spec),
        requirements: {},
        manifest: manifest(options.romanian),
      };
      if (options.sounds)
        activity.draft.mediaPlan.manifest.assets["en-US"]!.push(
          {
            key: "chime",
            type: "audio",
            kind: "sfx",
            description: "Correct answer",
            script: "bright chime",
            path: "media/chime.mp3",
            usages: usage,
          },
          {
            key: "whoosh",
            type: "audio",
            kind: "sfx",
            description: "Page turn",
            script: '<audio kind="sfx" duration="2">soft paper whoosh</audio>',
            usages: usage,
          },
        );
      if (options.music)
        activity.draft.mediaPlan.manifest.assets["en-US"]!.push({
          key: "tune",
          type: "audio",
          kind: "music",
          description: "Background",
          script: "gentle marimba loop",
          usages: usage,
        });
      bump();
    },
    async currentAssessment() {
      return { items: ["current"] };
    },
    async browserInstalled() {
      return options.browser ?? true;
    },
    async testRun(_p: string, _a: string, moduleRunId?: string) {
      tested.push(moduleRunId);
      return { kind: "test", test: { ...(moduleRunId ? { moduleRunId } : {}) } } as RunRequest;
    },
    workspace(runId: string) {
      return path.join(workspace, runId);
    },
    // The latest finished test run's report, as the acceptance service answers it.
    async state() {
      const latest = runs.filter((run) => run.kind === "test" && run.status === "succeeded").at(-1);
      return {
        report: latest ? (reports.get(latest.runId) ?? null) : null,
        runId: latest?.runId ?? null,
      };
    },
  } as unknown as StagesPort;

  const runner = new PipelineRunner({
    stages,
    now: () => "2026-09-23T12:00:00Z",
    newId: () => "pipeline_1",
  });
  return {
    runner,
    activity,
    runs,
    started,
    cancelled,
    plans: () => plans,
    stages,
    hold,
    asset,
    accepted,
    assessmentInputs,
    soundSetups,
    causes,
    outside: () => outside,
    tested,
    repairs,
  };
}

describe("running the stages", () => {
  it("validates every speech target before recording the first one", async () => {
    const w = world();
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    w.asset("es-MX", "hello").speechProvider = "kokoro";
    w.started.length = 0;
    await w.runner.start("proj", "act", { selection: "speech", agentId: "agent" }).done;
    expect(w.runner.status("act")!.error).toContain("Kokoro does not support es-MX");
    expect(w.started).toEqual([]);
  });
  it("takes an activity from its script to an assembled module, accepting media on the way", async () => {
    const w = world();
    const { state, done } = w.runner.start("proj", "act", { selection: "all", agentId: "agent" });
    expect(state.steps.map((step) => step.status)).toEqual(Array(11).fill("pending"));
    await done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.map((step) => [step.step, step.status])).toEqual([
      ["spec", "succeeded"],
      ["mediaSpec", "succeeded"],
      ["media", "succeeded"],
      ["translations", "skipped"],
      ["speech", "succeeded"],
      // Not a book, so no words to record.
      ["words", "skipped"],
      ["sounds", "skipped"],
      ["images", "succeeded"],
      ["assessment", "skipped"],
      ["module", "succeeded"],
      ["test", "skipped"],
    ]);
    expect(final.steps.at(-1)!.note).toBe("noCriteria");
    expect(w.started).toEqual([
      "spec",
      "media-spec",
      "audio:en-US:hello",
      "audio:es-MX:hello",
      "image:en-US:cat",
      "module",
    ]);
    expect(final.steps[4]).toMatchObject({ done: 2, total: 2 });
    expect(w.activity.draft.mediaPlan!.manifest.assets["es-MX"]![0]!.path).toBe("run_4.wav");
    expect(final.currentRunId).toBeNull();
    expect(final.finishedAt).toBe("2026-09-23T12:00:00Z");
    // Every run was the Stages', whoever asked for them.
    expect(w.causes).toEqual([{ actor: "stages" }]);
    expect(w.outside()).toBe(0);
  });

  it("skips the images without an image provider key and still builds the module", async () => {
    const w = world({ noImageKey: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.find((step) => step.step === "images")).toMatchObject({
      status: "skipped",
      note: "imageProviderUnavailable",
    });
    expect(final.steps.find((step) => step.step === "module")!.status).toBe("succeeded");
  });

  it("says when the module was built but not checked in the player", async () => {
    for (const [unchecked, note] of [
      ["noBrowser", "moduleNotChecked"],
      ["notRun", "moduleCheckSkipped"],
    ] as const) {
      const w = world({ unchecked });
      await w.runner.start("proj", "act", { selection: "module", agentId: "agent" }).done;
      const module = w.runner.status("act")!.steps.find((step) => step.step === "module")!;
      expect(module).toMatchObject({ status: "succeeded", note });
    }
  });

  it("says when the module failed its player check, or its check cannot be trusted, and keeps the build", async () => {
    const note = async (options: Parameters<typeof world>[0]) => {
      const w = world(options);
      await w.runner.start("proj", "act", { selection: "module", agentId: "agent" }).done;
      return w.runner.status("act")!.steps[0];
    };
    expect(await note({ playerCheck: { results: ["passed", "passed"] } })).toMatchObject({
      status: "succeeded",
      note: null,
    });
    expect(await note({ playerCheck: { results: ["passed", "failed"] } })).toMatchObject({
      status: "succeeded",
      note: "moduleChecksFailing",
    });
    // A run that changed what its check rests on: whatever its results say, nothing vouches for
    // them, and that is said before anything else about the check.
    for (const options of [
      { playerCheck: { untrusted: true, results: ["passed" as const] } },
      { playerCheck: { untrusted: true, results: ["failed" as const] } },
      { unchecked: "notRun" as const, playerCheck: { untrusted: true } },
    ])
      expect(await note(options)).toMatchObject({
        status: "succeeded",
        note: "moduleCheckUntrusted",
      });
  });

  it("keeps a current media plan instead of rebuilding it", async () => {
    const w = world();
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    expect(w.plans()).toBe(1);
    expect(w.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "planCurrent",
    });
  });

  it("stops at the first failure with the run's own reason, and runs nothing after it", async () => {
    const w = world({ fail: "audio" });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("failed");
    expect(final.error).toBe("audio broke");
    expect(final.steps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "skipped",
      "failed",
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect(w.started).toEqual(["spec", "media-spec", "audio:en-US:hello"]);
  });

  it("runs a failed media pass once more, told why, and stops when that fails too", async () => {
    const w = world({ fail: "media-spec" });
    const requests: unknown[] = [];
    const runAndAccept = w.stages.runAndAccept.bind(w.stages);
    (w.stages as { runAndAccept: typeof runAndAccept }).runAndAccept = (p, a, request, options) => {
      requests.push(request);
      return runAndAccept(p, a, request, options);
    };
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(w.started).toEqual(["spec", "media-spec", "media-spec"]);
    expect(requests).toEqual([
      { kind: "spec" },
      { kind: "media-spec" },
      { kind: "media-spec", repair: "media-spec broke" },
    ]);
    expect(final.steps[1]).toMatchObject({
      step: "mediaSpec",
      status: "failed",
      runIds: ["run_2", "run_3"],
      // The latest run's session, kept with the step for its history.
      sessionId: "session_3",
    });
    expect(final.error).toBe("media-spec broke");
  });

  it("refuses to start without a script, and says so", async () => {
    const w = world({ description: "  " });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(w.runner.status("act")!.error).toBe(
      "Write the activity script before generating the specification.",
    );
    expect(w.started).toEqual([]);
  });

  it("generates media with a coding agent too, handing it no runtime, and assembles with it", async () => {
    const w = world();
    await w.runner.start("proj", "act", {
      selection: "all",
      agentId: "",
      codingAgentId: "codex",
    }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.map((step) => step.note)).not.toContain("needsPenguinAgent");
    // The same stages a Penguin agent runs, media included.
    const penguin = world();
    await penguin.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(w.started).toEqual(penguin.started);
    // The generation service gives media runs to the Media Agent; the sequence names no runtime.
    const media = /^(audio|image|sound):/;
    w.started.forEach((entry, i) =>
      expect(w.runs[i]!.codingAgentId, String(entry)).toBe(
        media.test(String(entry)) ? undefined : "codex",
      ),
    );
  });

  it("refuses a second sequence while one runs, and stops the run in flight on request", async () => {
    const w = world();
    // Hold every run open until the test lets go.
    const release = w.hold();
    const { done } = w.runner.start("proj", "act", { selection: "all", agentId: "agent" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => w.runner.start("proj", "act", { selection: "all", agentId: "agent" })).toThrow(
      /already running/,
    );
    expect(w.runner.status("act")!.currentRunId).toBe("run_1");
    await w.runner.stop("act");
    release();
    await done;
    const final = w.runner.status("act")!;
    expect(w.cancelled).toEqual(["run_1"]);
    expect(final.status).toBe("cancelled");
    expect(final.error).toBeNull();
    expect(final.steps.map((step) => step.status)).toEqual(Array(11).fill("cancelled"));
  });

  it("stops stepping when its component goes away, leaving the run in flight alone", async () => {
    const w = world();
    const release = w.hold();
    const { done } = w.runner.start("proj", "act", { selection: "all", agentId: "agent" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    w.runner.dispose();
    release();
    await done;
    expect(w.started).toEqual(["spec"]);
    expect(w.cancelled).toEqual([]);
    expect(w.runner.status("act")!.status).toBe("cancelled");
  });

  it("translates what a language lacks before speaking it, and leaves hand-written lines be", async () => {
    const w = world({ romanian: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    // es-MX "Hola" has no recorded source, so it was written, not translated: left alone.
    expect(w.started).toEqual([
      "spec",
      "media-spec",
      "media-text:ro-RO:hello",
      "audio:en-US:hello",
      "audio:es-MX:hello",
      "audio:ro-RO:hello",
      "image:en-US:cat",
      "module",
    ]);
    const ro = w.activity.draft.mediaPlan!.manifest.assets["ro-RO"]![0]!;
    expect(ro).toMatchObject({ script: "translated Hello", translatedFrom: "Hello" });
    expect(w.runs.find((run) => run.kind === "media-text")).toMatchObject({
      mediaText: { language: "ro-RO", assetKey: "hello", translate: true },
    });
  });

  it("finds narrations never translated, or translated from a line since rewritten", () => {
    const plan = manifest(true);
    plan.assets["es-MX"]![0]!.translatedFrom = "Hi there";
    expect(translationTargets(plan)).toEqual([
      { language: "es-MX", assetKey: "hello" },
      { language: "ro-RO", assetKey: "hello" },
    ]);
    plan.assets["es-MX"]![0]!.translatedFrom = "Hello";
    expect(translationTargets(plan)).toEqual([{ language: "ro-RO", assetKey: "hello" }]);
  });

  it("translates and speaks one language in one go, touching no other", async () => {
    const w = world({ romanian: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const ro = w.activity.draft.mediaPlan!.manifest.assets["ro-RO"]![0]!;
    delete ro.path;
    delete ro.script;
    delete ro.translatedFrom;
    w.started.length = 0;
    const { state, done } = w.runner.start("proj", "act", {
      selection: "narration",
      agentId: "agent",
      scope: { language: "ro-RO" },
    });
    expect(state.scope).toEqual({ language: "ro-RO" });
    await done;
    expect(w.started).toEqual(["media-text:ro-RO:hello", "audio:ro-RO:hello"]);
    expect(w.runner.status("act")!.status).toBe("succeeded");
  });

  it("speaks each narration in its own saved voice, and the run's voice where none is saved", async () => {
    const w = world();
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    for (const language of ["en-US", "es-MX"]) {
      delete w.asset(language, "hello").path;
      // Gemini voices, so the narrations name Gemini rather than take the default.
      w.asset(language, "hello").speechProvider = "gemini";
    }
    w.asset("en-US", "hello").voice = "Fenrir";
    w.asset("es-MX", "hello").voice = "Retired voice";
    const before = w.runs.length;
    await w.runner.start("proj", "act", { selection: "speech", agentId: "agent", voice: "Puck" })
      .done;
    expect(w.runner.status("act")!.status).toBe("succeeded");
    expect(
      w.runs.slice(before).map((run) => [run.audio!.language, (run.audio as any).voice]),
    ).toEqual([
      ["en-US", "Fenrir"],
      ["es-MX", "Puck"],
    ]);
  });

  it("writes and accepts the assessment when the specification uses one, handing it the current one", async () => {
    const w = world({ usesAssessment: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.find((step) => step.step === "assessment")).toMatchObject({
      status: "succeeded",
      note: null,
      runIds: ["run_6"],
    });
    expect(w.started).toEqual([
      "spec",
      "media-spec",
      "audio:en-US:hello",
      "audio:es-MX:hello",
      "image:en-US:cat",
      "assessment",
      "module",
    ]);
    expect(w.accepted).toEqual(["run_6"]);
    expect(w.assessmentInputs).toEqual([{ current: { items: ["current"] } }]);
  });

  it("skips the assessment with a worded note when it is unused or the ref does not own it", async () => {
    const unused = world({ usesAssessment: false });
    await unused.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(
      unused.runner.status("act")!.steps.find((step) => step.step === "assessment"),
    ).toMatchObject({ status: "skipped", note: "noAssessment" });
    const shared = world({ usesAssessment: true, canonical: false });
    await shared.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(
      shared.runner.status("act")!.steps.find((step) => step.step === "assessment"),
    ).toMatchObject({ status: "skipped", note: "notCanonical" });
    expect(shared.accepted).toEqual([]);
    expect(shared.started).not.toContain("assessment");
  });

  it("stops at a failed assessment run with its own reason", async () => {
    const w = world({ usesAssessment: true, fail: "assessment" });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("failed");
    expect(final.error).toBe("assessment broke");
    expect(final.steps.at(-1)!.status).toBe("cancelled");
  });

  it("runs the acceptance tests after assembly when there are criteria and a test browser", async () => {
    const w = world({ criteria: ["Tapping the cat plays its name."] });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.at(-1)).toMatchObject({ step: "test", status: "succeeded", note: null });
    expect(w.started.slice(-2)).toEqual(["module", "test"]);
    expect(final.steps.at(-1)!.runIds).toEqual([w.runs.at(-1)!.runId]);
  });

  it("skips the tests with a worded note without criteria or without the test browser", async () => {
    const none = world();
    await none.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await none.runner.start("proj", "act", { selection: "test", agentId: "agent" }).done;
    expect(none.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "noCriteria",
    });
    const noBrowser = world({ criteria: ["It starts."], browser: false });
    await noBrowser.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await noBrowser.runner.start("proj", "act", { selection: "test", agentId: "agent" }).done;
    expect(noBrowser.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "noBrowser",
    });
    expect([...none.started, ...noBrowser.started]).not.toContain("test");
  });

  it("stops at a failed test run with its own reason", async () => {
    const w = world({ criteria: ["It starts."], fail: "test" });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("failed");
    expect(final.error).toBe("test broke");
    expect(final.steps.at(-1)!.status).toBe("failed");
  });

  describe("continuing from a stage", () => {
    it("runs the stage a sequence stopped at and every one after it, and none before", async () => {
      const options: NonNullable<Parameters<typeof world>[0]> = { fail: "image" };
      const w = world(options);
      await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
      const failed = w.runner.status("act")!;
      expect(failed.status).toBe("failed");
      expect(failed.steps.find((step) => step.status === "failed")!.step).toBe("images");
      delete options.fail;
      w.started.length = 0;
      const { state, done } = w.runner.start("proj", "act", {
        selection: { from: "images" },
        agentId: "agent",
      });
      expect(state.selection).toEqual({ from: "images" });
      expect(state.steps.map((step) => step.step)).toEqual([
        "images",
        "assessment",
        "module",
        "test",
      ]);
      await done;
      expect(w.runner.status("act")!.status).toBe("succeeded");
      // The specification, media and speech the failed sequence made are not made again.
      expect(w.started).toEqual(["image:en-US:cat", "module"]);
    });

    it("tests what the preview plays when it takes up at the tests, and the build it makes from the module on", async () => {
      const atTests = world({ criteria: ["It starts."] });
      await atTests.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
      await atTests.runner.start("proj", "act", { selection: { from: "test" }, agentId: "agent" })
        .done;
      // No module step ran in this sequence, so the tests play what the preview plays.
      expect(atTests.tested).toEqual([undefined]);
      expect(atTests.runner.status("act")!.steps).toMatchObject([
        { step: "test", status: "succeeded" },
      ]);

      const atModule = world({ criteria: ["It starts."] });
      await atModule.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
      await atModule.runner.start("proj", "act", {
        selection: { from: "module" },
        agentId: "agent",
      }).done;
      const built = atModule.runs.find((run) => run.kind === "module")!.runId;
      expect(atModule.tested).toEqual([built]);
    });
  });

  describe("the test step's repair round", () => {
    const criteria = ["Tapping the cat plays its name.", "The cat waves."];
    const all = async (w: ReturnType<typeof world>) => {
      await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
      return w.runner.status("act")!;
    };
    const runOf = (w: ReturnType<typeof world>, kind: string, nth = 0) =>
      w.runs.filter((run) => run.kind === kind)[nth]!.runId;

    it("tests the build the sequence just made, and repairs nothing when every check passes", async () => {
      const w = world({ criteria });
      const final = await all(w);
      expect(w.tested).toEqual([runOf(w, "module")]);
      expect(w.repairs).toEqual([]);
      expect(final.steps.at(-1)).toMatchObject({ status: "succeeded", note: null });
    });

    it("rebuilds once from the tested build with what failed, then runs the same tests on it", async () => {
      const w = world({
        criteria,
        reports: [testReport(["passed", "failed"]), testReport(["passed", "passed"], true)],
      });
      const final = await all(w);
      expect(final.status).toBe("succeeded");
      expect(w.started.slice(-4)).toEqual(["module", "test", "module-repair", "test"]);
      const [first, second] = [runOf(w, "test"), runOf(w, "test", 1)];
      expect(w.repairs).toEqual([{ fromRunId: runOf(w, "module"), testRunId: first }]);
      // The second tests play the repaired build.
      expect(w.tested).toEqual([runOf(w, "module"), runOf(w, "module", 1)]);
      expect(final.steps.at(-1)).toMatchObject({
        status: "succeeded",
        note: null,
        runIds: [first, runOf(w, "module", 1), second],
      });
    });

    it("says when checks still fail after the round, or ran changed tests", async () => {
      const still = world({
        criteria,
        reports: [testReport(["failed", "passed"]), testReport(["failed", "passed"], true)],
      });
      expect((await all(still)).steps.at(-1)).toMatchObject({
        status: "succeeded",
        note: "testsStillFailing",
      });
      // Passing tests that are not the ones handed over prove nothing.
      const changed = world({
        criteria,
        reports: [testReport(["failed", "passed"]), testReport(["passed", "passed"], false)],
      });
      expect((await all(changed)).steps.at(-1)).toMatchObject({ note: "testsStillFailing" });
    });

    it("repairs nothing for a check that never ran, nor without a build to start from", async () => {
      const notRun = world({ criteria, reports: [testReport(["passed", "notRun"])] });
      expect((await all(notRun)).steps.at(-1)).toMatchObject({
        status: "succeeded",
        note: "testsFailing",
      });
      expect(notRun.repairs).toEqual([]);
      // Tests run on their own play what the preview plays, which may be no build of the activity.
      const alone = world({ criteria, reports: [testReport(["failed"])] });
      await alone.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
      await alone.runner.start("proj", "act", { selection: "test", agentId: "agent" }).done;
      expect(alone.tested).toEqual([undefined]);
      expect(alone.repairs).toEqual([]);
      expect(alone.runner.status("act")!.steps[0]).toMatchObject({
        status: "succeeded",
        note: "testsFailing",
      });
    });

    it("trusts the second tests only as the test file the repair was handed", async () => {
      const w = world({
        criteria,
        testsRewritten: true,
        reports: [testReport(["failed"]), testReport(["passed"], true)],
      });
      expect((await all(w)).steps.at(-1)).toMatchObject({
        status: "succeeded",
        note: "testsStillFailing",
      });
    });

    it("says when a report cannot be trusted, and repairs nothing from it", async () => {
      const untrusted = (report: AcceptanceReport): AcceptanceReport => ({
        ...report,
        untrusted: true,
      });
      const first = world({ criteria, reports: [untrusted(testReport(["passed"]))] });
      expect((await all(first)).steps.at(-1)).toMatchObject({
        status: "succeeded",
        note: "testsUntrusted",
      });
      expect(first.repairs).toEqual([]);
      const second = world({
        criteria,
        reports: [testReport(["failed"]), untrusted(testReport(["passed"], true))],
      });
      expect((await all(second)).steps.at(-1)).toMatchObject({ note: "testsUntrusted" });
    });

    it("keeps the first findings when the round cannot finish", async () => {
      const w = world({ criteria, failRepair: true, reports: [testReport(["failed"])] });
      const final = await all(w);
      expect(final.status).toBe("succeeded");
      expect(w.started.slice(-2)).toEqual(["test", "module-repair"]);
      expect(final.steps.at(-1)).toMatchObject({ status: "succeeded", note: "testsFailing" });
    });
  });

  it("limits targets to the scope's language and asset", () => {
    const targets = [
      { language: "ro-RO", assetKey: "a" },
      { language: "ro-RO", assetKey: "b" },
      { language: "es-MX", assetKey: "a" },
    ];
    expect(inScope(targets, undefined)).toEqual(targets);
    expect(inScope(targets, { language: "ro-RO" })).toEqual(targets.slice(0, 2));
    expect(inScope(targets, { language: "ro-RO", assetKey: "b" })).toEqual([targets[1]]);
  });
});

describe("the sounds step", () => {
  it("finds unbound music and effects with a usable prompt, and no narration", () => {
    const plan = manifest();
    plan.assets["en-US"]!.push(
      {
        key: "bound",
        type: "audio",
        kind: "sfx",
        description: "b",
        script: "x",
        path: "a.mp3",
        usages: usage,
      },
      {
        key: "tune",
        type: "audio",
        kind: "music",
        description: "m",
        script: "marimba loop",
        usages: usage,
      },
      {
        key: "empty",
        type: "audio",
        kind: "sfx",
        description: "e",
        script: '<audio kind="sfx"> </audio>',
        usages: usage,
      },
      {
        key: "long",
        type: "audio",
        kind: "sfx",
        description: "l",
        script: "x".repeat(2001),
        usages: usage,
      },
    );
    expect(soundTargets(plan)).toEqual([{ language: "en-US", assetKey: "tune" }]);
  });

  it("generates and accepts the one sound with a prompt and no file, after speech, leaving narration as it was", async () => {
    const w = world({ sounds: true });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.find((step) => step.step === "sounds")).toMatchObject({
      status: "succeeded",
      note: null,
      done: 1,
      total: 1,
      runIds: ["run_5"],
    });
    expect(w.started).toEqual([
      "spec",
      "media-spec",
      "audio:en-US:hello",
      "audio:es-MX:hello",
      "sound:elevenlabs:en-US:whoosh",
      "image:en-US:cat",
      "module",
    ]);
    expect(w.asset("en-US", "whoosh").path).toBe("run_5.mp3");
    expect(w.asset("en-US", "chime").path).toBe("media/chime.mp3");
    expect(w.soundSetups).toEqual(["proj"]);
  });

  it("uses the provider the sequence names", async () => {
    const w = world({ sounds: true });
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "agent",
      soundProvider: "agenthub",
    }).done;
    expect(w.started.at(-1)).toBe("sound:agenthub:en-US:whoosh");
  });

  it("skips with noSounds when nothing is missing, without asking about providers", async () => {
    const w = world();
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    expect(w.runner.status("act")!.steps.find((step) => step.step === "sounds")).toMatchObject({
      status: "skipped",
      note: "noSounds",
    });
    expect(w.soundSetups).toEqual([]);
  });

  it("skips, not fails, when the provider cannot be used, and runs the stages after it", async () => {
    const w = world({ sounds: true, soundProviders: { elevenlabs: false } });
    await w.runner.start("proj", "act", { selection: "all", agentId: "agent" }).done;
    const final = w.runner.status("act")!;
    expect(final.status).toBe("succeeded");
    expect(final.steps.find((step) => step.step === "sounds")).toMatchObject({
      status: "skipped",
      note: "soundProviderUnavailable",
      runIds: [],
    });
    expect(w.started).not.toContain("sound:elevenlabs:en-US:whoosh");
    expect(w.started.at(-1)).toBe("module");
  });

  it("makes only the kinds the provider can make now, and skips when it can make none", async () => {
    // The hub's one usable model makes effects only; its music model has no key.
    const hubModels = [
      { id: "fx", kinds: ["sfx" as const], credential: "FX_KEY", available: true },
      { id: "tunes", kinds: ["music" as const], credential: "MUSIC_KEY", available: false },
    ];
    const w = world({ sounds: true, music: true, hubModels });
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "agent",
      soundProvider: "agenthub",
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({
      status: "succeeded",
      done: 1,
      total: 1,
    });
    expect(w.started.filter((entry) => entry.startsWith("sound:"))).toEqual([
      "sound:agenthub:en-US:whoosh",
    ]);
    expect(w.asset("en-US", "tune").path).toBeUndefined();

    // With only the music left, the provider can make nothing: skipped, not failed.
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "agent",
      soundProvider: "agenthub",
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({
      status: "skipped",
      note: "soundProviderUnavailable",
    });
    expect(w.started.filter((entry) => entry.startsWith("sound:"))).toHaveLength(1);
  });

  it("keeps to the scope's language, and makes sounds for a coding agent too", async () => {
    const w = world({ sounds: true });
    await w.runner.start("proj", "act", { selection: "spec", agentId: "agent" }).done;
    await w.runner.start("proj", "act", { selection: "media", agentId: "agent" }).done;
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "agent",
      scope: { language: "es-MX" },
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({ status: "skipped", note: "noSounds" });
    await w.runner.start("proj", "act", {
      selection: "sounds",
      agentId: "",
      codingAgentId: "codex",
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({ status: "succeeded", done: 1 });
    expect(w.started.at(-1)).toBe("sound:elevenlabs:en-US:whoosh");
    expect(w.runs.at(-1)?.codingAgentId).toBeUndefined();
  });
});

/** A decodable book's plan with words: one ready to record, one recorded, one unsounded. */
function wordWorld(
  options: {
    activityType?: "book" | "standard";
    bookMode?: "decodable" | "readAlong" | null;
    elevenlabs?: boolean;
    words?: MediaAsset[];
    /** Whether the agent's sounds run proposes sounds for the words without any. */
    proposes?: boolean;
    /** Press Stop as the first sounds run is accepted. */
    stopAfterFirstSounds?: boolean;
    /** Press Stop while the first sounds run is still under way (it then finishes anyway). */
    stopDuringFirstSounds?: boolean;
  } = {},
) {
  const word = (normalized: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
    key: `book-word-${normalized}`,
    type: "audio",
    role: "bookWord",
    description: normalized,
    word: normalized,
    normalizedWord: normalized,
    usages: usage,
    ...extra,
  });
  let revision = 1;
  const activity = {
    id: "act",
    productCode: "words",
    refNum: 1,
    activityType: options.activityType ?? "book",
    draft: {
      contentRevision: "r1",
      description: "A book",
      status: "valid",
      spec: {},
      mediaPlan: {
        specRevision: "s",
        requirements: {},
        manifest: {
          productCode: "words",
          refNum: 1,
          assets: {
            "en-US": options.words ?? [
              word("cat", { phonemes: ["k", "æ", "t"] }),
              word("sat", { phonemes: ["s", "æ", "t"], path: "media/sat.wav", script: "x" }),
              word("ran"),
              word("the", { phonemes: ["ð", "ə"], speechProvider: "gemini", voice: "Puck" }),
            ],
          },
        } as AssetManifest,
      },
    },
  };
  const bump = () => (activity.draft.contentRevision = `r${++revision}`);
  const group = () => activity.draft.mediaPlan.manifest.assets["en-US"]!;
  const runs: ActivityRun[] = [];
  const started: unknown[] = [];
  const prepared: string[] = [];
  const refreshed: string[] = [];
  const asked: string[][] = [];
  const acceptedSounds: string[] = [];
  const stages = {
    attribute: (_cause: unknown, operation: () => Promise<unknown>) => operation(),
    async runAndAccept(
      _p: string,
      _a: string,
      request: RunRequest,
      { agentId, started: told, signal }: RunAndAcceptOptions,
    ): Promise<RunOutcome> {
      if (request.kind === "phonemes") {
        asked.push(request.phonemes.words as string[]);
        if (options.stopDuringFirstSounds && asked.length === 1) void runner.stop("act");
        const run = {
          kind: "phonemes",
          runId: `phonemes_${asked.length}`,
          sessionId: null,
          status: "running",
          error: null,
          agentId,
          phonemes: request.phonemes,
        } as unknown as ActivityRun;
        runs.push(run);
        told?.(run);
        // A run that finished as Stop was pressed is not accepted.
        if (signal?.aborted) return { outcome: "stopped", run };
        run.status = "succeeded";
        // The proposal, accepted: each asked word sounded out letter by letter.
        acceptedSounds.push(run.runId);
        if (options.stopAfterFirstSounds && asked.length === 1) void runner.stop("act");
        if (options.proposes)
          for (const asset of group())
            if ((request.phonemes.words as string[]).includes(asset.normalizedWord!))
              asset.phonemes = [...asset.normalizedWord!];
        bump();
        return { outcome: "accepted", run, draft: structuredClone(activity.draft) as never };
      }
      if (request.kind !== "speech") throw new Error(`Unexpected ${request.kind} run.`);
      const asset = group().find((item) => item.key === request.speech.assetKey)!;
      started.push({ ...request.speech, script: asset.script });
      const run = {
        kind: "audio",
        runId: `run_${runs.length + 1}`,
        sessionId: `session_${runs.length + 1}`,
        status: "running",
        error: null,
        agentId,
        audio: request.speech,
      } as unknown as ActivityRun;
      runs.push(run);
      told?.(run);
      if (signal?.aborted) return { outcome: "stopped", run };
      run.status = "succeeded";
      asset.path = `media/${run.runId}.mp3`;
      bump();
      return { outcome: "accepted", run, draft: structuredClone(activity.draft) as never };
    },
    async speechSetup() {
      return {
        providers: [
          { id: "gemini", available: true },
          { id: "elevenlabs", available: options.elevenlabs ?? true },
        ],
      };
    },
    // No Vault voice: the default ElevenLabs voice is Loom's.
    async elevenLabsDefaultVoice() {
      return ELEVENLABS_BUILTIN_VOICE_ID;
    },
    async cancel() {},
    async getActivity() {
      return structuredClone(activity);
    },
    async bookWordsState() {
      return { bookMode: options.bookMode === undefined ? "decodable" : options.bookMode };
    },
    // The words are already planned here; the stage plans them again before recording.
    async refreshBookWords(_p: string, _a: string, language: string, expected: string) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      refreshed.push(language);
      return {};
    },
    async prepareWordRecordings(
      _p: string,
      _a: string,
      provider: SpeechProviderId,
      expected: string,
      language?: string,
    ) {
      if (expected !== activity.draft.contentRevision) throw new Error("draft_conflict");
      prepared.push(`${provider}:${language ?? "all"}`);
      const before = structuredClone(group());
      for (const asset of group())
        if (asset.phonemes?.length && !asset.path && !asset.speechProvider)
          asset.speechProvider = provider;
      syncWordScripts(group(), before);
      bump();
      return structuredClone(activity.draft);
    },
  } as unknown as StagesPort;
  const runner = new PipelineRunner({
    stages,
    now: () => "2026-09-25T12:00:00Z",
    newId: () => "pipeline_words",
  });
  return { runner, activity, group, started, prepared, refreshed, asked, acceptedSounds, word };
}

describe("the words step", () => {
  it("plans the book's words for each language before recording them", async () => {
    const w = wordWorld();
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent" }).done;
    expect(w.refreshed).toEqual(Object.keys(w.activity.draft.mediaPlan!.manifest.assets));
  });

  it("asks the agent for the sounds of words without any, then records them too", async () => {
    const w = wordWorld({ proposes: true });
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent" }).done;
    expect(w.asked).toEqual([["ran"]]);
    expect(w.runner.status("act")!.steps[0]).toMatchObject({ status: "succeeded", total: 3 });
    expect(w.group().find((item) => item.key === "book-word-ran")!.path).toMatch(/^media\//);
  });

  it("asks in runs of at most 200 words, so every word without sounds is asked about", async () => {
    const words = Array.from({ length: 450 }, (_, index) => `w${index}`);
    const w = wordWorld({ proposes: true });
    w.activity.draft.mediaPlan.manifest.assets["en-US"] = words.map((word) => w.word(word));
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent" }).done;
    expect(w.asked.map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(w.asked.flat()).toEqual(words);
  });

  it("starts no further sounds run after Stop, even when the run under way had finished", async () => {
    const w = wordWorld({ proposes: true, stopAfterFirstSounds: true });
    w.activity.draft.mediaPlan.manifest.assets["en-US"] = Array.from({ length: 450 }, (_, index) =>
      w.word(`w${index}`),
    );
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent" }).done;
    expect(w.asked).toHaveLength(1);
    expect(w.started).toEqual([]);
    expect(w.runner.status("act")!.status).toBe("cancelled");
  });

  it("does not accept a sounds run that finished after Stop was pressed", async () => {
    const w = wordWorld({ proposes: true, stopDuringFirstSounds: true });
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent" }).done;
    expect(w.asked).toHaveLength(1);
    expect(w.acceptedSounds).toEqual([]);
    expect(w.group().find((item) => item.key === "book-word-ran")!.phonemes).toBeUndefined();
    expect(w.runner.status("act")!.status).toBe("cancelled");
  });

  it("asks only about the one word a run is scoped to", async () => {
    const w = wordWorld({ proposes: true });
    await w.runner.start("proj", "act", {
      selection: "words",
      agentId: "agent",
      scope: { language: "en-US", assetKey: "book-word-cat" },
    }).done;
    // cat has sounds already, so nothing is asked, and ran's missing sounds are not this run's.
    expect(w.asked).toEqual([]);
    expect(w.runner.status("act")!.steps[0]).toMatchObject({ status: "succeeded", total: 1 });
  });

  it("records each word with sounds and no recording, in its provider's script, and accepts it", async () => {
    const w = wordWorld();
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent", voice: "Kore" })
      .done;
    const step = w.runner.status("act")!.steps[0]!;
    expect(step).toMatchObject({ step: "words", status: "succeeded", done: 2, total: 2 });
    // ElevenLabs can be used, so the word naming no provider takes it; "the" keeps Gemini.
    expect(w.prepared).toEqual(["elevenlabs:all"]);
    expect(w.started).toEqual([
      {
        language: "en-US",
        assetKey: "book-word-cat",
        provider: "elevenlabs",
        voice: ELEVENLABS_DEFAULT_VOICE,
        script: drawnOutScript("cat", ["k", "æ", "t"]),
      },
      {
        language: "en-US",
        assetKey: "book-word-the",
        provider: "gemini",
        voice: "Puck",
        script: geminiScript("the", ["ð", "ə"]),
      },
    ]);
    // The sounds run for "ran" came first (this agent proposes none), so this is the second run.
    expect(w.group().find((item) => item.key === "book-word-cat")!.path).toBe("media/run_2.mp3");
    // The word without sounds is left for later.
    expect(w.group().find((item) => item.key === "book-word-ran")!.path).toBeUndefined();
  });

  it("speaks with Gemini when the agent cannot use ElevenLabs", async () => {
    const w = wordWorld({ elevenlabs: false });
    await w.runner.start("proj", "act", { selection: "words", agentId: "agent" }).done;
    expect(w.prepared).toEqual(["gemini:all"]);
    expect(w.started[0]).toMatchObject({
      assetKey: "book-word-cat",
      provider: "gemini",
      script: geminiScript("cat", ["k", "æ", "t"]),
    });
  });

  it("skips with a note for anything but a decodable book or nothing to record", async () => {
    const skipped = async (world: ReturnType<typeof wordWorld>, input = {}) => {
      await world.runner.start("proj", "act", { selection: "words", agentId: "agent", ...input })
        .done;
      return world.runner.status("act")!.steps[0]!;
    };
    expect(await skipped(wordWorld({ activityType: "standard" }))).toMatchObject({
      status: "skipped",
      note: "notDecodable",
    });
    expect(await skipped(wordWorld({ bookMode: "readAlong" }))).toMatchObject({
      note: "notDecodable",
    });
    // No mode recorded: the sequence's choice counts, and so do words already listed.
    expect(
      await skipped(wordWorld({ bookMode: null, words: [] }), { bookMode: "readAlong" }),
    ).toMatchObject({ note: "notDecodable" });
    expect(await skipped(wordWorld({ bookMode: null }))).toMatchObject({ status: "succeeded" });
    // A coding agent running the stages still records: the Media Agent speaks.
    expect(await skipped(wordWorld(), { agentId: "", codingAgentId: "codex" })).toMatchObject({
      status: "succeeded",
    });
    const unsounded = wordWorld();
    unsounded.activity.draft.mediaPlan.manifest.assets["en-US"] = [unsounded.word("ran")];
    expect(await skipped(unsounded)).toMatchObject({ note: "wordsMissingSounds" });
    const recorded = wordWorld();
    recorded.activity.draft.mediaPlan.manifest.assets["en-US"] = [];
    expect(await skipped(recorded)).toMatchObject({ note: "noWords" });
    expect(recorded.prepared).toEqual([]);
  });

  it("keeps to the scope's language", async () => {
    const w = wordWorld();
    await w.runner.start("proj", "act", {
      selection: "words",
      agentId: "agent",
      scope: { language: "es-MX" },
    }).done;
    expect(w.runner.status("act")!.steps[0]).toMatchObject({ status: "skipped", note: "noWords" });
    expect(w.started).toEqual([]);
  });
});
