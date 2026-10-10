/**
 * Record video (experimental, behind `activityVideoExperiment`): a kept scene composition is
 * rendered frame by frame in the test browser and encoded to an MP4 (see video-render.ts),
 * which the author may then bind to the video or animation asset it was composed for.
 *
 * A deterministic run, like a quality check: no Session and no agent, recorded in the
 * activity's run history as kind `video` under the one-run-per-activity rule. The browser
 * opens the composition on this server's loopback address through a signed composition link
 * (see composition-service.ts), the way a quality check opens the player. The recording is
 * checked (an MP4, 100 MB at most) and kept in the media repository as the run's candidate;
 * nothing is bound until the author accepts it (`ActivityGeneration.acceptVideo`).
 *
 * The browser launcher and the encoder are ports, so a test drives fakes and never starts a
 * browser or FFmpeg.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config, Log } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import { hostOnly } from "../services/preview-token.js";
import type { BrowserLauncher } from "./browser-session.js";
import { COMPOSITION_FILE } from "./composition.js";
import { compositionBase, type ActivityCompositions } from "./composition-service.js";
import type { CompositionCandidate } from "./composition-types.js";
import type { ActivityRun } from "./domain.js";
import { loopbackAuthority, type TestBrowser } from "./test-browser.js";
import {
  RenderError,
  VideoFileError,
  readVideoFile,
  RENDER_MAX_MS,
  renderComposition,
  type EncoderStarter,
} from "./video-render.js";
import { runFfmpeg } from "./ffmpeg.js";
import { timelineRenderArgs } from "./timeline-render.js";
import { checkVideo, type VideoExpectation } from "./video-check.js";
import { captionCues, narrationLengthMs, timelineLengthMs, webVtt } from "./video-timeline.js";
import type { VideoTimeline } from "./video-timeline-types.js";
import type {
  VideoCheck,
  VideoCheckFinding,
  VideoProblemCode,
  VideoResult,
  VideoTarget,
} from "./video-types.js";

/** Where a run's recorder writes, inside its workspace; removed once the recording is kept. */
export const RECORDING_DIR = "recording";
/** What a video run made: the MP4, its captions, and what the final check holds it to. */
interface Made {
  file: string;
  captions: string | null;
  expected: VideoExpectation;
  /** What the layout audit found while a composition was recorded (see layout-audit.ts). */
  layout?: VideoCheckFinding[];
}

/** Where a timeline render gathers its inputs and writes; removed once the video is kept. */
export const TIMELINE_DIR = "timeline";

/** Runs FFmpeg with a timeline render's arguments. */
const renderWithFfmpeg = async (args: string[]): Promise<void> => {
  await runFfmpeg(args, { purpose: "to render a scene video", timeoutMs: RENDER_MAX_MS });
};

/**
 * The parts of a recording that touch the outside world. Absent, the real ones are used; a
 * test stands in a fake launcher so no browser starts.
 */
export abstract class VideoRenderPorts extends Interface<{
  /** Starts the browser; `playwright-core`'s Chromium by default. */
  launcher?: BrowserLauncher;
  /** Starts the encoder; FFmpeg by default (see ffmpeg.ts). */
  encoder?: EncoderStarter;
  /** How long each page step may take; 30 s by default. A test shortens it. */
  pageTimeoutMs?: number;
  /** Frames per second; 30 by default. A test lowers it. */
  fps?: number;
  /** Runs FFmpeg with a timeline render's arguments; the real FFmpeg by default. */
  renderTimeline?: (args: string[]) => Promise<void>;
  /** Checks a made video; FFmpeg's analysis by default (see video-check.ts). */
  checkVideo?: (file: string, expected: VideoExpectation) => Promise<VideoCheck>;
}>() {}

/** The code a failed recording is worded by, for the causes Penguin knows; null otherwise. */
function problemOf(error: unknown): VideoProblemCode | null {
  if (error instanceof RenderError || error instanceof VideoFileError) return error.code;
  if (error instanceof HttpError && error.code === "video_invalid") return "video_invalid";
  return null;
}

class RecordingStopped extends Error {}

@Component()
export class DefaultVideoRenderPorts implements VideoRenderPorts {}

