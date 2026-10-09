/**
 * Recording a scene composition to a video (experimental). What this proves: the experiment
 * switch, a missing composition and a missing test browser each refuse with a code; the
 * renderer opens the composition through a working signed link at the canvas size, steps its
 * paused timeline frame by frame, pipes one screenshot per frame to the encoder, and keeps what
 * the encoder wrote only when it is an MP4; the recording is served as video/mp4, and accepting
 * it binds it to the asset, where the player serves it. Recordings bound before the frame
 * renderer (WebM) still validate. The Session, the browser and FFmpeg are fakes: nothing
 * reaches a model, no browser starts and nothing is encoded.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type { BrowserLauncher } from "../src/activities/browser-session.js";
import { compositionTemplate } from "../src/activities/composition.js";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRun,
  ActivityRunSummary,
} from "../src/activities/domain.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import { validateManifest, wafManifest, type AssetManifest } from "../src/activities/media.js";
import { INSTALL_MARKER } from "../src/activities/test-browser.js";
import type { FfmpegRun } from "../src/activities/ffmpeg.js";
import {
  RENDER_FPS,
  RENDER_MAX_SECONDS,
  VIDEO_MAX_BYTES,
  VideoFileError,
  encodeArgs,
  frameCount,
  inspectMp4,
  inspectWebm,
  videoMimeType,
  type EncoderStarter,
} from "../src/activities/video-render.js";
import { ownedMediaPaths } from "../src/activities/version-manifest.js";
import type { VideoTimelineView } from "../src/activities/video-timeline-types.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import { activitySpec } from "./activity-fixtures.js";
import { imagePng } from "./image-fixtures.js";

const PROJECT = "recorder-scenes";

/** A minimal WebM: an EBML header naming the `webm` document type, then a bit of a segment. */
function webm(extra = 16): Buffer {
  const element = (id: number[], value: number[]) => [...id, 0x80 | value.length, ...value];
  const header = [
    ...element([0x42, 0x86], [1]),
    ...element([0x42, 0xf7], [1]),
    ...element([0x42, 0xf2], [4]),
    ...element([0x42, 0xf3], [8]),
    ...element([0x42, 0x82], [...Buffer.from("webm")]),
    ...element([0x42, 0x87], [2]),
    ...element([0x42, 0x85], [2]),
  ];
  return Buffer.from([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x80 | header.length,
    ...header,
    0x18,
    0x53,
    0x80,
    0x67,
    ...new Array<number>(extra).fill(0),
  ]);
}

/** A minimal MP4: an `ftyp` box naming the `isom` brand, then an empty `mdat` box. */
function mp4(extra = 16): Buffer {
  const ftyp = Buffer.concat([
    Buffer.from([0, 0, 0, 20]),
    Buffer.from("ftypisom", "latin1"),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from("isom", "latin1"),
  ]);
  const mdat = Buffer.concat([
    Buffer.from([0, 0, 0, 8 + extra]),
    Buffer.from("mdat", "latin1"),
    Buffer.alloc(extra),
  ]);
  return Buffer.concat([ftyp, mdat]);
}

/** A page the way an agent should write it: the template, one image and one timeline. */
function goodPage() {
  return compositionTemplate(640, 480)
    .replace(
      "<!-- The frames go here: elements positioned inside the stage, using images/ files. -->",
      '<img id="sky" src="images/sky.png" alt="" style="width:100%" />',
    )
    .replace(
      "// timeline.to(...), timeline.from(...), one section per frame of frames.json.",
      'timeline.from("#sky", { opacity: 0, duration: 3 }).to("#sky", { x: 40, duration: 3 });',
    );
}

const FRAMES = {
  frames: [
    { id: "frame-1", description: "The sky fades in", seconds: 3 },
    { id: "frame-2", description: "The sky drifts right", seconds: 3 },
  ],
};

const executableIn = (dir: string) => path.join(dir, "chromium-0000", "chrome");

/**
 * A launcher whose page plays along — the bridge reports a 6 s composition, the timeline
 * pauses and seeks, and each screenshot is the frame's number — and an encoder that collects
 * the frames and, once finished, writes `output` where it was told to.
 */
