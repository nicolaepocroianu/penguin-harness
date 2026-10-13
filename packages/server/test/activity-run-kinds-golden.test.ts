/**
 * What every kind of activity run hands its agent, pinned: the prompt and the files staged in
 * its workspace, for one fixed activity per kind. A refactor of how runs start must leave both
 * byte for byte as they were (a changed prompt is a behaviour change and a prompt-cache miss).
 *
 * The golden values were captured once, from the code before run kinds became modules, with
 * `UPDATE_RUN_KIND_GOLDEN=1`. Values that differ between test runs (the server root, ids,
 * timestamps, the signed play link) are replaced by placeholders before they are compared.
 * Nothing reaches a model: a run's task is recorded and never started, and the speech and sound
 * helpers never end.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { abortEvent, requestBegin } from "@prismshadow/penguin-core";
import type { ActivityDetail, ActivityDraft, ActivityRun } from "../src/activities/domain.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import type { AcceptanceStage } from "../src/activities/acceptance-types.js";
import type { RunRequest } from "../src/activities/run-request.js";
import { INSTALL_MARKER } from "../src/activities/test-browser.js";
import { runFfmpeg } from "../src/activities/ffmpeg.js";
import type { BookWordsRefresh } from "../src/activities/book-word-types.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { activitySpec, catBookSpec } from "./activity-fixtures.js";
import { imagePng } from "./image-fixtures.js";
import { fakeMediaHelper } from "./audio-fixtures.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  provisionUser,
  waitFor,
  type TestApp,
} from "./helpers.js";

const GOLDEN_FILE = path.join(import.meta.dirname, "fixtures", "run-kinds-golden.json");
const UPDATE = process.env.UPDATE_RUN_KIND_GOLDEN === "1";
const PROJECT = "kinds-work";

interface Captured {
  kind: string;
  prompt: string | null;
  files: Record<string, string>;
}

/**
 * Starts a run that only a stage sequence or a service starts, with no route of its own: the
 * one place this test names the generation service's start.
 */
function directStart(
  service: ActivityGenerationService,
  activityId: string,
  revision: string,
  request: RunRequest,
): Promise<ActivityRun> {
  return service.start(PROJECT, activityId, "default_agent", revision, request);
}

const BINARY = /\.(png|mp4|webm|mp3|wav)$/;

