/**
 * A critique of a recorded scene video (experimental, behind `activityVideoExperiment`): a
 * `critique` run. An agent looks at stills from the recording (one in the middle of each
 * storyboard frame, and the first and last moments), reads the storyboard and the scene, and
 * scores the video against a rubric for young learners, listing what to fix. Composing the scene
 * again hands those fixes to the composing agent (see `previousRecordingFindings`), so author
 * and agents can go round until the score is good enough.
 *
 * The idea is open-design's critique loop, its "Design Jury" (`apps/daemon/src/critique/` in
 * github.com/nexu-io/open-design, Apache-2.0): a scored critique whose fixes feed the next round
 * until the score clears a bar. The rubric, the files and the checks here are Penguin's own.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { SceneCritique, SceneCritiqueTarget } from "./composition-types.js";
import { runFfmpeg } from "./ffmpeg.js";
import type { VideoFormat } from "./video-types.js";

export const CRITIQUE_INPUT_FILE = "critique-input.json";
export const CRITIQUE_OUTPUT_FILE = "critique.json";
export const CRITIQUE_STILLS_DIR = "stills";
/** The score at which a scene is good enough, on the rubric's 1 to 5. */
export const CRITIQUE_GOOD = 4;
/** The most fixes a critique lists. */
export const CRITIQUE_MAX_FIXES = 8;
/** The rubric, in the order the agent scores it. */
export const CRITIQUE_RUBRIC = ["story", "layout", "readability", "motion", "learners"] as const;

/** One still the agent looks at: when it was taken, and the file. */
export interface CritiqueStill {
  atMs: number;
  file: string;
  /** The storyboard frame it shows, when it is one's middle. */
  frame?: string;
}

/** The moments to take stills at: the first, each frame's middle, and the last. */
export function stillMoments(
  frames: { id: string; seconds: number }[],
  lengthMs: number,
): { atMs: number; frame?: string }[] {
  const moments: { atMs: number; frame?: string }[] = [{ atMs: 0 }];
  let at = 0;
  for (const frame of frames) {
    const ms = Math.round(frame.seconds * 1000);
    moments.push({ atMs: Math.min(at + Math.round(ms / 2), lengthMs), frame: frame.id });
    at += ms;
  }
  // A quarter second before the end: a seek past the last frame gives no picture at all.
  moments.push({ atMs: Math.max(0, lengthMs - 250) });
  return moments;
}

/** What a critique run stages, read before the run is recorded. */
export interface CritiqueStage {
  target: SceneCritiqueTarget;
  /** The recording's bytes and format, from which the stills are taken. */
  recording: { bytes: Uint8Array; format: VideoFormat };
  moments: { atMs: number; frame?: string }[];
  input: {
    scene: string;
    video: string;
    frames: { id: string; description: string; seconds: number }[];
  };
}

/**
 * Stages a critique run: the stills taken from the recording with FFmpeg, and the input file
 * naming them. The recording itself is not left in the workspace.
 */
export async function stageCritique(workspace: string, stage: CritiqueStage): Promise<void> {
  const recording = path.join(workspace, `.recording.${stage.recording.format}`);
  await fs.writeFile(recording, stage.recording.bytes);
  await fs.mkdir(path.join(workspace, CRITIQUE_STILLS_DIR), { recursive: true });
  const stills: CritiqueStill[] = [];
  try {
    for (const [index, moment] of stage.moments.entries()) {
      const file = `${CRITIQUE_STILLS_DIR}/still-${index + 1}.png`;
      await runFfmpeg(
        ["-hide_banner", "-loglevel", "error", "-y", "-ss", (moment.atMs / 1000).toFixed(3)].concat(
          ["-i", recording, "-frames:v", "1", path.join(workspace, file)],
        ),
        { purpose: "to take stills from a scene video", timeoutMs: 60_000 },
      );
      // FFmpeg writes nothing, and says nothing, for a moment past the recording's last frame.
      const written = await fs.stat(path.join(workspace, file)).catch(() => null);
      if (written?.size)
        stills.push({ atMs: moment.atMs, file, ...(moment.frame ? { frame: moment.frame } : {}) });
    }
  } finally {
    await fs.rm(recording, { force: true });
  }
  await fs.writeFile(
    path.join(workspace, CRITIQUE_INPUT_FILE),
    `${JSON.stringify({ ...stage.input, stills }, null, 2)}\n`,
    "utf8",
  );
}

