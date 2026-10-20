/**
 * Trimming audio, as Loom trims it. What this proves:
 *
 * - the bound clip is trimmed in place as MP3 at the asset's own path, its sidecar kept as
 *   Loom keeps it (fingerprint and model stay, script and measured length brought up to date,
 *   word timings gone), and the draft's revision moves;
 * - a preview is kept outside the media repository, served on its own route, and only the
 *   newest of each card stays; saving it replaces the bound clip only while that clip is the
 *   one it was cut from; a preview of anything else is attached as an upload instead;
 * - a second cut of a trim, an upload-bound clip and a WAV take are all trimmed in place, the
 *   WAV going with the trim;
 * - bad ranges, odd languages, a stale revision, a failed encode and a failed draft write are
 *   refused with nothing in the media repository changed or left behind.
 *
 * FFmpeg is faked with a WAV cutter that really cuts, except in the real trim at the end,
 * which skips where FFmpeg cannot run.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { TrimmedAudio, TrimRange } from "../src/activities/audio-trim-types.js";
import {
  audioSeconds,
  cutAudio,
  fitTrimRange,
  swapFiles,
  TrimPreviews,
} from "../src/activities/audio-trim.js";
import { FfmpegError, runFfmpeg } from "../src/activities/ffmpeg.js";
import { activitySpec, refMediaDir } from "./activity-fixtures.js";
import { imagePng } from "./image-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const FOLDER = "media/loom/words/words-12/audios/english";
const CLIP = `${FOLDER}/welcome.mp3`;
const RATE = 8000;

/** A WAV of 16-bit mono samples. */
function wav(samples: Int16Array, rate = RATE): Buffer {
  const data = samples.length * 2;
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
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, data)]);
}

/** `seconds` of a clip whose every sample is its own index, so a cut can be told apart. */
function countingWav(seconds: number): Buffer {
  return wav(Int16Array.from({ length: Math.round(seconds * RATE) }, (_, index) => index % 30000));
}

function samplesOf(bytes: Buffer): Int16Array {
  const copy = Buffer.from(bytes.subarray(44));
  return new Int16Array(copy.buffer, copy.byteOffset, copy.length / 2);
}

/** The fake FFmpeg: it measures and cuts the WAVs these tests use, and nothing else. */
function fakeFfmpeg() {
  const trims: TrimRange[] = [];
  const state = { fail: false };
  const isWav = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1", 8, 12) === "WAVE";
  return {
    trims,
    state,
    ports: {
      audioSeconds: async (bytes: Uint8Array) =>
        isWav(bytes) ? samplesOf(Buffer.from(bytes)).length / RATE : null,
      trimAudio: async (bytes: Uint8Array, range: TrimRange) => {
        trims.push(range);
        if (state.fail) throw new FfmpegError("ffmpeg could not encode", "encoder failed");
        const samples = samplesOf(Buffer.from(bytes));
        const from = Math.round(range.startSeconds * RATE);
        const to = Math.round(range.endSeconds * RATE);
        return wav(Int16Array.from([...samples.subarray(0, from), ...samples.subarray(to)]));
      },
    },
  };
}

