/**
 * Trimming audio, as Loom trims it. What this proves: the bound clip is trimmed in place as
 * MP3 at the asset's own path, its sidecar kept as Loom keeps it (fingerprint and model stay,
 * script and length brought up to date, word timings gone) and the draft's revision moves; a
 * preview stores the trimmed clip as an upload and changes nothing else; a trim of a file not
 * stored yet does the same; every bad range, a stale revision and a failed encode are refused
 * with nothing in the media repository changed or left half-written. FFmpeg is faked, except
 * in the one real trim at the end, which skips where FFmpeg cannot run.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { TrimmedAudio, TrimRange } from "../src/activities/audio-trim-types.js";
import { audioSeconds, cutAudio, fitTrimRange } from "../src/activities/audio-trim.js";
import { FfmpegError, runFfmpeg } from "../src/activities/ffmpeg.js";
import { activitySpec, refMediaDir } from "./activity-fixtures.js";
import { soundMp3 } from "./audio-fixtures.js";
import { imagePng } from "./image-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const CLIP = "media/loom/words/words-12/audios/english/welcome.mp3";
/** How long every clip the fake measures plays. */
const SECONDS = 2;

/** A silent WAV: 16-bit mono at `rate`, `samples` long. */
function silentWav(samples: number, rate = 8000): Buffer {
  const data = samples * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data, 40);
  return Buffer.concat([header, Buffer.alloc(data)]);
}