export const critiquePrompt = `Critique a scene video made for young learners. Work in this workspace.
Read ${CRITIQUE_INPUT_FILE}: the scene's description, the video's description, its storyboard frames (what each should show, and for how long), and the stills taken from the recording, each with the moment it was taken and the frame it shows. Look at every still under ${CRITIQUE_STILLS_DIR}/ with your file reading tool.
Score the video from 1 (poor) to 5 (excellent) on each of:
- story: the stills show what the storyboard and the video's description ask, in that order;
- layout: every object has its own space and stands on its ground, nothing floats, is cut off or covers something it should not;
- readability: any text is large, clear and stands out from what is behind it;
- motion: the stills suggest calm movement that shows what the narration is about rather than decorating, with a clear still picture at the start and the end, and nothing that would flash or pulse;
- learners: friendly, clear and right for young children, nothing confusing or frightening.
Write ${CRITIQUE_OUTPUT_FILE}: {"scores": {"story": 4, "layout": 3, "readability": 5, "motion": 4, "learners": 5}, "fixes": ["one concrete change to the scene, naming what to change and how"]} with at most ${CRITIQUE_MAX_FIXES} fixes, the most important first; leave fixes empty only when every score is ${CRITIQUE_GOOD} or more. Judge only what the stills show. If your tools cannot show you the stills (images cannot be read), do not guess: write {"unseen": true} to ${CRITIQUE_OUTPUT_FILE} instead.
Do not edit ${CRITIQUE_INPUT_FILE} or the stills. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing ${CRITIQUE_OUTPUT_FILE}.`;

/** Why what the agent wrote is not a critique Penguin keeps. */
export class CritiqueProblem extends Error {}

/** The score of a critique: the mean of its rubric's scores, to one decimal. */
export function critiqueScore(scores: SceneCritique["scores"]): number {
  const values = CRITIQUE_RUBRIC.map((key) => scores[key]);
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

/** What a critique run wrote, checked: a score from 1 to 5 for each of the rubric, and fixes. */
export async function collectCritique(
  workspace: string,
  target: SceneCritiqueTarget,
): Promise<SceneCritique> {
  const file = path.join(workspace, CRITIQUE_OUTPUT_FILE);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat || !stat.isFile())
    throw new CritiqueProblem(`The session ended without ${CRITIQUE_OUTPUT_FILE}.`);
  if (stat.size > 64 * 1024)
    throw new CritiqueProblem(`${CRITIQUE_OUTPUT_FILE} is larger than 64 KB.`);
  let value: { scores?: Record<string, unknown>; fixes?: unknown; unseen?: unknown };
  try {
    value = JSON.parse(await fs.readFile(file, "utf8")) as typeof value;
  } catch {
    throw new CritiqueProblem(`${CRITIQUE_OUTPUT_FILE} is not JSON.`);
  }
  if (value.unseen === true)
    throw new CritiqueProblem(
      "The agent could not see the stills: its model does not read images. Choose a vision model for the project, or a coding agent that reads images, and critique again.",
    );
  const scores = {} as SceneCritique["scores"];
  for (const key of CRITIQUE_RUBRIC) {
    const score = value.scores?.[key];
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5)
      throw new CritiqueProblem(`The critique's ${key} score must be a whole number from 1 to 5.`);
    scores[key] = score;
  }
  if (
    !Array.isArray(value.fixes) ||
    value.fixes.length > CRITIQUE_MAX_FIXES ||
    value.fixes.some((fix) => typeof fix !== "string" || !fix.trim() || fix.length > 400)
  )
    throw new CritiqueProblem(
      `The critique's fixes must be a list of at most ${CRITIQUE_MAX_FIXES} sentences.`,
    );
  const fixes = (value.fixes as string[]).map((fix) => fix.trim());
  const score = critiqueScore(scores);
  if (!fixes.length && score < CRITIQUE_GOOD)
    throw new CritiqueProblem("The critique scored the scene low but listed nothing to fix.");
  return { recordingRunId: target.recordingRunId, scores, score, fixes };
}

/** A critique's fixes as instructions to the agent composing the scene again. */
export function critiqueForAgent(critique: SceneCritique): string[] {
  return critique.fixes.map(
    (fix) => `A reviewer of the last recording (score ${critique.score} of 5) asked: ${fix}`,
  );
}
