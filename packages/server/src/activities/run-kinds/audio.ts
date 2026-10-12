/**
 * Speech and sound: one asset's clip, made with no agent. The server runs the provider's
 * helper in the run's workspace (or a model on this machine), as Loom's audio stage calls its
 * provider, and keeps the clip it wrote.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../http/errors.js";
import { readArtifactBytes } from "../artifact.js";
import {
  AUDIO_MAX_BYTES,
  SPEECH_OUTPUT_FILES,
  SPEECH_TIMINGS_FILE,
  audioTarget,
  speechProviderOf,
  type AudioResult,
  type AudioTarget,
} from "../audio.js";
import { soundProviderFor, speechProviderFor } from "../audio-providers.js";
import type { AudioRun } from "../domain.js";
import type { LocalAudioRequest } from "../local-audio.js";
import { isLocalAudioProvider } from "../local-audio-models.js";
import { NARRATION_DELIVERY } from "../media-style.js";
import { soundPromptOf } from "../playback.js";
import type { RunRequestOf } from "../run-request.js";
import { atomicJson } from "../service.js";
import { SOUND_OUTPUT_FILES, soundTarget, type SoundTarget } from "../sound.js";
import { AGENTHUB_VERSION } from "../sound-models.js";
import type { SoundFormat } from "../sound-types.js";
import { ELEVENLABS_DEFAULT_VOICE } from "../voice-catalogue.js";
import { alignmentProblems, normalizeAlignment } from "../word-timings.js";
import {
  bundledMediaHelper,
  type Acceptance,
  type RunKindServices,
  type ServerRunKind,
} from "./contract.js";

/** Word timings are small; a sidecar past this is not one. */
const SPEECH_TIMINGS_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The file a sound run must collect: the format its request named (a hub model's catalogued
 * format), else MP3, the only format ElevenLabs' helper writes. The other file being present
 * fails the run, so audio the helper did not write is never bound as the provider's
 * candidate. Its name only picks the check; the bytes must still pass it.
 */
async function soundOutputFormat(workspace: string, expected: SoundFormat): Promise<SoundFormat> {
  const other: SoundFormat = expected === "mp3" ? "wav" : "mp3";
  const stray = await fs
    .lstat(path.join(workspace, SOUND_OUTPUT_FILES[other]))
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  if (stray)
    throw new Error(
      `The sound run wrote ${SOUND_OUTPUT_FILES[other]}, but its model returns ${SOUND_OUTPUT_FILES[expected]}.`,
    );
  return expected;
}

/**
 * The clip a speech run must collect: its provider's file. The other provider's file being
 * present fails the run, as for sounds, so a clip the chosen provider did not make is never
 * bound as its recording.
 */
async function speechOutputFile(workspace: string, target: AudioTarget): Promise<string> {
  const provider = speechProviderOf(target);
  const other = SPEECH_OUTPUT_FILES[provider === "gemini" ? "elevenlabs" : "gemini"];
  const stray = await fs
    .lstat(path.join(workspace, other))
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  if (stray)
    throw new Error(
      `The speech run wrote ${other}, but its provider returns ${SPEECH_OUTPUT_FILES[provider]}.`,
    );
  return SPEECH_OUTPUT_FILES[provider];
}

/**
 * The word timings a speech helper wrote beside its clip, checked against the script it
 * spoke, or undefined when it wrote none (a provider without timestamps). Timings that do
 * not fit the script fail the run rather than bind a read-along that highlights the wrong
 * words.
 */
async function speechTimings(workspace: string, script: string) {
  let text: string;
  try {
    text = (
      await readArtifactBytes(path.join(workspace, SPEECH_TIMINGS_FILE), SPEECH_TIMINGS_MAX_BYTES)
    ).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${SPEECH_TIMINGS_FILE} is not JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${SPEECH_TIMINGS_FILE} must be a list of timings.`);
  const timings = normalizeAlignment(script, parsed);
  if (!timings)
    throw new Error(
      `The provider's word timings do not fit the script: ${alignmentProblems(script, parsed)[0]}`,
    );
  return timings;
}

/**
 * Keeps what an audio run's helper wrote as its candidate: the provider's clip, and for a
 * provider with timestamps the words' timings, checked before anything is stored. Throws when
 * the output is missing or wrong.
 */
