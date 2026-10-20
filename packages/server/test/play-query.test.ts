/**
 * A play link's query, read with the rules of Loom's dev-sandbox `player.js`, plus Penguin's
 * older `language` and `scene` names.
 */
import { describe, expect, it } from "vitest";
import {
  normalizePlayLanguage,
  parsePlayRef,
  parsePlayResolution,
  playQueryString,
  readPlayQuery,
} from "../src/activities/play-query.js";
import { pickPlayable } from "../src/activities/player-html-routes.js";

const read = (query: string) => {
  const params = new URLSearchParams(query);
  return readPlayQuery((name) => params.get(name));
};

describe("a play link's query", () => {
  it.each([
    ["en-US", "en-US"],
    ["es-MX", "es-MX"],
    [" ro-RO ", "ro-RO"],
    ["fr-FR", "en-US"],
    ["", "en-US"],
    [null, "en-US"],
  ])("takes languageCode %j as %s", (value, expected) => {
    expect(normalizePlayLanguage(value)).toBe(expected);
  });

  it.each([
    ["1024x768", "1024x768"],
    ["0640x0480", "640x480"],
    ["10x10", "10x10"],
    ["9x10", null],
    ["123456x10", null],
    ["20000x100", null],
    ["1024X768", null],
    ["", null],
  ])("takes resolution %j as %j", (value, expected) => {
    expect(parsePlayResolution(value)).toBe(expected);
  });

  it.each([
    ["0", { ref: 0 }],
    ["12", { ref: 12 }],
    ["", { error: "Ref is required. Use a non-negative whole number." }],
    ["-1", { error: 'Invalid ref "-1". Use a non-negative whole number.' }],
    ["1.5", { error: 'Invalid ref "1.5". Use a non-negative whole number.' }],
  ])("takes ref %j as %j", (value, expected) => {
    expect(parsePlayRef(value)).toEqual(expected);
  });

  it("reads Loom's names first, and Penguin's older ones when Loom's are absent", () => {
    expect(read("languageCode=es-MX&language=ro-RO&startSceneId=a&scene=b")).toMatchObject({
      languageCode: "es-MX",
      startSceneId: "a",
    });
    expect(read("language=ro-RO&scene=b")).toMatchObject({
      languageCode: "ro-RO",
      startSceneId: "b",
    });
  });

  it("treats an empty name as absent, reading the older one then", () => {
    expect(read("languageCode=&language=es-MX&startSceneId=&scene=b")).toMatchObject({
      languageCode: "es-MX",
      languageAsked: true,
      startSceneId: "b",
    });
    expect(read("languageCode=")).toMatchObject({ languageCode: "en-US", languageAsked: false });
    expect(playQueryString(read("languageCode="))).toBe("");
  });

  it("names a module root as monorepo or legacy, and says why anything else is refused", () => {
    expect(read("source=monorepo")).toMatchObject({ source: "monorepo", sourceError: null });
    expect(read("source=legacy")).toMatchObject({ source: "legacy", sourceError: null });
    expect(read("source=cloud")).toMatchObject({
      source: null,
      sourceError: 'Invalid source "cloud". Use monorepo or legacy.',
    });
    expect(read("")).toMatchObject({ module: null, ref: null, refError: null, source: null });
  });

  it("carries on, in Loom's names, only what was asked for", () => {
    const query = read("module=m2ab01&ref=1&scene=intro&resolution=bad&source=monorepo");
    expect(playQueryString(query)).toBe("module=m2ab01&ref=1&startSceneId=intro&source=monorepo");
    expect(playQueryString(read("language=fr-FR"))).toBe("languageCode=en-US");
  });
});

describe("the ref a /player.html link names", () => {
  const ref = (projectId: string, refNum: number, source: "monorepo" | "legacy" = "monorepo") => ({
    projectId,
    activityId: `act_${projectId}_${refNum}`,
    refNum,
    source,
  });

  it("is the one ref of that number, in the root the link names", () => {
    const candidates = [ref("a", 1), ref("a", 2)];
    expect(pickPlayable(candidates, "m2ab01", 2, null)).toEqual({ chosen: ref("a", 2) });
    expect(pickPlayable(candidates, "m2ab01", 2, "monorepo")).toEqual({ chosen: ref("a", 2) });
    expect(pickPlayable(candidates, "m2ab01", 2, "legacy")).toEqual({
      status: 404,
      message: 'Failed to load module metadata for "m2ab01".',
    });
  });

  it("says so in Loom's words when the module or the ref is not there", () => {
    expect(pickPlayable([], "m2ab01", 1, null)).toEqual({
      status: 404,
      message: 'Failed to load module metadata for "m2ab01".',
    });
    expect(pickPlayable([ref("a", 1)], "m2ab01", 3, null)).toEqual({
      status: 404,
      message: 'Ref #3 is not available for "m2ab01".',
    });
  });

  it("names the projects, rather than guessing, when the ref is open in several", () => {
    expect(pickPlayable([ref("a", 1), ref("b", 1)], "m2ab01", 1, null)).toEqual({
      status: 409,
      message:
        '"m2ab01" ref 1 is open in more than one of your projects: a, b. Add project=<id> to the link to choose one.',
    });
    // A root the link names can tell them apart.
    expect(pickPlayable([ref("a", 1), ref("b", 1, "legacy")], "m2ab01", 1, "legacy")).toEqual({
      chosen: ref("b", 1, "legacy"),
    });
  });
});
