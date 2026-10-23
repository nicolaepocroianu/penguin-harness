/**
 * Loom's asset manifest and WAF Harness's view of it, saved again and again: what WAF Harness removes
 * stays removed, what Loom removes is not brought back, the order holds, Loom's copy taken at
 * adoption only fills in Loom's fields on assets WAF Harness still holds, a key listed twice is
 * read and written the same way, and a planned asset that shares a key with a book-reader
 * asset keeps that asset's role.
 */
import { describe, expect, it } from "vitest";
import { mergeLoomManifest, wafHarnessManifest } from "../src/activities/loom-manifest.js";
import type { AssetManifest } from "../src/activities/media.js";

const ADDRESS = { productCode: "r2pt01", refNum: 150 };
const FOLDER = "media/loom/r2pt01/r2pt01-150";
type Json = Record<string, unknown>;

const image = (key: string, extra: Json = {}): Json => ({
  key,
  type: "image",
  description: `Image ${key}`,
  path: `${FOLDER}/images/english/${key}.png`,
  ...extra,
});
const used = (key: string, extra: Json = {}) =>
  image(key, {
    usages: [{ sceneId: "s1", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
    ...extra,
  });
const intro: Json = {
  key: "book-intro-video",
  type: "video",
  description: "Original book introduction.",
  path: "media/videos/bookVideos/intro.mp4",
  role: "bookIntro",
};

const manifest = (assets: Json[]): Json => ({ ...ADDRESS, assets: { "en-US": assets } });
const plan = (assets: Json[]) => manifest(assets) as unknown as AssetManifest;
const keys = (written: Json) =>
  ((written["assets"] as Record<string, Json[]>)["en-US"] ?? []).map((asset) => asset["key"]);

describe("Loom's manifest saved by WAF Harness", () => {
  it("keeps an asset WAF Harness removed removed, however often it saves", () => {
    // Loom's copy at adoption: x had no usages there; WAF Harness carried it, then removed it.
    const original = manifest([image("x", { imageLabels: ["sky"] }), intro]);
    const first = mergeLoomManifest(original, plan([used("x")]), ADDRESS, original);
    expect(keys(first)).toEqual(["x", "book-intro-video"]);
    let written = first;
    for (let save = 0; save < 3; save++) {
      written = mergeLoomManifest(written, plan([]), ADDRESS, original);
      expect(keys(written)).toEqual(["book-intro-video"]);
    }
    expect(wafHarnessManifest(written).assets["en-US"]).toEqual([]);
  });

  it("does not bring back an asset Loom removed", () => {
    const original = manifest([used("x"), intro]);
    const first = mergeLoomManifest(original, plan([used("x")]), ADDRESS, original);
    const loomEdited = manifest([used("x")]);
    const next = mergeLoomManifest(loomEdited, plan([used("x")]), ADDRESS, original);
    expect(keys(first)).toEqual(["x", "book-intro-video"]);
    expect(keys(next)).toEqual(["x"]);
  });

  it("keeps the order of the file over repeated saves", () => {
    const original = manifest([used("a"), intro, used("b"), image("c"), used("d")]);
    const mine = plan([used("a"), used("b"), used("d")]);
    let written = mergeLoomManifest(original, mine, ADDRESS, original);
    const order = keys(written);
    expect(order).toEqual(["a", "book-intro-video", "b", "c", "d"]);
    for (let save = 0; save < 3; save++) {
      written = mergeLoomManifest(written, mine, ADDRESS, original);
      expect(keys(written)).toEqual(order);
    }
  });

  it("takes Loom's fields from its adoption copy for an asset WAF Harness holds", () => {
    const original = manifest([used("x", { manifestOwned: true })]);
    // A write before the carry left x out; the carry brings it back.
    const between = mergeLoomManifest(original, plan([]), ADDRESS, original);
    expect(keys(between)).toEqual([]);
    const carried = mergeLoomManifest(between, plan([used("x")]), ADDRESS, original);
    expect((carried["assets"] as Record<string, Json[]>)["en-US"]![0]).toMatchObject({
      key: "x",
      manifestOwned: true,
    });
  });

  it("reads and writes a key Loom listed twice the same way: the first one", () => {
    const onDisk = manifest([used("x", { note: "first" }), used("x", { note: "second" })]);
    const read = wafHarnessManifest(onDisk);
    expect(read.assets["en-US"]).toHaveLength(1);
    const written = mergeLoomManifest(onDisk, read, ADDRESS);
    expect((written["assets"] as Record<string, Json[]>)["en-US"]).toEqual([
      used("x", { note: "first" }),
    ]);
  });

  it("keeps a book-reader asset's role when WAF Harness plans an asset with its key", () => {
    const onDisk = manifest([intro]);
    const planned = used("book-intro-video", { type: "video" });
    const written = mergeLoomManifest(onDisk, plan([planned]), ADDRESS);
    expect((written["assets"] as Record<string, Json[]>)["en-US"]![0]).toMatchObject({
      key: "book-intro-video",
      role: "bookIntro",
    });
    // WAF Harness reads back what it wrote.
    expect(wafHarnessManifest(written).assets["en-US"]).toEqual([planned]);
  });
});
