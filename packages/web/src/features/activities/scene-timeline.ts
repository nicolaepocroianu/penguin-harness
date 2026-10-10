/**
 * A scene video's timeline in the studio (experimental), kept apart from the view so it can be
 * tested without a DOM: where it is read from, seconds as the fields show them, how long it
 * plays, which audio can be added to it, and how what the server reports is worded.
 */
import type {
  ActivityRunSummary,
  AssetManifest,
  TimelineIssue,
  VideoTimeline,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

type Asset = AssetManifest["assets"][string][number];

/** Where a video's timeline is read (GET) and saved (PUT). */
export function timelineUrl(endpoint: string, language: string, assetKey: string): string {
  return `${endpoint}/video-timeline?language=${encodeURIComponent(language)}&assetKey=${encodeURIComponent(assetKey)}`;
}

/** Milliseconds as a seconds field shows them: up to two decimals, no trailing zeros. */
export function toSeconds(ms: number): string {
  return String(Math.round(ms / 10) / 100);
}

/** What a seconds field holds, in whole milliseconds; null when it is not 0 or more seconds. */
export function fromSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 1000);
}

/**
 * How long a timeline plays: its cuts one after another, each fade overlapping the cuts it
 * joins. The server reckons it the same way (video-timeline.ts, `timelineLengthMs`).
 */
export function timelineLength(timeline: Pick<VideoTimeline, "cuts">): number {
  return timeline.cuts.reduce(
    (length, cut) => length - cut.transitionMs + (cut.outMs - cut.inMs),
    0,
  );
}

/** A narration: audio that is neither music nor an effect nor a book word. */
function isNarration(asset: Asset): boolean {
  return asset.type === "audio" && asset.kind === undefined && asset.role === undefined;
}

/** The narrations that can be added: this language's, not on the timeline yet. */
export function narrationChoices(group: readonly Asset[], timeline: VideoTimeline): Asset[] {
  const placed = new Set(timeline.narration.map((entry) => entry.asset));
  return group.filter((asset) => isNarration(asset) && !placed.has(asset.key));
}

/** This language's music, any of which can play under the video. */
export function musicChoices(group: readonly Asset[]): Asset[] {
  return group.filter((asset) => asset.type === "audio" && asset.kind === "music");
}

/** This language's sound effects; one can play more than once. */
export function effectChoices(group: readonly Asset[]): Asset[] {
  return group.filter((asset) => asset.type === "audio" && asset.kind === "sfx");
}

/** What the server reports a timeline would get wrong, in the App's words. */
export function issueText(issue: TimelineIssue): string {
  return S.activities.video.timeline.issues[issue.code](issue.asset);
}

/** The asset's timeline refinements by an agent, newest first. */
export function refineRuns(
  runs: readonly ActivityRunSummary[],
  language: string,
  assetKey: string,
): ActivityRunSummary[] {
  return runs
    .filter(
      (run) =>
        run.kind === "timeline" &&
        run.timelineEdit?.language === language &&
        run.timelineEdit.assetKey === assetKey,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Where a run's kept output is read, as `{ candidate }` with the output as a JSON string. */
export function candidateUrl(endpoint: string, runId: string): string {
  return `${endpoint}/runs/${encodeURIComponent(runId)}/candidate`;
}

/** Issues that stop a render: the server refuses while any is reported. */
export function blocksRender(issue: TimelineIssue): boolean {
  return ["asset_missing", "asset_kind", "asset_unbound", "cut_past_recording"].includes(
    issue.code,
  );
}

/**
 * A timeline with one cut changed and kept valid: the first cut always begins with a plain cut,
 * a plain cut takes no time, and a fade gets a second when it had none.
 */
export function withCut(
  timeline: VideoTimeline,
  index: number,
  change: Partial<VideoTimeline["cuts"][number]>,
): VideoTimeline {
  const cuts = timeline.cuts.map((cut, at) => {
    if (at !== index) return cut;
    const next = { ...cut, ...change };
    if (at === 0 || next.transition === "cut")
      return { ...next, transition: "cut" as const, transitionMs: 0 };
    return next.transitionMs > 0 ? next : { ...next, transitionMs: 1000 };
  });
  return { ...timeline, cuts };
}