describe("audio trim routes", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const trims: TrimRange[] = [];
    const fake = { fail: false };
    const trimmedBytes = soundMp3(3);
    const t = await createTestApp({
      audioEncodePorts: {
        audioSeconds: async () => SECONDS,
        trimAudio: async (_bytes, range) => {
          trims.push(range);
          if (fake.fail) throw new FfmpegError("ffmpeg could not encode", "encoder failed");
          return trimmedBytes;
        },
      },
    });
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "trimmer");
    const client = apiClient(t.app, owner.cookie);
    const project = await client.post("/api/projects", { projectId: "trimmer-work" });
    expect(project.status, await project.clone().text()).toBe(201);
    const created = (await (
      await client.post("/api/projects/trimmer-work/activities", {
        productCode: "words",
        refNum: 12,
        title: "Words 12",
      })
    ).json()) as ActivityDetail;
    const endpoint = `/api/projects/trimmer-work/activities/${created.id}`;
    const specced = (await (
      await client.post(`${endpoint}/apply-generated-spec`, {
        spec: {
          ...activitySpec,
          scenes: [
            {
              id: "intro",
              description: "Listen",
              audio: { tracks: [{ key: "welcome", description: "Greeting", script: "Hello!" }] },
            },
          ],
        },
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const planned = await client.post(`${endpoint}/plan-media`, {
      expectedRevision: specced.contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    const plannedDraft = (await planned.json()) as ActivityDraft;
    const read = async () => ((await (await client.get(endpoint)).json()) as ActivityDetail).draft;
    const file = path.join(refMediaDir(t.root, "words", 12), "audios", "english", "welcome.mp3");
    const sidecar = file.replace(/\.mp3$/, ".json");
    const original = soundMp3(8);
    /** Binds the asset to a clip at Loom's path, with a sidecar Loom wrote, and saves it. */
    const bind = async (): Promise<ActivityDraft> => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, original);
      await fs.writeFile(
        sidecar,
        JSON.stringify({
          generatedAt: "2026-01-02T03:04:05Z",
          fileName: "welcome.mp3",
          text: "Hello!",
          model: "eleven_v3",
          voice: "Rachel",
          generationFingerprint: "f".repeat(64),
          wordTimings: [{ word: "Hello", startMs: 0, endMs: 400 }],
          durationMs: 2000,
          library_version: "1",
        }),
      );
      const manifest = structuredClone(plannedDraft.mediaPlan!.manifest);
      const asset = manifest.assets["en-US"]!.find((entry) => entry.key === "welcome")!;
      asset.path = CLIP;
      const saved = await client.put(`${endpoint}/media`, {
        manifest,
        expectedRevision: plannedDraft.contentRevision,
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
      return (await saved.json()) as ActivityDraft;
    };
    const trim = (body: Record<string, unknown>) =>
      client.post(`${endpoint}/audio-trim`, { language: "en-US", assetKey: "welcome", ...body });
    const preview = (body: Record<string, unknown>) =>
      client.post(`${endpoint}/audio-trim-preview`, body);
    return {
      t,
      client,
      endpoint,
      bind,
      read,
      trim,
      preview,
      file,
      sidecar,
      original,
      trimmedBytes,
      trims,
      fake,
      plannedDraft,
    };
  }

  it("trims the bound clip in place, keeping the sidecar as Loom does", async () => {
    const f = await setup();
    const bound = await f.bind();
    const response = await f.trim({
      startSeconds: 0.5,
      endSeconds: 1,
      expectedRevision: bound.contentRevision,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const draft = (await response.json()) as ActivityDraft;
    expect(f.trims).toEqual([{ startSeconds: 0.5, endSeconds: 1 }]);
    expect(await fs.readFile(f.file)).toEqual(f.trimmedBytes);
    const sidecar = JSON.parse(await fs.readFile(f.sidecar, "utf8")) as Record<string, unknown>;
    expect(sidecar).toEqual({
      generatedAt: "2026-01-02T03:04:05Z",
      fileName: "welcome.mp3",
      text: "Hello!",
      model: "eleven_v3",
      voice: "Rachel",
      generationFingerprint: "f".repeat(64),
      durationMs: 1500,
      library_version: "1",
    });
    const asset = draft.mediaPlan!.manifest.assets["en-US"]!.find((a) => a.key === "welcome")!;
    expect(asset.path).toBe(CLIP);
    expect(asset.durationMs).toBe(1500);
    expect(asset.generatedAudio).toBeUndefined();
    expect(asset.wordTimings).toBeUndefined();
    // A new revision: whatever was made from the untrimmed clip is out of date.
    expect(draft.contentRevision).not.toBe(bound.contentRevision);
    expect((await f.read()).contentRevision).toBe(draft.contentRevision);
    // Nothing half-written is left beside the clip.
    expect((await fs.readdir(path.dirname(f.file))).sort()).toEqual([
      "welcome.json",
      "welcome.mp3",
    ]);
  });

  it("refuses a bad range with a clear 400 and changes nothing", async () => {
    const f = await setup();
    const bound = await f.bind();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ startSeconds: -1, endSeconds: 1 }, /non-negative/],
      [{ startSeconds: "0", endSeconds: 1 }, /numbers of seconds/],
      [{ startSeconds: 1, endSeconds: 1.01 }, /0\.05 seconds/],
      [{ startSeconds: 1, endSeconds: 0.5 }, /0\.05 seconds/],
      [{ startSeconds: SECONDS, endSeconds: SECONDS + 1 }, /start before the clip ends/],
      [{ startSeconds: 0, endSeconds: SECONDS + 5 }, /leave some audio/],
    ];
    for (const [range, message] of cases) {
      const response = await f.trim({ ...range, expectedRevision: bound.contentRevision });
      expect(response.status, JSON.stringify(range)).toBe(400);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code, JSON.stringify(range)).toBe("trim_range_invalid");
      expect(body.error.message).toMatch(message);
    }
    expect(f.trims).toEqual([]);
    expect(await fs.readFile(f.file)).toEqual(f.original);
    expect((await f.read()).contentRevision).toBe(bound.contentRevision);
  });

  it("reads an end past the clip as its end", () => {
    expect(fitTrimRange({ startSeconds: 1, endSeconds: 9 }, 2)).toEqual({
      startSeconds: 1,
      endSeconds: 2,
    });
  });

  it("holds the draft lock: two trims of one revision, one wins and one is stale", async () => {
    const f = await setup();
    const bound = await f.bind();
    const body = { startSeconds: 0.5, endSeconds: 1, expectedRevision: bound.contentRevision };
    const statuses = (await Promise.all([f.trim(body), f.trim(body)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 409]);
    expect(f.trims).toHaveLength(1);
  });

  it("refuses a stale revision, a missing clip and an asset that is not audio", async () => {
    const f = await setup();
    const unbound = await f.trim({
      startSeconds: 0.5,
      endSeconds: 1,
      expectedRevision: f.plannedDraft.contentRevision,
    });
    expect(unbound.status).toBe(404);
    expect(((await unbound.json()) as { error: { code: string } }).error.code).toBe(
      "audio_missing",
    );
    const bound = await f.bind();
    const stale = await f.trim({
      startSeconds: 0.5,
      endSeconds: 1,
      expectedRevision: f.plannedDraft.contentRevision,
    });
    expect(stale.status).toBe(409);
    const unknown = await f.trim({
      assetKey: "nobody",
      startSeconds: 0.5,
      endSeconds: 1,
      expectedRevision: bound.contentRevision,
    });
    expect(unknown.status).toBe(404);
    expect(await fs.readFile(f.file)).toEqual(f.original);
  });

  it("leaves the clip, its sidecar and the draft as they were when the encode fails", async () => {
    const f = await setup();
    const bound = await f.bind();
    const sidecarBefore = await fs.readFile(f.sidecar, "utf8");
    f.fake.fail = true;
    const response = await f.trim({
      startSeconds: 0.5,
      endSeconds: 1,
      expectedRevision: bound.contentRevision,
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("audio_trim_failed");
    expect(body.error.message).toContain("ffmpeg could not encode");
    expect(await fs.readFile(f.file)).toEqual(f.original);
    expect(await fs.readFile(f.sidecar, "utf8")).toBe(sidecarBefore);
    expect((await fs.readdir(path.dirname(f.file))).sort()).toEqual([
      "welcome.json",
      "welcome.mp3",
    ]);
    expect((await f.read()).contentRevision).toBe(bound.contentRevision);
  });

  it("previews a trim of the bound clip as an MP3 upload, changing nothing else", async () => {
    const f = await setup();
    const bound = await f.bind();
    const response = await f.preview({
      source: "bound",
      language: "en-US",
      assetKey: "welcome",
      startSeconds: 0,
      endSeconds: 0.5,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const trimmed = (await response.json()) as TrimmedAudio;
    expect(trimmed.durationMs).toBe(1500);
    expect(trimmed.media.kind).toBe("audio");
    expect(trimmed.media.mimeType).toBe("audio/mpeg");
    expect(trimmed.media.path).toMatch(
      /^media\/loom\/words\/words-12\/uploads\/welcome-en-us-trimmed-[0-9a-f]{16}\.mp3$/,
    );
    const served = await f.client.get(
      `${f.endpoint}/media-upload?path=${encodeURIComponent(trimmed.media.path)}`,
    );
    expect(Buffer.from(await served.arrayBuffer())).toEqual(f.trimmedBytes);
    expect(await fs.readFile(f.file)).toEqual(f.original);
    expect((await f.read()).contentRevision).toBe(bound.contentRevision);

    // A trim of that upload, as a second cut of the candidate.
    const again = await f.preview({
      source: "upload",
      path: trimmed.media.path,
      startSeconds: 1,
      endSeconds: 1.5,
    });
    expect(again.status, await again.clone().text()).toBe(201);
    expect(((await again.json()) as TrimmedAudio).media.path).toContain("/uploads/welcome-en-us-");

    const badSource = await f.preview({ source: "disk", startSeconds: 0, endSeconds: 1 });
    expect(badSource.status).toBe(400);
    const missingTake = await f.preview({
      source: "run",
      runId: `run_${"a".repeat(32)}`,
      startSeconds: 0,
      endSeconds: 1,
    });
    expect(missingTake.status).toBe(404);
  });

  it("trims a file the author has not stored yet", async () => {
    const f = await setup();
    const upload = (bytes: Buffer, range: TrimRange = { startSeconds: 0, endSeconds: 1 }) =>
      f.client.post(`${f.endpoint}/audio-trim-upload`, {
        name: "My Take.wav",
        dataBase64: bytes.toString("base64"),
        ...range,
      });
    const response = await upload(silentWav(800));
    expect(response.status, await response.clone().text()).toBe(201);
    const trimmed = (await response.json()) as TrimmedAudio;
    expect(trimmed.media.path).toMatch(/\/uploads\/my-take-trimmed-[0-9a-f]{16}\.mp3$/);
    expect(trimmed.durationMs).toBe(1000);
    expect((await upload(imagePng(2, 2))).status).toBe(415);
    expect((await upload(silentWav(800), { startSeconds: 1, endSeconds: 0 })).status).toBe(400);
  });
});

const ffmpegRuns = await runFfmpeg(["-hide_banner", "-version"], {
  purpose: "for this test",
  timeoutMs: 20_000,
}).then(
  () => true,
  () => false,
);

describe.skipIf(!ffmpegRuns)("a real trim", () => {
  it("cuts the selection out of a clip and keeps the rest as MP3", async () => {
    const wav = silentWav(44_100, 44_100); // one second
    expect(await audioSeconds(wav)).toBeCloseTo(1, 2);
    for (const [range, kept] of [
      [{ startSeconds: 0.2, endSeconds: 0.5 }, 0.7],
      [{ startSeconds: 0, endSeconds: 0.25 }, 0.75],
      [{ startSeconds: 0.6, endSeconds: 1 }, 0.6],
    ] as const) {
      const mp3 = await cutAudio(wav, range);
      // An ID3 tag or an MPEG audio frame sync: MP3, as Loom keeps audio.
      expect(mp3[0] === 0xff || mp3.toString("latin1", 0, 3) === "ID3").toBe(true);
      const seconds = await audioSeconds(mp3);
      // The encoder's own delay and padding are a frame or two.
      expect(Math.abs(seconds! - kept), JSON.stringify(range)).toBeLessThan(0.06);
    }
    expect(await audioSeconds(Buffer.from("not audio at all"))).toBeNull();
  });
});