describe("audio trim routes", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const ffmpeg = fakeFfmpeg();
    const t = await createTestApp({ audioEncodePorts: ffmpeg.ports });
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
    const folder = path.join(refMediaDir(t.root, "words", 12), "audios", "english");
    const file = path.join(folder, "welcome.mp3");
    const sidecar = path.join(folder, "welcome.json");
    const original = countingWav(2);
    const loomSidecar = {
      generatedAt: "2026-01-02T03:04:05Z",
      fileName: "welcome.mp3",
      text: "Hello!",
      model: "eleven_v3",
      voice: "Rachel",
      generationFingerprint: "f".repeat(64),
      wordTimings: [{ word: "Hello", startMs: 0, endMs: 400 }],
      durationMs: 2000,
      library_version: "1",
    };
    /** Binds the asset to `reference`, writing a clip there unless it is an upload. */
    const bind = async (reference = CLIP, name = "welcome.mp3"): Promise<ActivityDraft> => {
      if (!reference.includes("/uploads/")) {
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(path.join(folder, name), original);
        await fs.writeFile(sidecar, JSON.stringify({ ...loomSidecar, fileName: name }));
      }
      const current = await read();
      const manifest = structuredClone(current.mediaPlan!.manifest);
      manifest.assets["en-US"]!.find((entry) => entry.key === "welcome")!.path = reference;
      const saved = await client.put(`${endpoint}/media`, {
        manifest,
        expectedRevision: current.contentRevision,
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
      return (await saved.json()) as ActivityDraft;
    };
    const card = { language: "en-US", assetKey: "welcome" };
    const trim = (body: Record<string, unknown>) =>
      client.post(`${endpoint}/audio-trim`, { ...card, ...body });
    const preview = async (body: Record<string, unknown>) => {
      const response = await client.post(`${endpoint}/audio-trim-preview`, { ...card, ...body });
      return response;
    };
    const previewOf = async (body: Record<string, unknown>): Promise<TrimmedAudio> => {
      const response = await preview(body);
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as TrimmedAudio;
    };
    const previewBytes = (token: string) => client.get(`${endpoint}/audio-trim-previews/${token}`);
    const errorCode = async (response: Response) =>
      ((await response.json()) as { error: { code: string } }).error.code;
    const listing = async () => (await fs.readdir(folder)).sort();
    return {
      t,
      client,
      endpoint,
      bind,
      read,
      trim,
      preview,
      previewOf,
      previewBytes,
      errorCode,
      listing,
      file,
      folder,
      sidecar,
      original,
      ffmpeg,
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
    expect(f.ffmpeg.trims).toEqual([{ startSeconds: 0.5, endSeconds: 1 }]);
    const kept = samplesOf(await fs.readFile(f.file));
    expect(kept.length).toBe(1.5 * RATE);
    // The half second from 0.5 s is gone: sample 4000 is followed by sample 8000.
    expect([kept[3999], kept[4000]]).toEqual([3999, 8000]);
    expect(JSON.parse(await fs.readFile(f.sidecar, "utf8"))).toEqual({
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
    expect(await f.listing()).toEqual(["welcome.json", "welcome.mp3"]);
  });

  it("refuses a bad range with a clear 400 and changes nothing", async () => {
    const f = await setup();
    const bound = await f.bind();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ startSeconds: -1, endSeconds: 1 }, /non-negative/],
      [{ startSeconds: "0", endSeconds: 1 }, /numbers of seconds/],
      [{ startSeconds: 1, endSeconds: 1.01 }, /0\.05 seconds/],
      [{ startSeconds: 1, endSeconds: 0.5 }, /0\.05 seconds/],
      [{ startSeconds: 2, endSeconds: 3 }, /start before the clip ends/],
      [{ startSeconds: 0, endSeconds: 7 }, /leave some audio/],
    ];
    for (const [range, message] of cases) {
      const response = await f.trim({ ...range, expectedRevision: bound.contentRevision });
      expect(response.status, JSON.stringify(range)).toBe(400);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code, JSON.stringify(range)).toBe("trim_range_invalid");
      expect(body.error.message).toMatch(message);
    }
    expect(f.ffmpeg.trims).toEqual([]);
    expect(await fs.readFile(f.file)).toEqual(f.original);
    expect((await f.read()).contentRevision).toBe(bound.contentRevision);
  });

  it("reads an end past the clip as its end", () => {
    expect(fitTrimRange({ startSeconds: 1, endSeconds: 9 }, 2)).toEqual({
      startSeconds: 1,
      endSeconds: 2,
    });
  });

  it("answers 404 for a language that is not one of the manifest's own", async () => {
    const f = await setup();
    const bound = await f.bind();
    for (const language of ["__proto__", "constructor", "toString", "fr-FR"]) {
      const response = await f.trim({
        language,
        startSeconds: 0.5,
        endSeconds: 1,
        expectedRevision: bound.contentRevision,
      });
      expect(response.status, language).toBe(404);
      const previewed = await f.preview({
        language,
        source: "bound",
        startSeconds: 0,
        endSeconds: 1,
      });
      expect(previewed.status, language).toBe(404);
    }
  });

  it("holds the draft lock: two trims of one revision, one wins and one is refused", async () => {
    const f = await setup();
    const bound = await f.bind();
    const body = { startSeconds: 0.5, endSeconds: 1, expectedRevision: bound.contentRevision };
    const statuses = (await Promise.all([f.trim(body), f.trim(body)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 409]);
    expect(samplesOf(await fs.readFile(f.file)).length).toBe(1.5 * RATE);
  });

  it("refuses a stale revision, a missing clip and an asset that is not audio", async () => {
    const f = await setup();
    const unbound = await f.trim({
      startSeconds: 0.5,
      endSeconds: 1,
      expectedRevision: f.plannedDraft.contentRevision,
    });
    expect(unbound.status).toBe(404);
    expect(await f.errorCode(unbound)).toBe("audio_missing");
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
    f.ffmpeg.state.fail = true;
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
    expect(await f.listing()).toEqual(["welcome.json", "welcome.mp3"]);
    expect((await f.read()).contentRevision).toBe(bound.contentRevision);
  });

  it("puts the clip and its sidecar back when the draft cannot be written", async () => {
    const f = await setup();
    const bound = await f.bind();
    const sidecarBefore = await fs.readFile(f.sidecar, "utf8");
    // The draft's files are in the ref's spec folder; the clip is in the media repository.
    const write = fs.writeFile;
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      if (String(args[0]).includes(`${path.sep}spec${path.sep}`)) throw new Error("disk full");
      return write(...args);
    });
    const response = await f.trim({
      startSeconds: 0.5,
      endSeconds: 1,
      expectedRevision: bound.contentRevision,
    });
    expect(response.status).toBe(500);
    vi.restoreAllMocks();
    expect(await fs.readFile(f.file)).toEqual(f.original);
    expect(await fs.readFile(f.sidecar, "utf8")).toBe(sidecarBefore);
    expect(await f.listing()).toEqual(["welcome.json", "welcome.mp3"]);
    expect((await f.read()).contentRevision).toBe(bound.contentRevision);
  });

  it("previews outside the media repository, and saves the preview over the bound clip", async () => {
    const f = await setup();
    const bound = await f.bind();
    const trimmed = await f.previewOf({ source: "bound", startSeconds: 0, endSeconds: 0.5 });
    expect(trimmed.durationMs).toBe(1500);
    expect(trimmed.savesInPlace).toBe(true);
    const served = await f.previewBytes(trimmed.token);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("audio/mpeg");
    const heard = Buffer.from(await served.arrayBuffer());
    // Nothing changed in the media repository or the draft.
    expect(await fs.readFile(f.file)).toEqual(f.original);
    expect(await fs.stat(path.join(f.folder, "..", "..", "uploads")).catch(() => null)).toBeNull();
    expect((await f.read()).contentRevision).toBe(bound.contentRevision);

    const saved = await f.trim({
      previewToken: trimmed.token,
      expectedRevision: bound.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    // What was heard is what is saved, without cutting it again.
    expect(await fs.readFile(f.file)).toEqual(heard);
    expect(f.ffmpeg.trims).toHaveLength(1);
    expect((await f.previewBytes(trimmed.token)).status).toBe(404);
  });

  it("keeps only a card's newest preview", async () => {
    const f = await setup();
    await f.bind();
    const first = await f.previewOf({ source: "bound", startSeconds: 0, endSeconds: 0.5 });
    const second = await f.previewOf({ source: "bound", startSeconds: 1, endSeconds: 1.5 });
    expect((await f.previewBytes(first.token)).status).toBe(404);
    expect((await f.previewBytes(second.token)).status).toBe(200);
    expect((await f.previewBytes("not-a-token")).status).toBe(404);
  });

  it("refuses to save a preview over a clip that changed after it was cut", async () => {
    const f = await setup();
    const bound = await f.bind();
    const trimmed = await f.previewOf({ source: "bound", startSeconds: 0, endSeconds: 0.5 });
    // Another tab put a new clip at the same path.
    const replaced = countingWav(3);
    await fs.writeFile(f.file, replaced);
    const response = await f.trim({
      previewToken: trimmed.token,
      expectedRevision: bound.contentRevision,
    });
    expect(response.status).toBe(409);
    expect(await f.errorCode(response)).toBe("audio_changed");
    expect(await fs.readFile(f.file)).toEqual(replaced);
  });

  it("saves a second cut of a trim over the bound clip, as one trim", async () => {
    const f = await setup();
    const bound = await f.bind();
    const first = await f.previewOf({ source: "bound", startSeconds: 0, endSeconds: 0.5 });
    const second = await f.previewOf({
      source: "preview",
      token: first.token,
      startSeconds: 1,
      endSeconds: 1.5,
    });
    expect(second).toMatchObject({ durationMs: 1000, savesInPlace: true });
    const saved = await f.trim({
      previewToken: second.token,
      expectedRevision: bound.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const kept = samplesOf(await fs.readFile(f.file));
    expect(kept.length).toBe(RATE);
    expect(JSON.parse(await fs.readFile(f.sidecar, "utf8")).durationMs).toBe(1000);
  });

  it("attaches a preview of anything but the bound clip as an upload", async () => {
    const f = await setup();
    const uploaded = await f.client.post(`${f.endpoint}/media-uploads`, {
      name: "take.wav",
      dataBase64: countingWav(2).toString("base64"),
    });
    expect(uploaded.status).toBe(201);
    const { path: upload } = (await uploaded.json()) as { path: string };
    const bound = await f.bind();
    const trimmed = await f.previewOf({
      source: "upload",
      path: upload,
      startSeconds: 0,
      endSeconds: 0.5,
    });
    expect(trimmed.savesInPlace).toBe(false);
    const inPlace = await f.trim({
      previewToken: trimmed.token,
      expectedRevision: bound.contentRevision,
    });
    expect(inPlace.status).toBe(409);
    expect(await f.errorCode(inPlace)).toBe("trim_preview_mismatch");
    const attached = await f.client.post(
      `${f.endpoint}/audio-trim-previews/${trimmed.token}/attach`,
      {},
    );
    expect(attached.status, await attached.clone().text()).toBe(201);
    expect(((await attached.json()) as { path: string }).path).toMatch(
      // The fake FFmpeg writes WAV; the extension is read from the bytes.
      /^media\/loom\/words\/words-12\/uploads\/welcome-en-us-trimmed-[0-9a-f]{16}\.wav$/,
    );
    expect((await f.previewBytes(trimmed.token)).status).toBe(404);
    expect(await fs.readFile(f.file)).toEqual(f.original);

    const missingTake = await f.preview({
      source: "run",
      runId: `run_${"a".repeat(32)}`,
      startSeconds: 0,
      endSeconds: 1,
    });
    expect(missingTake.status).toBe(404);
    expect((await f.preview({ source: "disk", startSeconds: 0, endSeconds: 1 })).status).toBe(400);
  });

  it("trims an upload-bound clip into the asset's own path, with an upload's sidecar", async () => {
    const f = await setup();
    const uploaded = await f.client.post(`${f.endpoint}/media-uploads`, {
      name: "take.wav",
      dataBase64: countingWav(2).toString("base64"),
    });
    const { path: upload } = (await uploaded.json()) as { path: string };
    const bound = await f.bind(upload);
    const response = await f.trim({
      startSeconds: 0,
      endSeconds: 0.5,
      expectedRevision: bound.contentRevision,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const draft = (await response.json()) as ActivityDraft;
    expect(draft.mediaPlan!.manifest.assets["en-US"]![0]!.path).toBe(CLIP);
    const sidecar = JSON.parse(await fs.readFile(f.sidecar, "utf8")) as Record<string, unknown>;
    expect(sidecar).toMatchObject({ model: "Uploaded", text: "Hello!", durationMs: 1500 });
    expect(sidecar.generationFingerprint).toBeUndefined();
    // The upload itself is left as it was.
    const served = await f.client.get(
      `${f.endpoint}/media-upload?path=${encodeURIComponent(upload)}`,
    );
    expect(samplesOf(Buffer.from(await served.arrayBuffer())).length).toBe(2 * RATE);
  });

  it("trims a WAV take into MP3, and the WAV goes with the trim", async () => {
    const f = await setup();
    const bound = await f.bind(`${FOLDER}/welcome.wav`, "welcome.wav");
    const response = await f.trim({
      startSeconds: 0,
      endSeconds: 0.5,
      expectedRevision: bound.contentRevision,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await f.listing()).toEqual(["welcome.json", "welcome.mp3"]);
    expect(JSON.parse(await fs.readFile(f.sidecar, "utf8"))).toMatchObject({
      fileName: "welcome.mp3",
      generationFingerprint: "f".repeat(64),
      durationMs: 1500,
    });
  });

  it("trims a file the author has not stored yet into a preview", async () => {
    const f = await setup();
    const upload = (bytes: Buffer, range: TrimRange = { startSeconds: 0.5, endSeconds: 1 }) =>
      f.client.post(`${f.endpoint}/audio-trim-upload`, {
        language: "en-US",
        assetKey: "welcome",
        dataBase64: bytes.toString("base64"),
        ...range,
      });
    const response = await upload(countingWav(2));
    expect(response.status, await response.clone().text()).toBe(201);
    const trimmed = (await response.json()) as TrimmedAudio;
    expect(trimmed).toMatchObject({ durationMs: 1500, savesInPlace: false });
    expect((await f.previewBytes(trimmed.token)).status).toBe(200);
    expect((await upload(imagePng(2, 2))).status).toBe(415);
    expect((await upload(countingWav(2), { startSeconds: 1, endSeconds: 0 })).status).toBe(400);
  });
});

describe("swapping files", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });
  async function folder() {
    const dir = await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "swap-"));
    dirs.push(dir);
    await fs.writeFile(path.join(dir, "a.mp3"), "old a");
    await fs.writeFile(path.join(dir, "a.wav"), "old wav");
    return dir;
  }

  it("keeps the old files until commit, and puts them back on rollback", async () => {
    const dir = await folder();
    const writes = [
      { file: path.join(dir, "a.mp3"), bytes: Buffer.from("new a") },
      { file: path.join(dir, "a.json"), bytes: Buffer.from("new json") },
    ];
    const swap = await swapFiles(writes, [path.join(dir, "a.wav")]);
    expect(await fs.readFile(path.join(dir, "a.mp3"), "utf8")).toBe("new a");
    await swap.rollback();
    expect((await fs.readdir(dir)).sort()).toEqual(["a.mp3", "a.wav"]);
    expect(await fs.readFile(path.join(dir, "a.mp3"), "utf8")).toBe("old a");

    const kept = await swapFiles(writes, [path.join(dir, "a.wav")]);
    await kept.commit();
    expect((await fs.readdir(dir)).sort()).toEqual(["a.json", "a.mp3"]);
    expect(await fs.readFile(path.join(dir, "a.json"), "utf8")).toBe("new json");
  });

  it("changes nothing when a new file cannot be written", async () => {
    const dir = await folder();
    await expect(
      swapFiles([
        { file: path.join(dir, "a.mp3"), bytes: Buffer.from("new a") },
        { file: path.join(dir, "missing", "a.json"), bytes: Buffer.from("x") },
      ]),
    ).rejects.toThrow();
    expect((await fs.readdir(dir)).sort()).toEqual(["a.mp3", "a.wav"]);
    expect(await fs.readFile(path.join(dir, "a.mp3"), "utf8")).toBe("old a");
  });

  it("forgets a preview past its age", async () => {
    const dir = await folder();
    const previews = new TrimPreviews(path.join(dir, "previews"));
    const old = await previews.store(Buffer.from("x"), {
      target: { language: "en-US", assetKey: "one" },
      durationMs: 1,
    });
    const record = path.join(dir, "previews", `${old.token}.json`);
    await fs.writeFile(record, JSON.stringify({ ...old, createdAt: "2020-01-01T00:00:00Z" }));
    await previews.store(Buffer.from("y"), {
      target: { language: "en-US", assetKey: "two" },
      durationMs: 1,
    });
    await expect(previews.read(old.token)).rejects.toThrow(/gone/);
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
  const RATE_44 = 44_100;
  /** A second of 440 Hz tone, silent from 0.3 s to 0.7 s. */
  function toneSilenceTone(): Buffer {
    return wav(
      Int16Array.from({ length: RATE_44 }, (_, index) => {
        const t = index / RATE_44;
        return t >= 0.3 && t < 0.7 ? 0 : Math.round(Math.sin(2 * Math.PI * 440 * t) * 12000);
      }),
      RATE_44,
    );
  }

  /** Whether each 20 ms of a clip is loud, decoded by FFmpeg. */
  async function loudness(mp3: Buffer): Promise<boolean[]> {
    const pcm = await runFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "8000"].concat([
        "-f",
        "s16le",
        "pipe:1",
      ]),
      { purpose: "for this test", timeoutMs: 20_000, input: mp3 },
    );
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
    const windows: boolean[] = [];
    for (let from = 0; from + 160 <= samples.length; from += 160) {
      let sum = 0;
      for (let index = from; index < from + 160; index += 1) sum += samples[index]! ** 2;
      windows.push(Math.sqrt(sum / 160) > 2000);
    }
    return windows;
  }

  it("cuts out exactly the selected stretch and keeps the rest as MP3", async () => {
    const clip = toneSilenceTone();
    expect(await audioSeconds(clip)).toBeCloseTo(1, 2);

    // Cutting the silence leaves tone throughout.
    const toneOnly = await cutAudio(clip, { startSeconds: 0.3, endSeconds: 0.7 });
    expect(toneOnly[0] === 0xff || toneOnly.toString("latin1", 0, 3) === "ID3").toBe(true);
    expect(Math.abs((await audioSeconds(toneOnly))! - 0.6)).toBeLessThan(0.06);
    const toneWindows = await loudness(toneOnly);
    // The encoder's own delay may make the first and last windows quiet.
    expect(toneWindows.slice(3, -3).every(Boolean)).toBe(true);

    // Cutting the first tone leaves the silence first, then tone.
    const silenceFirst = await cutAudio(clip, { startSeconds: 0, endSeconds: 0.3 });
    expect(Math.abs((await audioSeconds(silenceFirst))! - 0.7)).toBeLessThan(0.06);
    const windows = await loudness(silenceFirst);
    expect(windows.slice(3, 17).some(Boolean)).toBe(false); // 0.06–0.34 s: silence
    expect(windows.slice(23, 33).every(Boolean)).toBe(true); // 0.46–0.66 s: tone

    // Cutting the last tone keeps the first tone, then the silence.
    const toneFirst = await cutAudio(clip, { startSeconds: 0.7, endSeconds: 1 });
    const tail = await loudness(toneFirst);
    expect(tail.slice(3, 13).every(Boolean)).toBe(true); // 0.06–0.26 s: tone
    expect(tail.slice(18, 33).some(Boolean)).toBe(false); // 0.36–0.66 s: silence

    expect(await audioSeconds(Buffer.from("not audio at all"))).toBeNull();
  });
});