function fakeBrowser() {
  const calls = {
    urls: [] as string[],
    contexts: [] as Record<string, unknown>[],
    scripts: [] as string[],
    shots: [] as Record<string, unknown>[],
    encoded: [] as string[],
    encoderArgs: [] as string[][],
    finished: 0,
    killed: 0,
    closed: 0,
    fetched: null as Response | null,
  };
  let output: Buffer = mp4();
  let hang = false;
  let fetchPage: ((url: string) => Promise<Response>) | null = null;
  const encoder: EncoderStarter = async (args) => {
    calls.encoderArgs.push(args);
    const run: FfmpegRun = {
      write: async (chunk) => {
        calls.encoded.push(Buffer.from(chunk).toString());
      },
      finish: async () => {
        calls.finished += 1;
        await fs.writeFile(args.at(-1)!, output);
        return Buffer.alloc(0);
      },
      kill: () => {
        calls.killed += 1;
      },
    };
    return run;
  };
  const launcher = (async () => ({
    newContext: async (options: Record<string, unknown>) => {
      calls.contexts.push(options);
      const context = {
        close: async () => {},
        newPage: async () => ({
          setDefaultTimeout: () => {},
          goto: async (url: string) => {
            calls.urls.push(url);
            if (fetchPage) calls.fetched = await fetchPage(url);
          },
          evaluate: async (script: string) => {
            calls.scripts.push(script);
            // An agent-written page whose `ready` never settles.
            if (hang && script.includes("ready")) return new Promise(() => {});
            return script.includes("ready") ? 6 : true;
          },
          screenshot: async (options: Record<string, unknown>) => {
            calls.shots.push(options);
            return Buffer.from(`frame ${calls.shots.length - 1}`);
          },
          context: () => context,
        }),
      };
      return context;
    },
    close: async () => {
      calls.closed += 1;
    },
  })) as unknown as BrowserLauncher;
  return {
    launcher,
    encoder,
    calls,
    output: (bytes: Buffer) => {
      output = bytes;
    },
    hang: (on: boolean) => {
      hang = on;
    },
    fetchWith: (fetcher: (url: string) => Promise<Response>) => {
      fetchPage = fetcher;
    },
  };
}