export abstract class ActivityVideoRenders extends Interface<{
  /**
   * Starts recording a kept composition and answers at once with the run; the recording
   * happens after. 403 `experiment_off` while the experiment is off; 409
   * `video_composition_missing` when the composition run kept nothing to record; 409
   * `video_asset_changed` when its asset is gone; 409 `test_browser_missing` without the test
   * browser; 409 `generation_running` while another run is going.
   */
  start(
    projectId: string,
    activityId: string,
    input: { compositionRunId: string; expectedRevision: string },
  ): Promise<ActivityRun>;
  /**
   * Starts rendering a video or animation's timeline (saved, or started from its newest
   * recording) to its finished video, captions beside it, and answers at once with the run.
   * 403 `experiment_off`; 409 `draft_conflict`; 409 `timeline_blocked` when it names audio that
   * cannot be played; 409 `timeline_source_missing`; 409 `generation_running`.
   */
  startTimeline(
    projectId: string,
    activityId: string,
    input: { language: string; assetKey: string; expectedRevision: string },
  ): Promise<ActivityRun>;
}>() {}

@Component()
export class ActivityVideoRenderService implements ActivityVideoRenders {
  @Use() private readonly config!: Config;
  @Use() private readonly browser!: TestBrowser;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly compositions!: ActivityCompositions;
  @Use() private readonly ports!: VideoRenderPorts;
  @Use() private readonly log!: Log;

  private stopped = false;
  /**
   * Activities whose recording is still driving the browser. A cancelled run releases the
   * one-run rule at once, but its browser plays on to the end; until then a new recording of
   * the same activity waits its turn.
   */
  private readonly recording = new Set<string>();

  setup({ effect }: ClassCtx) {
    effect(() => {
      this.stopped = true;
    });
  }

