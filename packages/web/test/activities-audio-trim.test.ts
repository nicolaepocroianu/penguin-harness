/**
 * The trim control's states, and where a trim is cut from and what Save then does with it.
 * The bar is rendered to static markup for each state: the hint, a keyboard start marked, a
 * selection with its lengths and actions, a cut under way, and a failed one. A trim of the
 * bound clip is saved by trimming that clip in place; any other candidate by binding its file.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MediaAsset } from "@waterford/waf-harness-server/api";
import {
  boundAudioUrl,
  candidateId,
  candidateTrimSource,
  candidateUrl,
  cardCandidate,
  currentTrimSource,
  saveStep,
} from "../src/features/activities/audio-cards";
import { clipTime } from "../src/features/activities/waveform";
import { WaveformTrimBar } from "../src/features/activities/waveform-trim-bar";
import { S } from "../src/lib/strings";

const words = S.activities.waveformTrim;

function bar(over: Partial<Parameters<typeof WaveformTrimBar>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(WaveformTrimBar, {
      duration: 4,
      selection: null,
      mark: null,
      trimming: false,
      error: null,
      onPlay: () => {},
      onPlayRemaining: () => {},
      onRemove: () => {},
      onClear: () => {},
      ...over,
    }),
  );
}

describe("the trim bar", () => {
  it("says how to select while nothing is selected", () => {
    const html = bar();
    expect(html).toContain(words.hint);
    expect(html).not.toContain(words.remove);
    expect(html).not.toContain('role="alert"');
  });

  it("says where a keyboard selection starts while its end is to be chosen", () => {
    const html = bar({ mark: 1.5 });
    expect(html).toContain(words.marked(clipTime(1.5)));
    expect(html).not.toContain(words.hint);
  });

  it("offers a selection's actions, with what it covers and what remains", () => {
    const html = bar({ selection: { start: 1, end: 2.5 } });
    expect(html).toContain(words.selected(clipTime(1), clipTime(2.5)));
    expect(html).toContain(words.remains(clipTime(2.5)));
    for (const action of [words.play, words.playRemaining, words.remove, words.clear])
      expect(html).toContain(action);
    expect(html).toContain(words.handles);
    expect(html).not.toContain(words.savesInPlace);
    expect(html).not.toContain('disabled=""');
  });

  it("says when saving trims the current audio in place", () => {
    expect(bar({ selection: { start: 1, end: 2 }, savesInPlace: true })).toContain(
      words.savesInPlace,
    );
  });

  it("holds every action while a cut is under way", () => {
    const html = bar({ selection: { start: 1, end: 2 }, trimming: true });
    expect(html).toContain(words.working);
    expect(html).not.toContain(`>${words.remove}<`);
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });

  it("reports a cut that failed", () => {
    const html = bar({ error: "Trimming the audio failed: no ffmpeg" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(words.failed("Trimming the audio failed: no ffmpeg"));
  });
});

describe("where a trim is cut from and how it is saved", () => {
  const asset = (path?: string): MediaAsset =>
    ({
      key: "welcome",
      type: "audio",
      usages: [],
      ...(path ? { path } : {}),
    }) as unknown as MediaAsset;
  const loomPath = "media/loom/words/words-12/audios/english/welcome.mp3";
  const upload = "media/loom/words/words-12/uploads/take-0123456789abcdef.mp3";

  it("cuts the current audio from the saved binding", () => {
    expect(currentTrimSource(asset(loomPath), "en-US", loomPath)).toEqual({ kind: "bound" });
    // Not saved yet: an upload is cut as itself, a checkout file not at all.
    expect(currentTrimSource(asset(upload), "en-US", loomPath)).toEqual({
      kind: "upload",
      path: upload,
    });
    expect(currentTrimSource(asset(loomPath), "en-US", undefined)).toBeNull();
    expect(currentTrimSource(asset(), "en-US", undefined)).toBeNull();
  });

  it("cuts a candidate from its take, its file or its preview", () => {
    expect(candidateTrimSource({ source: "generated", runId: "run_1" })).toEqual({
      kind: "run",
      runId: "run_1",
    });
    expect(candidateTrimSource({ source: "upload", path: upload })).toEqual({
      kind: "upload",
      path: upload,
    });
    expect(candidateTrimSource({ source: "trim", token: "abc", savesInPlace: true })).toEqual({
      kind: "preview",
      token: "abc",
    });
  });

  it("saves a trim of the current audio in place, attaches any other trim, binds an upload", () => {
    const inPlace = cardCandidate(undefined, { source: "trim", token: "abc", savesInPlace: true })!;
    expect(saveStep(inPlace)).toEqual({ step: "trim", token: "abc" });
    expect(saveStep({ source: "trim", token: "abc", savesInPlace: false })).toEqual({
      step: "attach",
      token: "abc",
    });
    expect(saveStep({ source: "upload", path: upload })).toEqual({ step: "bind", path: upload });
    expect(saveStep({ source: "generated", runId: "run_1" })).toEqual({
      step: "accept",
      runId: "run_1",
    });
  });

  it("plays a trim from its preview, never from the media repository", () => {
    const candidate = { source: "trim", token: "abc", savesInPlace: true } as const;
    expect(candidateUrl(candidate, "/e")).toBe("/e/audio-trim-previews/abc");
    expect(candidateId(candidate)).toBe("abc");
  });

  it("names the bound clip by its length, so a trim in place loads the new clip", () => {
    const before = boundAudioUrl({ path: loomPath, durationMs: 2000 }, "/e");
    const after = boundAudioUrl({ path: loomPath, durationMs: 1500 }, "/e");
    expect(before).toBe("/e/sandbox/media/loom/words/words-12/audios/english/welcome.mp3?v=2000");
    expect(after).not.toBe(before);
    // A clip with no recorded length, an upload and a take keep their plain addresses.
    expect(boundAudioUrl({ path: loomPath }, "/e")).toBe(
      "/e/sandbox/media/loom/words/words-12/audios/english/welcome.mp3",
    );
    expect(boundAudioUrl({ path: upload, durationMs: 1500 }, "/e")).toBe(
      `/e/media-upload?path=${encodeURIComponent(upload)}`,
    );
  });
});