describe("scene video recording", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture(options: { installed?: boolean } = {}) {
    let complete: () => void = () => {};
    const waiting = new Set<string>();
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {},
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok",
      steer: () => false,
      skipReconnectWait: () => false,
      async *compact() {},
      async *run(_input, runOptions) {
        yield requestBegin();
        await new Promise<void>((resolve) => {
          complete = resolve;
          waiting.add(row.sessionId);
          if (runOptions.signal.aborted) resolve();
          else runOptions.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        await fs.writeFile(path.join(row.workspace!, "composition.html"), goodPage());
        await fs.writeFile(path.join(row.workspace!, "frames.json"), JSON.stringify(FRAMES));
        yield requestEnd("completed");
      },
    });
    const browser = fakeBrowser();
    const t = await createTestApp({
      testBrowserPorts: { locateExecutable: async (dir) => executableIn(dir) },
      // Two frames a second, so a 6 s composition is 12 frames.
      videoRenderPorts: {
        launcher: browser.launcher,
        encoder: browser.encoder,
        pageTimeoutMs: 200,
        fps: 2,
      },
    });
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    cleanups.push(t.cleanup);
    if (options.installed !== false) {
      const home = path.join(t.root, "browsers");
      await fs.mkdir(path.dirname(executableIn(home)), { recursive: true });
      await fs.writeFile(executableIn(home), "fake browser");
      await fs.writeFile(path.join(home, "chromium-0000", INSTALL_MARKER), "");
    }
    // The fake page asks the app for what the real browser would load, on the link's own host.
    browser.fetchWith(
      (url) => t.app.request(url, { headers: { host: new URL(url).host } }) as Promise<Response>,
    );
    const owner = await provisionUser(t.app, "recorder");
    const client = apiClient(t.app, owner.cookie);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    await t.deps.projectConfigService.writeRaw(PROJECT, {
      default_model: { provider: "custom", model_id: "activity-test" },
      models: [
        {
          provider: "custom",
          model_id: "activity-test",
          api_key: "not-a-real-key",
          base_url: "http://localhost:1/v1",
          client_type: "openai-chat",
        },
      ],
    });
    const base = `/api/projects/${PROJECT}/activities`;
    const created = (await (
      await client.post(base, { productCode: "p", refNum: 1, title: "Scenes" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const described = (await (
      await client.patch(`${endpoint}/description`, {
        description: "A short story about the sky",
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const saved = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "The sky at dawn",
            media: {
              images: [{ key: "sky", description: "A blue sky" }],
              video: [{ key: "intro-video", description: "The sky slowly brightens" }],
            },
          },
        ],
      },
      expectedRevision: described.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const planned = await client.post(`${endpoint}/plan-media`, {
      expectedRevision: ((await saved.json()) as ActivityDraft).contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    const plannedDraft = (await planned.json()) as ActivityDraft;
    const uploaded = await client.post(`${endpoint}/media-uploads`, {
      name: "sky.png",
      dataBase64: imagePng(4, 3).toString("base64"),
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { path: skyPath } = (await uploaded.json()) as { path: string };
    const manifest = structuredClone(plannedDraft.mediaPlan!.manifest);
    manifest.assets["en-US"]!.find((asset) => asset.key === "sky")!.path = skyPath;
    const bound = await client.put(`${endpoint}/media`, {
      manifest,
      expectedRevision: plannedDraft.contentRevision,
    });
    expect(bound.status, await bound.clone().text()).toBe(200);

    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const current = async () => (await (await client.get(endpoint)).json()) as ActivityDetail;
    const runs = async () =>
      ((await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] })
        .runs;
    const experiment = async (on: boolean) =>
      expect((await admin.put("/api/admin/settings", { activityVideoExperiment: on })).status).toBe(
        200,
      );
    /** A composition run the fake agent finishes with a page that passes its checks. */
    async function composed(): Promise<string> {
      const response = await client.post(`${endpoint}/compose-video`, {
        agentId: "default_agent",
        expectedRevision: (await current()).draft.contentRevision,
        language: "en-US",
        assetKey: "intro-video",
      });
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      await waitFor(() => waiting.has(run.sessionId!));
      complete();
      await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      const summary = (await runs()).find((entry) => entry.runId === run.runId)!;
      expect(summary.status, summary.error ?? "").toBe("succeeded");
      return run.runId;
    }
    const record = async (compositionRunId: string) =>
      client.post(`${endpoint}/render-video`, {
        compositionRunId,
        expectedRevision: (await current()).draft.contentRevision,
      });
    async function recorded(compositionRunId: string): Promise<ActivityRunSummary> {
      const response = await record(compositionRunId);
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      // The recording runs after the answer; poll the history until it settles.
      for (let tries = 0; tries < 400; tries += 1) {
        const summary = (await runs()).find((entry) => entry.runId === run.runId);
        if (summary && summary.status !== "running") return summary;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("The recording did not settle.");
    }
    return {
      t,
      client,
      endpoint,
      browser,
      current,
      runs,
      experiment,
      composed,
      record,
      recorded,
    };
  }

  it("refuses while the experiment is off, without a composition, and without the browser", async () => {
    const f = await fixture({ installed: false });
    const off = await f.record("run_00000000000000000000000000000000");
    expect(off.status).toBe(403);
    expect(JSON.stringify(await off.json())).toContain("experiment_off");
    await f.experiment(true);
    const none = await f.record("run_00000000000000000000000000000000");
    expect(none.status).toBe(409);
    expect(JSON.stringify(await none.json())).toContain("video_composition_missing");
    const composition = await f.composed();
    const stale = await f.client.post(`${f.endpoint}/render-video`, {
      compositionRunId: composition,
      expectedRevision: "not-the-current-revision",
    });
    expect(stale.status).toBe(409);
    expect(JSON.stringify(await stale.json())).toContain("draft_conflict");
    const missing = await f.record(composition);
    expect(missing.status).toBe(409);
    expect(JSON.stringify(await missing.json())).toContain("test_browser_missing");
    expect((await f.runs()).filter((run) => run.kind === "video")).toEqual([]);
    expect(f.browser.calls.urls).toEqual([]);
  });

  it("renders a composition frame by frame, serves it as video/mp4, and binds it on accept", async () => {
    const f = await fixture();
    await f.experiment(true);
    const composition = await f.composed();
    const summary = await f.recorded(composition);
    expect(summary.status, summary.error ?? "").toBe("succeeded");
    expect(summary.kind).toBe("video");
    expect(summary.video).toEqual({
      language: "en-US",
      assetKey: "intro-video",
      compositionRunId: composition,
      width: 640,
      height: 480,
      seconds: 6,
    });
    expect(summary.hasCandidate).toBe(true);

    // The browser opened the composition on a link that really serves it, at the canvas size,
    // with no page recorder.
    expect(f.browser.calls.urls).toHaveLength(1);
    expect(f.browser.calls.urls[0]).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/preview\/composition\/[^/]+\/composition\.html$/,
    );
    expect(f.browser.calls.fetched?.status).toBe(200);
    expect(await f.browser.calls.fetched!.text()).toBe(goodPage());
    expect(f.browser.calls.contexts[0]).toEqual({ viewport: { width: 640, height: 480 } });
    // The timeline was paused at its start, then sought to each frame's time in order, and
    // each frame was captured at the canvas size and handed to the encoder.
    const seeks = f.browser.calls.scripts
      .filter((script) => script.includes(".seek("))
      .map((script) => /\.seek\(([^,]+), false\)/.exec(script)?.[1]);
    expect(seeks).toEqual(["0", ...Array.from({ length: 12 }, (_, index) => String(index / 2))]);
    expect(f.browser.calls.shots).toHaveLength(12);
    expect(f.browser.calls.shots[0]).toMatchObject({
      type: "png",
      clip: { x: 0, y: 0, width: 640, height: 480 },
    });
    expect(f.browser.calls.encoded).toEqual(
      Array.from({ length: 12 }, (_, index) => `frame ${index}`),
    );
    expect(f.browser.calls.encoderArgs[0]).toContain("libx264");
    expect(f.browser.calls.encoderArgs[0]!.at(-1)).toMatch(/render\.mp4$/);
    expect(f.browser.calls.finished).toBe(1);
    expect(f.browser.calls.closed).toBe(1);

    const served = await f.client.get(`${f.endpoint}/runs/${summary.runId}/video`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(mp4());

    const before = await f.current();
    expect(before.draft.contentRevision).toBe(summary.inputRevision);
    const accepted = await f.client.post(`${f.endpoint}/runs/${summary.runId}/accept-video`, {
      expectedRevision: before.draft.contentRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const draft = (await accepted.json()) as ActivityDraft;
    const asset = draft.mediaPlan!.manifest.assets["en-US"]!.find(
      (entry) => entry.key === "intro-video",
    )!;
    expect(asset.path).toBe("media/loom/p/p-1/videos/english/intro-video.mp4");
    expect(asset.generatedVideo).toEqual({
      runId: summary.runId,
      sha256: inspectMp4(mp4()).sha256,
      format: "mp4",
    });
    // The player finds the bound recording where the media plan says it is.
    const played = await f.client.get(`${f.endpoint}/sandbox/${asset.path}`);
    expect(played.status).toBe(200);
    expect(played.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await played.arrayBuffer())).toEqual(mp4());
    // So does the studio's own preview of the bound file.
    expect((await f.client.get(`${f.endpoint}/runs/${summary.runId}/video`)).status).toBe(200);
    // Assembly stages it at its bound path, where the collector checks it.
    const authoring = f.t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const staging = path.join(f.t.root, "assembly-staging");
    await authoring.prepareVideoMedia(PROJECT, summary.activityId, staging, draft.contentRevision);
    expect(await fs.readFile(path.join(staging, asset.path!))).toEqual(mp4());

    // A binding cannot be forged by saving the media plan by hand.
    const forged = structuredClone(draft.mediaPlan!.manifest) as AssetManifest;
    forged.assets["en-US"]!.find((entry) => entry.key === "intro-video")!.generatedVideo = {
      runId: summary.runId,
      sha256: "0".repeat(64),
      format: "mp4",
    };
    const refused = await f.client.put(`${f.endpoint}/media`, {
      manifest: forged,
      expectedRevision: draft.contentRevision,
    });
    expect(refused.status).toBe(422);
  });

  it("fails a recording that is not an MP4 and keeps nothing", async () => {
    const f = await fixture();
    await f.experiment(true);
    const composition = await f.composed();
    f.browser.output(Buffer.from("RIFF....WAVEfmt not a video at all"));
    const summary = await f.recorded(composition);
    expect(summary.status).toBe("failed");
    // The App words the failure by its code; the sentence stays for the trace.
    expect(summary.video?.problem).toBe("video_invalid");
    expect(summary.error).toContain("MP4");
    expect(summary.hasCandidate).toBe(false);
    expect((await f.client.get(`${f.endpoint}/runs/${summary.runId}/video`)).status).toBe(404);
    const accept = await f.client.post(`${f.endpoint}/runs/${summary.runId}/accept-video`, {
      expectedRevision: (await f.current()).draft.contentRevision,
    });
    expect(accept.status).toBe(409);
  });

  it("starts a timeline from the newest recording, and keeps one saved on the video", async () => {
    const f = await fixture();
    const timelineOf = () =>
      f.client.get(`${f.endpoint}/video-timeline?language=en-US&assetKey=intro-video`);
    expect((await timelineOf()).status).toBe(403);
    await f.experiment(true);
    const none = await timelineOf();
    expect(none.status).toBe(409);
    expect(JSON.stringify(await none.json())).toContain("video_recording_missing");
    expect(
      (await f.client.get(`${f.endpoint}/video-timeline?language=en-US&assetKey=sky`)).status,
    ).toBe(404);

    const summary = await f.recorded(await f.composed());
    const started = await timelineOf();
    expect(started.status, await started.clone().text()).toBe(200);
    const view = (await started.json()) as VideoTimelineView;
    expect(view.saved).toBe(false);
    expect(view.issues).toEqual([]);
    expect(view.timeline).toMatchObject({
      width: 640,
      height: 480,
      fps: RENDER_FPS,
      cuts: [
        {
          source: { runId: summary.runId, sha256: inspectMp4(mp4()).sha256, format: "mp4" },
          inMs: 0,
          outMs: 6000,
        },
      ],
      narration: [],
      music: null,
    });

    // Saved with the media plan, it is the video's own from then on.
    const draft = (await f.current()).draft;
    const manifest = structuredClone(draft.mediaPlan!.manifest) as AssetManifest;
    const shorter = { ...view.timeline, cuts: [{ ...view.timeline.cuts[0]!, outMs: 4000 }] };
    manifest.assets["en-US"]!.find((entry) => entry.key === "intro-video")!.timeline = shorter;
    const saved = await f.client.put(`${f.endpoint}/media`, {
      manifest,
      expectedRevision: draft.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await (await timelineOf()).json()).toEqual({
      timeline: shorter,
      saved: true,
      issues: [],
    });
  });

  it("stops a recording whose page never gets ready, and lets the activity record again", async () => {
    const f = await fixture();
    await f.experiment(true);
    const composition = await f.composed();
    f.browser.hang(true);
    const stuck = await f.recorded(composition);
    expect(stuck.status).toBe("failed");
    expect(stuck.video?.problem).toBe("video_not_ready");
    expect(stuck.hasCandidate).toBe(false);
    // The browser was closed, so nothing holds the activity, and no encoder was started.
    expect(f.browser.calls.closed).toBe(1);
    expect(f.browser.calls.encoderArgs).toEqual([]);
    f.browser.hang(false);
    // The run settles a moment before its recorder lets go of the activity.
    let again: ActivityRunSummary | null = null;
    for (let tries = 0; tries < 100 && !again; tries += 1) {
      const response = await f.record(composition);
      if (response.status !== 409) {
        expect(response.status, await response.clone().text()).toBe(202);
        const run = (await response.json()) as ActivityRun;
        for (let wait = 0; wait < 400; wait += 1) {
          const summary = (await f.runs()).find((entry) => entry.runId === run.runId);
          if (summary && summary.status !== "running") {
            again = summary;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      } else await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(again?.status, again?.error ?? "").toBe("succeeded");
  });
});

describe("recording files", () => {
  it("accepts a WebM header and refuses anything else", () => {
    expect(inspectWebm(webm()).bytes).toBe(webm().length);
    const code = (bytes: Buffer) => {
      try {
        inspectWebm(bytes);
        return null;
      } catch (error) {
        return error instanceof VideoFileError ? "invalid" : "other";
      }
    };
    expect(code(Buffer.from("not a video"))).toBe("invalid");
    // Matroska is EBML too, but not a WebM.
    expect(code(Buffer.from(webm().toString("latin1").replace("webm", "mkv\0"), "latin1"))).toBe(
      "invalid",
    );
    expect(code(webm().subarray(0, 12))).toBe("invalid");
    expect(code(Buffer.alloc(VIDEO_MAX_BYTES + 1))).toBe("invalid");
  });

  it("accepts an MP4 header and refuses anything else", () => {
    expect(inspectMp4(mp4()).bytes).toBe(mp4().length);
    const code = (bytes: Buffer) => {
      try {
        inspectMp4(bytes);
        return null;
      } catch (error) {
        return error instanceof VideoFileError ? error.code : "other";
      }
    };
    expect(code(Buffer.from("not a video"))).toBe("video_invalid");
    expect(code(webm())).toBe("video_invalid");
    // An ftyp box claiming more bytes than there are.
    expect(code(mp4().subarray(0, 12))).toBe("video_invalid");
    expect(code(Buffer.alloc(VIDEO_MAX_BYTES + 1))).toBe("video_too_large");
    expect(videoMimeType(mp4())).toBe("video/mp4");
    expect(videoMimeType(webm())).toBe("video/webm");
  });

  it("renders a composition's length in frames, at least one and never past 65 s", () => {
    expect(frameCount(6, RENDER_FPS)).toBe(180);
    expect(frameCount(6.01, 2)).toBe(13);
    expect(frameCount(600, RENDER_FPS)).toBe(RENDER_MAX_SECONDS * RENDER_FPS);
    expect(frameCount(Number.NaN, RENDER_FPS)).toBe(1);
    expect(encodeArgs(30, "out.mp4")).toEqual(
      expect.arrayContaining(["image2pipe", "libx264", "yuv420p", "+faststart"]),
    );
  });

  it("allows a generated video only on a video or animation asset at its own path", () => {
    const runId = `run_${"a".repeat(32)}`;
    const video = "media/loom/p/p-1/videos/english/intro-video";
    const address = { productCode: "p", refNum: 1 };
    const manifest = (asset: Record<string, unknown>) => ({
      ...address,
      assets: {
        "en-US": [
          {
            key: "intro-video",
            type: "video",
            description: "The sky",
            usages: [],
            ...asset,
          },
        ],
      },
    });
    const generatedVideo = { runId, sha256: "b".repeat(64) };
    const valid = validateManifest(manifest({ path: `${video}.webm`, generatedVideo }), address);
    expect(valid.assets["en-US"]![0]!.generatedVideo).toEqual(generatedVideo);
    // The runtime never sees Penguin's provenance.
    expect(wafManifest(valid).assets["en-US"]![0]).not.toHaveProperty("generatedVideo");
    // A version keeps the recording's bytes.
    expect(ownedMediaPaths(valid).owned).toEqual([
      { path: `${video}.webm`, expectedSha256: generatedVideo.sha256 },
    ]);
    expect(() =>
      validateManifest(
        manifest({
          type: "animation",
          path: "media/loom/p/p-1/animations/english/intro-video.webm",
          generatedVideo,
        }),
        address,
      ),
    ).not.toThrow();
    // A rendered MP4 says so, and is bound at the .mp4 path.
    const rendered = { ...generatedVideo, format: "mp4" };
    expect(
      validateManifest(manifest({ path: `${video}.mp4`, generatedVideo: rendered }), address)
        .assets["en-US"]![0]!.generatedVideo,
    ).toEqual(rendered);
    expect(() =>
      validateManifest(manifest({ path: `${video}.webm`, generatedVideo: rendered }), address),
    ).toThrow("Invalid generated video binding.");
    expect(() =>
      validateManifest(
        manifest({ path: `${video}.mp4`, generatedVideo: { ...generatedVideo, format: "mov" } }),
        address,
      ),
    ).toThrow("Invalid generated video binding.");
    for (const wrong of [
      // Another extension, where a take used to be bound, and an animation's folder for a video.
      { path: `${video}.mp4` },
      { path: `media/generated/${runId}.webm` },
      { path: "media/loom/p/p-1/animations/english/intro-video.webm" },
      { type: "image", path: `${video}.webm` },
    ])
      expect(() => validateManifest(manifest({ ...wrong, generatedVideo }), address)).toThrow(
        "Invalid generated video binding.",
      );
  });
});
