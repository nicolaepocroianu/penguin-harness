/**
 * A critique of a recorded scene video (experimental): an agent looks at stills taken from
 * the asset's newest recording against its storyboard and scores it. The score ranks the
 * compositions a new one builds on.
 */
import type { CompositionCandidate } from "../composition-types.js";
import { compositionScene } from "../composition.js";
import type { ActivityDetail, CritiqueRun } from "../domain.js";
import { HttpError } from "../../http/errors.js";
import type { RunRequestOf } from "../run-request.js";
import {
  CRITIQUE_OUTPUT_FILE,
  collectCritique,
  critiquePrompt,
  stageCritique,
  stillMoments,
  type CritiqueStage,
} from "../scene-critique.js";
import type { VideoResult } from "../video-types.js";
import { requireCompleted, type RunKindServices, type SessionRunKind } from "./contract.js";

/**
 * What a critique run stages: the asset's newest recording (never a finished video), the
 * storyboard of the composition it recorded, and the moments to take stills at. 409
 * `video_recording_missing` when the asset has no recording to critique.
 */
async function critiqueStage(
  services: RunKindServices,
  projectId: string,
  activity: ActivityDetail,
  input: { language: string; assetKey: string },
): Promise<CritiqueStage> {
  const activityId = activity.id;
  const summary = (await services.list(projectId, activityId)).find(
    (run) =>
      run.kind === "video" &&
      run.status === "succeeded" &&
      run.hasCandidate &&
      run.video?.language === input.language &&
      run.video.assetKey === input.assetKey &&
      !run.video.fromTimeline,
  );
  const recording = summary ? await services.run(projectId, activityId, summary.runId) : null;
  if (!recording?.video || !recording.candidate)
    throw new HttpError(
      409,
      "video_recording_missing",
      "Record the scene's video first: a critique looks at a recording.",
    );
  const result = JSON.parse(recording.candidate) as VideoResult;
  const format = result.format ?? "webm";
  const bytes = await services.activities.readVideo(
    projectId,
    activityId,
    result.runId,
    result.sha256,
    format,
  );
  const composition = await services
    .run(projectId, activityId, recording.video.compositionRunId)
    .catch(() => null);
  const frames = composition?.candidate
    ? (JSON.parse(composition.candidate) as CompositionCandidate).frames
    : [];
  const scene = compositionScene(activity, input);
  return {
    target: {
      language: input.language,
      assetKey: input.assetKey,
      recordingRunId: recording.runId,
      compositionRunId: recording.video.compositionRunId,
    },
    recording: { bytes, format },
    moments: stillMoments(frames, Math.round(recording.video.seconds * 1000)),
    input: { scene: scene.description, video: scene.assetDescription, frames },
  };
}

export const critiqueKind: SessionRunKind<RunRequestOf<"critique">, CritiqueStage, CritiqueRun> = {
  run: "critique",
  runner: "session",
  experimental: true,
  needsScript: true,
  check: (services, request, activity, projectId) =>
    critiqueStage(services, projectId, activity, request.critique),
  record: ({ target }) => ({ critique: target }),
  stage: ({ prepared, workspace }) => stageCritique(workspace, prepared),
  prompt: () => critiquePrompt,
  outputs: [CRITIQUE_OUTPUT_FILE],
  async collect({ run, workspace, observed, save }) {
    requireCompleted(observed, "Critique Session did not complete.");
    const critiqued = await collectCritique(workspace, run.critique);
    run.candidate = JSON.stringify(critiqued);
    run.critique = { ...run.critique, score: critiqued.score };
    save(run);
    // A critique changes nothing in the draft, so the draft changing meanwhile does not
    // matter to it.
    return { kept: true };
  },
};