function sha(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

describe("what each run kind hands its agent", () => {
  let t: TestApp;
  let normalize: (text: string) => string;
  /** Installed before each test: the suite restores every spy after one. */
  let stubSessions: () => void = () => {};
  const prompts = new Map<string, string>();
  const captured: Record<string, Captured> = {};
  const golden: Record<string, Captured> = existsSync(GOLDEN_FILE)
    ? (JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as Record<string, Captured>)
    : {};
  let client: ReturnType<typeof apiClient>;
  let service: ActivityGenerationService;
  const base = `/api/projects/${PROJECT}/activities`;

  async function files(dir: string, prefix = ""): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) Object.assign(out, await files(full, relative));
      else if (relative.startsWith("stills/")) out[relative] = "<still>";
      else {
        const bytes = await fs.readFile(full);
        out[relative] = BINARY.test(entry.name)
          ? sha(bytes)
          : sha(normalize(bytes.toString("utf8")));
      }
    }
    return out;
  }

  /** Records what a started run staged and was told, then cancels it so the activity is free. */
  async function capture(name: string, response: Response | ActivityRun, endpoint: string) {
    let run: ActivityRun;
    if (response instanceof Response) {
      expect(response.status, await response.clone().text()).toBe(202);
      run = (await response.json()) as ActivityRun;
    } else run = response;
    expect(run.status, run.error ?? "").toBe("running");
    const workspace = path.join(t.root, "activity-runs", run.runId);
    if (run.sessionId) await waitFor(() => prompts.has(run.sessionId!));
    const prompt = run.sessionId ? prompts.get(run.sessionId)! : null;
    captured[name] = {
      kind: run.kind,
      prompt: prompt === null ? null : normalize(prompt),
      files: await files(workspace),
    };
    expect((await client.post(`${endpoint}/runs/${run.runId}/cancel`, {})).status).toBe(200);
  }

  async function create(productCode: string, description: string, type = "standard") {
    const created = (await (
      await client.post(base, { productCode, refNum: 1, title: productCode, activityType: type })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const response = await client.patch(`${endpoint}/description`, {
      description,
      expectedRevision: created.draft.contentRevision,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return { id: created.id, endpoint };
  }
  async function revision(endpoint: string) {
    return ((await (await client.get(endpoint)).json()) as ActivityDetail).draft.contentRevision;
  }
  async function specify(endpoint: string, spec: unknown) {
    const saved = await client.post(`${endpoint}/apply-generated-spec`, {
      spec,
      expectedRevision: await revision(endpoint),
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const planned = await client.post(`${endpoint}/plan-media`, {
      expectedRevision: ((await saved.json()) as ActivityDraft).contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    return (await planned.json()) as ActivityDraft;
  }

  beforeAll(async () => {
    const helper = fakeMediaHelper();
    t = await createTestApp({
      mediaHelperPorts: helper.ports,
      testBrowserPorts: {
        locateExecutable: async (dir) => path.join(dir, "chromium-0000", "chrome"),
        launchServer: async () => ({ endpoint: "ws://127.0.0.1:1/browser", close: async () => {} }),
      },
    });
    const root = t.root;
    const roots = [root, root.replaceAll("\\", "/"), JSON.stringify(root).slice(1, -1)];
    normalize = (text) => {
      let out = text;
      for (const value of roots) out = out.split(value).join("<root>");
      return out
        .replace(/\b([a-z]+)_[0-9a-f]{32}\b/g, "$1_<id>")
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<time>")
        .replace(/("playUrl":\s*")[^"]*"/g, '$1<play-url>"');
    };
    const browsers = path.join(root, "browsers", "chromium-0000");
    await fs.mkdir(browsers, { recursive: true });
    await fs.writeFile(path.join(browsers, "chrome"), "fake browser");
    await fs.writeFile(path.join(browsers, INSTALL_MARKER), "");
    // A run's Session records what it was asked and waits to be stopped: nothing reaches a model.
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {},
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok",
      steer: () => false,
      skipReconnectWait: () => false,
      async *compact() {},
      async *run(input, options) {
        prompts.set(
          row.sessionId,
          (input as unknown as { payload: { text: string } }[])
            .map((message) => message.payload.text)
            .join("\n"),
        );
        yield requestBegin();
        await new Promise<void>((resolve) => {
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        yield abortEvent();
      },
    });
    stubSessions = () => {
      const adopt = t.deps.manager.adopt.bind(t.deps.manager);
      vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, fakeSession(row)));
    };
    const owner = await provisionUser(t.app, "kinds");
    client = apiClient(t.app, owner.cookie);
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
    expect(
      (
        await client.put(`/api/projects/${PROJECT}/agents/media_agent/vault`, {
          entries: ["GEMINI_API_KEY", "ELEVENLABS_API_KEY"].map((key) => ({
            key,
            value: "fake-test-only",
          })),
        })
      ).status,
    ).toBe(200);
    expect((await admin.put("/api/admin/settings", { activityVideoExperiment: true })).status).toBe(
      200,
    );
    service = t.deps.tree.api<ActivityGenerationService>("ActivitiesModule", "ActivityGeneration");
  }, 120_000);

  beforeEach(() => stubSessions());

  afterAll(async () => {
    vi.restoreAllMocks();
    if (UPDATE) writeFileSync(GOLDEN_FILE, `${JSON.stringify(captured, null, 2)}\n`);
    await t?.cleanup();
  });

  it("specification runs: the first pass, its repair, and a conversation", async () => {
    const a = await create("spec-p", "Teach sight words: cat, dog and sun.");
    const agent = { agentId: "default_agent" };
    await capture(
      "spec",
      await client.post(`${a.endpoint}/generate-spec`, {
        ...agent,
        expectedRevision: await revision(a.endpoint),
      }),
      a.endpoint,
    );
    await capture(
      "spec-repair",
      await directStart(service, a.id, await revision(a.endpoint), {
        kind: "spec",
        repair: "The specification has 0 scenes.",
      }),
      a.endpoint,
    );
    await capture(
      "assist",
      await client.post(`${a.endpoint}/assist`, {
        ...agent,
        expectedRevision: await revision(a.endpoint),
        message: "Make the intro shorter.",
      }),
      a.endpoint,
    );
  }, 120_000);

  it("runs over a saved specification and its media plan", async () => {
    const b = await create("media-p", "Look and listen. [image: a blue penguin]");
    await specify(b.endpoint, {
      ...activitySpec,
      id: "media-p",
      moduleFolder: "waf-module-media-p",
      runtime: { ...activitySpec.runtime, usesAssessment: true },
      acceptance_criterias: ["Tapping the penguin plays its name."],
      scenes: [
        {
          id: "intro",
          description: "Look and listen",
          media: { images: [{ key: "cover", description: "A blue penguin" }] },
          audio: {
            tracks: [
              { key: "welcome", description: "Greeting", script: "Hello!" },
              {
                key: "door",
                description: "A door",
                script: '<audio kind="sfx" duration="3">a wooden door creaks</audio>',
              },
            ],
          },
        },
      ],
    });
    const agent = { agentId: "default_agent" };
    const rev = () => revision(b.endpoint);
    await capture(
      "media-spec",
      await directStart(service, b.id, await rev(), { kind: "media-spec" }),
      b.endpoint,
    );
    await capture(
      "media-spec-repair",
      await directStart(service, b.id, await rev(), {
        kind: "media-spec",
        repair: "The listed media does not match the scene tags.",
      }),
      b.endpoint,
    );
    await capture(
      "assessment",
      await client.post(`${b.endpoint}/generate-assessment`, {
        ...agent,
        expectedRevision: await rev(),
      }),
      b.endpoint,
    );
    await capture(
      "module",
      await client.post(`${b.endpoint}/assemble-module`, {
        ...agent,
        expectedRevision: await rev(),
      }),
      b.endpoint,
    );
    await capture(
      "image",
      await client.post(`${b.endpoint}/generate-image`, {
        ...agent,
        expectedRevision: await rev(),
        language: "en-US",
        assetKey: "cover",
      }),
      b.endpoint,
    );
    await capture(
      "media-text",
      await client.post(`${b.endpoint}/generate-media-text`, {
        ...agent,
        expectedRevision: await rev(),
        language: "en-US",
        assetKey: "cover",
      }),
      b.endpoint,
    );
    await capture(
      "speech-gemini",
      await client.post(`${b.endpoint}/generate-audio`, {
        ...agent,
        expectedRevision: await rev(),
        language: "en-US",
        assetKey: "welcome",
        voice: "Kore",
        provider: "gemini",
      }),
      b.endpoint,
    );
    await capture(
      "speech-elevenlabs",
      await client.post(`${b.endpoint}/generate-audio`, {
        ...agent,
        expectedRevision: await rev(),
        language: "en-US",
        assetKey: "welcome",
        voice: "elevenlabs-default",
        provider: "elevenlabs",
      }),
      b.endpoint,
    );
    await capture(
      "sound",
      await client.post(`${b.endpoint}/generate-sound`, {
        ...agent,
        expectedRevision: await rev(),
        language: "en-US",
        assetKey: "door",
        provider: "elevenlabs",
      }),
      b.endpoint,
    );
    const stage = (cachedTest: string | null): AcceptanceStage => ({
      input: {
        playUrl: "http://127.0.0.1:1/play",
        viewport: { width: 640, height: 480 },
        criteria: ["Tapping the penguin plays its name."],
        browserPath: "/browsers/chrome",
        scenes: ["intro"],
        specRevision: "spec-revision",
      } as AcceptanceStage["input"],
      cachedTest,
      playwrightVersion: "1.2.3",
    });
    await capture(
      "test",
      await directStart(service, b.id, await rev(), { kind: "test", test: stage(null) }),
      b.endpoint,
    );
    await capture(
      "test-reuse",
      await directStart(service, b.id, await rev(), {
        kind: "test",
        test: stage("// the earlier tests\n"),
      }),
      b.endpoint,
    );
  }, 240_000);

  it("a book: its word sounds, and its assembly", async () => {
    const c = await create("cat-book", "A cat book.", "book");
    const planned = await specify(c.endpoint, catBookSpec());
    const refreshed = await client.post(`${c.endpoint}/book-words/refresh`, {
      language: "en-US",
      bookMode: "decodable",
      expectedRevision: planned.contentRevision,
    });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    const { missing } = (await refreshed.json()) as BookWordsRefresh;
    expect(missing.length).toBeGreaterThan(0);
    await capture(
      "phonemes",
      await client.post(`${c.endpoint}/generate-phonemes`, {
        agentId: "default_agent",
        expectedRevision: await revision(c.endpoint),
        language: "en-US",
        words: missing.slice(0, 2),
      }),
      c.endpoint,
    );
    await capture(
      "module-book",
      await client.post(`${c.endpoint}/assemble-module`, {
        agentId: "default_agent",
        expectedRevision: await revision(c.endpoint),
        bookMode: "readAlong",
      }),
      c.endpoint,
    );
  }, 120_000);

  it("scene videos: a composition, a timeline and a critique", async () => {
    const d = await create("scene-p", "A short story about the sky");
    const plannedDraft = await specify(d.endpoint, {
      ...activitySpec,
      id: "scene-p",
      moduleFolder: "waf-module-scene-p",
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
    });
    const uploaded = await client.post(`${d.endpoint}/media-uploads`, {
      name: "sky.png",
      dataBase64: imagePng(4, 3).toString("base64"),
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { path: skyPath } = (await uploaded.json()) as { path: string };
    const manifest = structuredClone(plannedDraft.mediaPlan!.manifest);
    manifest.assets["en-US"]!.find((asset) => asset.key === "sky")!.path = skyPath;
    const bound = await client.put(`${d.endpoint}/media`, {
      manifest,
      expectedRevision: plannedDraft.contentRevision,
    });
    expect(bound.status, await bound.clone().text()).toBe(200);
    const target = { agentId: "default_agent", language: "en-US", assetKey: "intro-video" };
    await capture(
      "composition",
      await client.post(`${d.endpoint}/compose-video`, {
        ...target,
        expectedRevision: await revision(d.endpoint),
      }),
      d.endpoint,
    );

    // A kept recording of the scene, as the recorder keeps one, for a timeline and a critique.
    const recording = await service.openDeterministic(PROJECT, d.id, "video", {
      video: {
        language: "en-US",
        assetKey: "intro-video",
        compositionRunId: `run_${"b".repeat(32)}`,
        width: 160,
        height: 120,
        seconds: 2,
      },
    });
    const clip = path.join(t.root, "clip.mp4");
    await runFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi"].concat([
        "-i",
        "color=blue:size=160x120:rate=10:duration=2",
        "-pix_fmt",
        "yuv420p",
        clip,
      ]),
      { purpose: "to make a test clip", timeoutMs: 60_000 },
    );
    const authoring = t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const result = await authoring.storeVideo(
      PROJECT,
      d.id,
      recording.runId,
      await fs.readFile(clip),
      "mp4",
    );
    expect(
      await service.settleDeterministic(
        PROJECT,
        d.id,
        recording.runId,
        "succeeded",
        null,
        JSON.stringify(result),
      ),
    ).toBe(true);
    await capture(
      "timeline",
      await client.post(`${d.endpoint}/refine-timeline`, {
        ...target,
        expectedRevision: await revision(d.endpoint),
      }),
      d.endpoint,
    );
    await capture(
      "critique",
      await client.post(`${d.endpoint}/critique-video`, {
        ...target,
        expectedRevision: await revision(d.endpoint),
      }),
      d.endpoint,
    );
  }, 240_000);

  it("matches what each kind was handed before", () => {
    if (UPDATE) return;
    expect(Object.keys(captured).sort()).toEqual(Object.keys(golden).sort());
    for (const [name, value] of Object.entries(golden)) expect(captured[name], name).toEqual(value);
  });
});
