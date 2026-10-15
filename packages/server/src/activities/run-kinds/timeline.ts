/**
 * A timeline refined by an agent (experimental): the video's timeline and its storyboard,
 * placed in time, so its sound can follow its picture. The author loads what it wrote into the
 * editor and saves it there.
 */
import type { CompositionCandidate } from "../composition-types.js";
import { compositionScene } from "../composition.js";
import type { ActivityDetail, TimelineRun } from "../domain.js";
import type { RunRequestOf } from "../run-request.js";
import {
  TIMELINE_OUTPUT_FILE,
  collectTimelineEdit,
  framesOnTimeline,
  placeFrames,
  stageTimelineEdit,
  timelineEditInput,
  timelineEditPrompt,
  timelineEditTarget,
  type TimelineEditStage,
} from "../timeline-edit.js";
import {
  DOCUMENT_RUN_MS,
  requireCompleted,
  type RunKindServices,
  type SessionRunKind,
} from "./contract.js";

/**
 * What a timeline run stages: the timeline the video has (saved, or started from its newest
 * recording), the storyboard frames of that recording's composition placed in time, and the
 * scene's audio. 404/409 as `videoTimeline` refuses.
 */
async function timelineEditStage(
  services: RunKindServices,
  projectId: string,
  activity: ActivityDetail,
  input: { language: string; assetKey: string },
): Promise<TimelineEditStage> {
  const activityId = activity.id;
  const { timeline } = await services.videoTimeline(
    projectId,
    activityId,
    input.language,
    input.assetKey,
  );
  const assets = activity.draft.mediaPlan?.manifest.assets[input.language] ?? [];
  // The frames are the composition's whose recording the timeline starts with.
  const recording = await services
    .run(projectId, activityId, timeline.cuts[0]!.source.runId)
    .catch(() => null);
  const composition = recording?.video
    ? await services.run(projectId, activityId, recording.video.compositionRunId).catch(() => null)
    : null;
  // Placed where the timeline shows them, after its trims, cuts and fades.
  const frames = composition?.candidate
    ? framesOnTimeline(
        placeFrames((JSON.parse(composition.candidate) as CompositionCandidate).frames),
        timeline,
        timeline.cuts[0]!.source.runId,
      )
    : [];
  const scene = compositionScene(activity, input);
  const editInput = timelineEditInput(assets, input.assetKey, scene.description, timeline, frames);
  return { target: timelineEditTarget(input.language, editInput), input: editInput };
}

export const timelineKind: SessionRunKind<
  RunRequestOf<"timeline">,
  TimelineEditStage,
  TimelineRun
> = {
  run: "timeline",
  runner: "session",
  experimental: true,
  needsScript: true,
  // It writes the timeline again, one document; the server renders it afterwards.
  limits: { wallClockMs: DOCUMENT_RUN_MS },
  check: (services, request, activity, projectId) =>
    timelineEditStage(services, projectId, activity, request.timeline),
  record: ({ target }) => ({ timelineEdit: target }),
  stage: ({ prepared, workspace }) => stageTimelineEdit(workspace, prepared),
  prompt: () => timelineEditPrompt,
  outputs: [TIMELINE_OUTPUT_FILE],
  async collect({ run, workspace, observed, save }) {
    requireCompleted(observed, "Timeline Session did not complete.");
    const timeline = await collectTimelineEdit(workspace, run.timelineEdit);
    run.candidate = JSON.stringify(timeline);
    save(run);
    return { kept: true, draftChanged: "The draft changed while the timeline was being refined." };
  },
};
