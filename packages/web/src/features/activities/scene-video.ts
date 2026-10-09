/**
 * Recording a composed scene to a video (experimental), kept apart from the view so it can be
 * tested without a DOM: which recordings belong to an asset, which composition can be recorded,
 * which recording is offered beside the current video, and how a failed one is worded.
 */
import type {
  ActivityRunSummary,
  AssetManifest,
  VideoCheck,
  VideoCheckFinding,
  VideoProblemCode,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

type Asset = AssetManifest["assets"][string][number];

/** The asset's video recordings, newest first. */
export function videoRuns(
  runs: readonly ActivityRunSummary[],
  language: string,
  assetKey: string,
): ActivityRunSummary[] {
  return runs
    .filter(
      (run) =>
        run.kind === "video" && run.video?.language === language && run.video.assetKey === assetKey,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Whether a composition run can be recorded: only one that succeeded and kept its page. */
export function isRecordable(run: ActivityRunSummary | null): run is ActivityRunSummary {
  return !!run && run.kind === "composition" && run.status === "succeeded" && run.hasCandidate;
}

/**
 * The newest recording that could replace the asset's video, to compare with it: one that
 * succeeded against this draft, is not already bound, and was not put aside.
 */
export function comparedRecording(
  recordings: readonly ActivityRunSummary[],
  asset: Asset,
  revision: string,
  kept: ReadonlySet<string>,
): ActivityRunSummary | null {
  return (
    recordings.find(
      (run) =>
        run.status === "succeeded" &&
        run.hasCandidate &&
        run.inputRevision === revision &&
        run.runId !== asset.generatedVideo?.runId &&
        !kept.has(run.runId),
    ) ?? null
  );
}

/** Where a recording, or a recording the draft binds, plays from. */
export function recordingUrl(endpoint: string, runId: string): string {
  return `${endpoint}/runs/${encodeURIComponent(runId)}/video`;
}

const PROBLEMS: readonly VideoProblemCode[] = [
  "video_not_ready",
  "video_no_timeline",
  "video_timeout",
  "video_invalid",
  "video_too_large",
  "video_stopped",
];

/**
 * Why a recording did not come out, in the App's words: by the code the server reports when it
 * knows the cause, otherwise with the server's own cause.
 */
export function recordingFailure(run: ActivityRunSummary): string | null {
  const code = run.video?.problem;
  if (run.status === "failed" && code && PROBLEMS.includes(code))
    return S.activities.video.recordProblems[code];
  if (run.status === "failed")
    return S.activities.video.recordFailed(run.error ?? S.activities.video.noCause);
  return run.error;
}

/** A made video's final check in one line, with the tone it reads in. */
export function checkLine(check: VideoCheck): { text: string; tone: Tone } {
  const tone: Record<VideoCheck["status"], Tone> = {
    pass: "success",
    revise: "attention",
    fail: "danger",
  };
  return { text: S.activities.video.check[check.status], tone: tone[check.status] };
}

/** One thing the check found, in the App's words, its times in seconds. */
export function findingText(finding: VideoCheckFinding): string {
  const seconds = (ms: number | undefined) => String(Math.round((ms ?? 0) / 100) / 10);
  return S.activities.video.check.findings[finding.code](
    seconds(finding.startMs),
    seconds(finding.endMs),
    finding.asset ?? "",
  );
}

/**
 * How many videos the draft binds whose final check found something to fix: the Media step
 * asks for a look at them. A video checked before checks existed, or not in the runs read,
 * is not counted.
 */
export function videosToCheck(
  assets: AssetManifest["assets"] | undefined,
  runs: readonly ActivityRunSummary[],
): number {
  const checks = new Map(runs.map((run) => [run.runId, run.video?.check]));
  return Object.values(assets ?? {})
    .flat()
    .filter((asset) => {
      const check = asset.generatedVideo && checks.get(asset.generatedVideo.runId);
      return !!check && check.status !== "pass";
    }).length;
}