  async start(
    projectId: string,
    activityId: string,
    input: { compositionRunId: string; expectedRevision: string },
  ): Promise<ActivityRun> {
    if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
    // Refused first, whatever else is wrong, so an author always learns the experiment is off.
    if (!this.generation.videoExperiment())
      throw new HttpError(
        403,
        "experiment_off",
        "Scene videos are an experiment an admin has not turned on.",
      );
    const activity = await this.activities.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== input.expectedRevision)
      throw new HttpError(
        409,
        "draft_conflict",
        "The draft changed. Reload it before recording a video.",
      );
    const missing = () =>
      new HttpError(
        409,
        "video_composition_missing",
        "Record a video from a composed scene: compose the scene first.",
      );
    const composition = await this.generation
      .run(projectId, activityId, input.compositionRunId)
      .catch((error: unknown) => {
        if (error instanceof HttpError && error.code === "run_not_found") throw missing();
        throw error;
      });
    if (
      composition.kind !== "composition" ||
      composition.status !== "succeeded" ||
      !composition.composition ||
      !composition.candidate
    )
      throw missing();
    const kept = JSON.parse(composition.candidate) as CompositionCandidate;
    const { language, assetKey, width, height } = composition.composition;
    const asset = activity.draft.mediaPlan?.manifest.assets[language]?.find(
      (entry) => entry.key === assetKey,
    );
    if (!asset || (asset.type !== "video" && asset.type !== "animation"))
      throw new HttpError(
        409,
        "video_asset_changed",
        "The video or animation this scene was composed for is no longer in the media plan.",
      );
    const executable = await this.browser.executablePath();
    if (!executable)
      throw new HttpError(
        409,
        "test_browser_missing",
        "The test browser is not installed. An admin installs it in System settings.",
      );
    if (this.config.port === 0)
      throw new HttpError(503, "server_not_listening", "The server has not started listening yet.");
    if (this.recording.has(activityId))
      throw new HttpError(
        409,
        "generation_running",
        "This activity already has a running generation.",
      );
    // A link for the browser on this machine, which holds no App session: not sandboxed, as
    // a quality check's play link is not.
    const authority = loopbackAuthority(this.config);
    const { token } = await this.compositions.link(
      projectId,
      activityId,
      input.compositionRunId,
      hostOnly(authority),
      false,
    );
    const target: VideoTarget = {
      language,
      assetKey,
      compositionRunId: input.compositionRunId,
      width,
      height,
      seconds: kept.seconds,
    };
    const run = await this.generation.openDeterministic(projectId, activityId, "video", {
      video: target,
    });
    this.recording.add(activityId);
    const url = `http://${authority}${compositionBase(token)}${COMPOSITION_FILE}`;
    void this.record(run, executable, url, target).finally(() => this.recording.delete(activityId));
    return run;
  }

  private async record(
    run: ActivityRun,
    executable: string,
    url: string,
    target: VideoTarget,
  ): Promise<void> {
    const dir = path.join(this.config.root, "activity-runs", run.runId, RECORDING_DIR);
    await this.produce(run, dir, async () => {
      const { file, layout } = await renderComposition({
        executablePath: executable,
        compositionUrl: url,
        width: target.width,
        height: target.height,
        seconds: target.seconds,
        dir,
        ...(this.ports.launcher ? { launcher: this.ports.launcher } : {}),
        ...(this.ports.encoder ? { encoder: this.ports.encoder } : {}),
        ...(this.ports.pageTimeoutMs ? { pageTimeoutMs: this.ports.pageTimeoutMs } : {}),
        ...(this.ports.fps ? { fps: this.ports.fps } : {}),
      });
      return {
        file,
        captions: null,
        layout,
        // A recording is the composition's picture alone.
        expected: {
          durationMs: Math.round(target.seconds * 1000),
          width: target.width,
          height: target.height,
          audio: false,
          narration: [],
        },
      };
    });
  }

  async startTimeline(
    projectId: string,
    activityId: string,
    input: { language: string; assetKey: string; expectedRevision: string },
  ): Promise<ActivityRun> {
    if (this.stopped) throw new HttpError(503, "activity_stopping", "Server is stopping.");
    if (!this.generation.videoExperiment())
      throw new HttpError(
        403,
        "experiment_off",
        "Scene videos are an experiment an admin has not turned on.",
      );
    const activity = await this.activities.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== input.expectedRevision)
      throw new HttpError(
        409,
        "draft_conflict",
        "The draft changed. Reload it before rendering the video.",
      );
    const { timeline, issues } = await this.generation.videoTimeline(
      projectId,
      activityId,
      input.language,
      input.assetKey,
    );
    const unplayable = [
      ...new Set(
        issues
          .filter((issue) => ["asset_missing", "asset_kind", "asset_unbound"].includes(issue.code))
          .map((issue) => issue.asset),
      ),
    ];
    if (unplayable.length)
      throw new HttpError(
        409,
        "timeline_blocked",
        `The timeline names audio that cannot be played yet: ${unplayable.join(", ")}.`,
      );
    const first = await this.generation
      .run(projectId, activityId, timeline.cuts[0]!.source.runId)
      .catch(() => null);
    if (!first?.video)
      throw new HttpError(
        409,
        "timeline_source_missing",
        "The recording the timeline starts with is no longer in the run history.",
      );
    if (this.recording.has(activityId))
      throw new HttpError(
        409,
        "generation_running",
        "This activity already has a running generation.",
      );
    const target: VideoTarget = {
      language: input.language,
      assetKey: input.assetKey,
      compositionRunId: first.video.compositionRunId,
      width: timeline.width,
      height: timeline.height,
      seconds: timelineLengthMs(timeline) / 1000,
      fromTimeline: true,
    };
    const run = await this.generation.openDeterministic(projectId, activityId, "video", {
      video: target,
    });
    this.recording.add(activityId);
    const dir = path.join(this.config.root, "activity-runs", run.runId, TIMELINE_DIR);
    void this.produce(run, dir, () =>
      this.renderTimeline(run, dir, timeline, input.language),
    ).finally(() => this.recording.delete(activityId));
    return run;
  }

  /** Gathers a timeline's recordings and clips and renders it; answers the MP4 and captions. */
  private async renderTimeline(
    run: ActivityRun,
    dir: string,
    timeline: VideoTimeline,
    language: string,
  ): Promise<Made> {
    const { projectId, activityId } = run;
    await fs.mkdir(dir, { recursive: true });
    const sources = new Map<string, string>();
    const cuts: string[] = [];
    for (const cut of timeline.cuts) {
      let file = sources.get(cut.source.runId);
      if (!file) {
        file = path.join(dir, `source-${sources.size}.${cut.source.format}`);
        const bytes = await this.activities.readVideo(
          projectId,
          activityId,
          cut.source.runId,
          cut.source.sha256,
          cut.source.format,
        );
        await fs.writeFile(file, bytes);
        sources.set(cut.source.runId, file);
      }
      cuts.push(file);
    }
    const activity = await this.activities.getActivity(projectId, activityId);
    const assets = activity.draft.mediaPlan?.manifest.assets[language] ?? [];
    const audio = new Map<string, string>();
    const keys = [
      ...timeline.narration.map((entry) => entry.asset),
      ...(timeline.music ? [timeline.music.asset] : []),
      ...timeline.effects.map((entry) => entry.asset),
    ];
    for (const key of keys) {
      if (audio.has(key)) continue;
      const bound = assets.find((asset) => asset.key === key)?.path;
      const file = bound && (await this.activities.mediaFilePath(projectId, activityId, bound));
      if (!file) throw new RenderError(`The clip of ${key} is not in the media repository.`);
      audio.set(key, file);
    }
    const file = path.join(dir, "finished.mp4");
    const args = timelineRenderArgs(timeline, { cuts, audio, assets }, file);
    await (this.ports.renderTimeline ?? renderWithFfmpeg)(args);
    const cues = captionCues(timeline, assets);
    const narration = timeline.narration.flatMap((entry) => {
      const asset = assets.find((candidate) => candidate.key === entry.asset);
      const length = asset ? narrationLengthMs(asset) : null;
      return length === null
        ? []
        : [{ asset: entry.asset, startMs: entry.startMs, endMs: entry.startMs + length }];
    });
    return {
      file,
      captions: cues.length ? webVtt(cues) : null,
      expected: {
        durationMs: timelineLengthMs(timeline),
        width: timeline.width,
        height: timeline.height,
        audio: keys.length > 0,
        narration,
      },
    };
  }

  /**
   * Makes a video run's file with `make` and keeps it as the run's candidate, captions beside
   * it, or settles the run failed with why. Whatever happens, `dir` is removed.
   */
  private async produce(run: ActivityRun, dir: string, make: () => Promise<Made>): Promise<void> {
    const { projectId, activityId, runId } = run;
    try {
      const made = await make();
      if (this.stopped)
        throw new RecordingStopped("The server stopped before the recording finished.");
      // Cancelled by the author while it was being made: nothing is kept.
      if (!(await this.generation.isRunning(projectId, activityId, runId))) return;
      let result: VideoResult = await this.activities.storeVideo(
        projectId,
        activityId,
        runId,
        await readVideoFile(made.file),
        "mp4",
      );
      // The check says what it finds; a check that cannot run leaves the video unchecked.
      let check = await (this.ports.checkVideo ?? checkVideo)(made.file, made.expected).catch(
        (error: unknown) => {
          this.log.line(`[activities] Checking video run ${runId} failed: ${String(error)}`);
          return undefined;
        },
      );
      // The layout audit's findings are warnings: they join the check without changing it.
      if (check && made.layout?.length)
        check = { ...check, findings: [...check.findings, ...made.layout] };
      if (made.captions !== null) {
        await this.activities.storeCaptions(projectId, activityId, runId, made.captions);
        result = { ...result, captions: true };
      }
      const settled = await this.generation.settleDeterministic(
        projectId,
        activityId,
        runId,
        "succeeded",
        null,
        JSON.stringify(result),
        undefined,
        check,
      );
      // Cancelled, or the server stopped, while it was being kept: the run does not own it.
      if (!settled)
        await this.activities.discardVideo(projectId, activityId, runId, "mp4").catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.line(`[activities] Video run ${runId} failed: ${message}`);
      const problem = error instanceof RecordingStopped ? "video_stopped" : problemOf(error);
      await this.generation
        .settleDeterministic(
          projectId,
          activityId,
          runId,
          "failed",
          message.slice(0, 500),
          undefined,
          problem ?? undefined,
        )
        .catch(() => {});
    } finally {
      // What was made was copied into the media repository, or is not wanted.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