async function keepClip(
  services: RunKindServices,
  run: AudioRun,
  workspace: string,
): Promise<string> {
  const soundFormat = run.audio.sound
    ? await soundOutputFormat(workspace, run.audio.sound.format ?? "mp3")
    : undefined;
  const file = soundFormat
    ? SOUND_OUTPUT_FILES[soundFormat]
    : await speechOutputFile(workspace, run.audio);
  const format = soundFormat ?? (speechProviderOf(run.audio) === "elevenlabs" ? "mp3" : undefined);
  // Checked before the clip is kept, so a mismatch leaves nothing stored. Only a provider that
  // returns timings is read; a timings file on any other run is not its provider's and is
  // ignored.
  const speech = run.audio.sound
    ? undefined
    : speechProviderFor({ speechProvider: speechProviderOf(run.audio) }, null);
  const timings =
    speech && "provider" in speech && speech.timings
      ? await speechTimings(workspace, run.audio.script)
      : undefined;
  const bytes = await readArtifactBytes(path.join(workspace, file), AUDIO_MAX_BYTES);
  const result = await services.activities.storeAudio(
    run.projectId,
    run.activityId,
    run.runId,
    bytes,
    format,
  );
  return JSON.stringify(timings?.length ? { ...result, wordTimings: timings } : result);
}

/** A sound's or speech's clip, accepted onto its asset. */
const audioAcceptance: Acceptance<AudioRun> = {
  changed: {
    code: "audio_changed",
    message: "Only a successful speech candidate can be accepted.",
  },
  ready: (run) => !!run.audio,
  async draftChanged(services, run) {
    // A sound whose prompt was edited is not this take, whatever else changed.
    if (run.audio.sound) {
      const current = await services.activities.getActivity(run.projectId, run.activityId);
      const asset = current.draft.mediaPlan?.manifest.assets[run.audio.language]?.find(
        (entry) => entry.key === run.audio.assetKey,
      );
      if (!asset || soundPromptOf(asset.script) !== run.audio.sound.prompt)
        return new HttpError(
          409,
          "audio_changed",
          "The sound's prompt changed. Generate a new candidate.",
        );
    }
    return new HttpError(
      409,
      "draft_conflict",
      run.audio.sound
        ? "The draft changed since the sound was generated. Generate a new candidate."
        : "The draft changed since speech generation. Generate a new candidate.",
    );
  },
  apply: (services, run, expectedRevision) =>
    services.activities.applyAudio(
      run.projectId,
      run.activityId,
      run.audio,
      JSON.parse(run.candidate) as AudioResult,
      expectedRevision,
    ),
};

/** What an audio helper ended without, by the run's provider. */
function missingClip(run: AudioRun): string {
  return run.audio.sound
    ? SOUND_OUTPUT_FILES[run.audio.sound.format ?? "mp3"]
    : SPEECH_OUTPUT_FILES[speechProviderOf(run.audio)];
}

export const speechKind: ServerRunKind<RunRequestOf<"speech">, AudioTarget, AudioRun> = {
  run: "audio",
  runner: "server",
  mediaAgent: true,
  needsScript: true,
  check: async (_services, request, activity) => audioTarget(activity, request.speech),
  async authorize(services, audio, { projectId, agentId }) {
    const keys = await services.vaultKeys(projectId, agentId);
    // The provider the run names is honoured strictly: without its key the run is refused,
    // naming the key, and never spoken by another provider instead.
    const choice = speechProviderFor(
      { speechProvider: speechProviderOf(audio) },
      keys,
      services.localAudio.availability(),
    );
    if ("problem" in choice) {
      if (choice.problem === "runtime_missing")
        throw new HttpError(
          409,
          "local_audio_missing",
          "Install kokoro-js in the server environment before generating local speech.",
        );
      const credential = "credential" in choice ? choice.credential : undefined;
      // The key travels as data too, so the App names it in its own words.
      throw new HttpError(
        400,
        "speech_credential_missing",
        `Add ${credential ?? "the provider's key"} to the Media Agent's Vault before generating speech.`,
        undefined,
        credential ? { credential } : undefined,
      );
    }
    // The default ElevenLabs voice is resolved now, as Loom's fingerprint does, so the clip
    // records the voice it was really spoken with.
    if (speechProviderOf(audio) === "elevenlabs" && audio.voice === ELEVENLABS_DEFAULT_VOICE)
      audio.voiceId = await services.elevenLabsDefaultVoice(projectId);
  },
  record: (audio) => ({ audio }),
  local: (audio) =>
    audio.provider && isLocalAudioProvider(audio.provider)
      ? {
          provider: audio.provider,
          model: audio.model,
          text: audio.script,
          voice: audio.voice,
          language: audio.language,
        }
      : null,
  async stage({ prepared: audio, workspace }) {
    const helper = bundledMediaHelper("generate-speech.mjs", "speech_helper_missing");
    // Gemini reads a narration in the house style (a word pronunciation follows its
    // direction). The default ElevenLabs voice goes as the voice it resolved to.
    const { voiceId, ...spoken } = audio;
    await atomicJson(
      path.join(workspace, "speech-input.json"),
      speechProviderOf(audio) === "gemini" && !audio.delivery
        ? { ...spoken, style: NARRATION_DELIVERY }
        : voiceId
          ? { ...spoken, voice: voiceId }
          : spoken,
    );
    // ElevenLabs is called with Node's own fetch, so nothing is installed for it; Gemini
    // speech goes through agenthub.
    await atomicJson(path.join(workspace, "package.json"), {
      private: true,
      type: "module",
      ...(speechProviderOf(audio) === "elevenlabs"
        ? {}
        : { dependencies: { "@prismshadow/agenthub": AGENTHUB_VERSION } }),
    });
    await fs.writeFile(path.join(workspace, "generate-speech.mjs"), helper, { flag: "wx" });
  },
  helper: (audio) => ({
    script: "generate-speech.mjs",
    install: speechProviderOf(audio) !== "elevenlabs",
  }),
  missing: missingClip,
  async collect({ services, run, workspace, save }) {
    run.candidate = await keepClip(services, run, workspace);
    save(run);
    return { draftChanged: "The draft changed during speech generation." };
  },
  accept: audioAcceptance,
};

interface SoundPrepared {
  sound: SoundTarget;
  /** The model the author named, if any. */
  model?: string;
}

export const soundKind: ServerRunKind<RunRequestOf<"sound">, SoundPrepared, AudioRun> = {
  run: "audio",
  runner: "server",
  mediaAgent: true,
  needsScript: true,
  check: async (services, request, activity) => ({
    sound: soundTarget(activity, request.sound, services.soundModels.agenthubModels),
    model: request.sound.model,
  }),
  async authorize(services, { sound, model }, { projectId, agentId }) {
    const keys = await services.vaultKeys(projectId, agentId);
    // The model the author named, or, with none named, the first the Vault has a key for, as
    // setup reports it. The target's model was chosen before the keys were known, so the
    // choice made here replaces it.
    const choice = soundProviderFor(
      sound.sound.kind,
      sound.sound.provider,
      keys,
      model,
      services.soundModels.agenthubModels,
      services.localAudio.availability(),
    );
    if ("problem" in choice && choice.problem === "runtime_missing")
      throw new HttpError(
        409,
        "local_audio_missing",
        "Install @huggingface/transformers in the server environment before generating local music or sound effects.",
      );
    if ("problem" in choice)
      throw new HttpError(
        400,
        "sound_credential_missing",
        `Add ${choice.credential ?? "the provider's key"} to the Media Agent's Vault before generating a sound.`,
      );
    sound.model = choice.model;
    sound.sound.model = choice.model;
    delete sound.sound.credential;
    delete sound.sound.format;
    if (choice.format) {
      sound.sound.credential = choice.credential;
      sound.sound.format = choice.format;
    }
  },
  record: ({ sound }) => ({ audio: sound }),
  local: ({ sound }): LocalAudioRequest | null =>
    isLocalAudioProvider(sound.sound.provider)
      ? {
          provider: sound.sound.provider,
          model: sound.model,
          text: sound.sound.prompt,
          seconds: (sound.sound.targetDurationMs ?? 10_000) / 1000,
        }
      : null,
  async stage({ prepared: { sound }, workspace }) {
    const helper = bundledMediaHelper("generate-sound.mjs", "sound_helper_missing");
    await atomicJson(path.join(workspace, "sound-input.json"), sound.sound);
    // ElevenLabs is called with Node's own fetch, so nothing is installed for it; a hub model
    // needs agenthub, and only that branch loads it.
    await atomicJson(path.join(workspace, "package.json"), {
      private: true,
      type: "module",
      ...(sound.sound.provider === "agenthub"
        ? { dependencies: { "@prismshadow/agenthub": AGENTHUB_VERSION } }
        : {}),
    });
    await fs.writeFile(path.join(workspace, "generate-sound.mjs"), helper, { flag: "wx" });
  },
  helper: ({ sound }) => ({
    script: "generate-sound.mjs",
    install: sound.sound.provider === "agenthub",
  }),
  missing: missingClip,
  async collect({ services, run, workspace, save }) {
    run.candidate = await keepClip(services, run, workspace);
    save(run);
    return { draftChanged: "The draft changed while the sound was being generated." };
  },
  accept: audioAcceptance,
};
