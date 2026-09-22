import { describe, expect, it } from "vitest";
import {
  aliasesByRefKey,
  applyAliasesToLanguageGroups,
  declarable,
  declarationAsset,
  mediaUrl,
  mediaUrlVersions,
  overlayRefAssets,
  versionMediaUrls,
  type ManifestAsset,
} from "../src/activities/sandbox-ref-assets.js";

const asset = (overrides: Partial<ManifestAsset> = {}): ManifestAsset => ({
  key: "intro-audio",
  type: "audio",
  path: "media/sight-words/intro.mp3",
  languageCode: "en-US",
  ...overrides,
});

describe("the URL a module asks for", () => {
  it("is the path under the media root, behind the framework's token", () => {
    expect(mediaUrl(asset())).toBe("{{MEDIA}}/sight-words/intro.mp3");
  });

  it("carries a version when there is one", () => {
    expect(mediaUrl(asset(), "abc")).toBe("{{MEDIA}}/sight-words/intro.mp3?v=abc");
  });

  it("tolerates a leading slash and backslashes", () => {
    expect(mediaUrl(asset({ path: "/media\\sight-words\\intro.mp3" }))).toBe(
      "{{MEDIA}}/sight-words/intro.mp3",
    );
  });

  it("is empty for a path outside the media root", () => {
    // Not a media asset, and serving it from the media route would be a way out of it.
    expect(mediaUrl(asset({ path: "../secrets/key.pem" }))).toBe("");
    expect(mediaUrl(asset({ path: "" }))).toBe("");
  });
});

describe("what belongs in the declaration", () => {
  it("takes ordinary media", () => {
    expect(declarable(asset())).toBe(true);
    expect(declarable(asset({ type: "image", path: "media/a.png" }))).toBe(true);
  });

  it("leaves out a book's per-word audio", () => {
    expect(declarable(asset({ role: "bookWord" }))).toBe(false);
  });

  it("leaves out video that is not a book's intro", () => {
    expect(declarable(asset({ type: "video", path: "media/a.mp4" }))).toBe(false);
    expect(declarable(asset({ type: "video", path: "media/a.mp4", role: "bookIntro" }))).toBe(true);
  });

  it("leaves out an asset missing a key, a type or a usable path", () => {
    expect(declarable(asset({ key: " " }))).toBe(false);
    expect(declarable(asset({ type: "" }))).toBe(false);
    expect(declarable(asset({ path: "elsewhere/a.mp3" }))).toBe(false);
  });
});

describe("one declaration entry", () => {
  it("keeps what the module already said about the asset", () => {
    expect(declarationAsset(asset(), { type: "audio", url: "old", volume: 0.5 })).toEqual({
      type: "audio",
      url: "{{MEDIA}}/sight-words/intro.mp3",
      volume: 0.5,
    });
  });

  it("carries a description when the manifest has one", () => {
    expect(declarationAsset(asset({ description: "Warm welcome" }), undefined)?.description).toBe(
      "Warm welcome",
    );
  });

  it("is nothing for an asset that does not belong", () => {
    expect(declarationAsset(asset({ role: "bookWord" }), undefined)).toBeNull();
  });
});

describe("keys a ref renamed", () => {
  it("maps the ref's key back to the module's", () => {
    // The module code is shared and refers to its own key.
    expect([...aliasesByRefKey([asset({ key: "ref-intro", sourceKey: "intro-audio" })])]).toEqual([
      ["ref-intro", "intro-audio"],
    ]);
  });

  it("is not a rename when the names match", () => {
    expect(aliasesByRefKey([asset({ sourceKey: "intro-audio" })]).size).toBe(0);
  });

  it("accepts an alias derived elsewhere, keyed by type and key", () => {
    const derived = new Map([["audio:ref-intro", "intro-audio"]]);
    expect(aliasesByRefKey([asset({ key: "ref-intro" })], derived).get("ref-intro")).toBe(
      "intro-audio",
    );
  });

  it("never aliases a book's per-word audio", () => {
    expect(aliasesByRefKey([asset({ key: "w1", sourceKey: "word", role: "bookWord" })]).size).toBe(
      0,
    );
  });
});

describe("overlaying a ref's media onto the shared module", () => {
  const declaration = {
    id: "sightWords",
    assets: { "intro-audio": { type: "audio", url: "{{MEDIA}}/canonical/intro.mp3" } },
  };

  it("replaces the canonical ref's media with this ref's", () => {
    // Without this every ref of a product would play the canonical ref's audio.
    const overlaid = overlayRefAssets(declaration, [asset()], new Map());
    expect((overlaid.assets as Record<string, { url: string }>)["intro-audio"]!.url).toBe(
      "{{MEDIA}}/sight-words/intro.mp3",
    );
  });

  it("answers under the module's key as well as the ref's", () => {
    const assets = [asset({ key: "ref-intro", sourceKey: "intro-audio" })];
    const overlaid = overlayRefAssets(declaration, assets, aliasesByRefKey(assets));
    const result = overlaid.assets as Record<string, { url: string }>;
    expect(result["ref-intro"]!.url).toBe("{{MEDIA}}/sight-words/intro.mp3");
    expect(result["intro-audio"]!.url).toBe("{{MEDIA}}/sight-words/intro.mp3");
  });

  it("versions every overlaid URL", () => {
    const overlaid = overlayRefAssets(declaration, [asset()], new Map(), "v7");
    expect((overlaid.assets as Record<string, { url: string }>)["intro-audio"]!.url).toBe(
      "{{MEDIA}}/sight-words/intro.mp3?v=v7",
    );
  });

  it("leaves assets this ref does not mention", () => {
    const overlaid = overlayRefAssets(
      { ...declaration, assets: { ...declaration.assets, other: { type: "image", url: "x" } } },
      [asset()],
      new Map(),
    );
    expect((overlaid.assets as Record<string, unknown>).other).toEqual({ type: "image", url: "x" });
  });

  it("does not alter the shared declaration", () => {
    // It is read once and served to every ref; overlaying in place would give ref 2 the
    // media of whichever ref was previewed last.
    const before = JSON.stringify(declaration);
    overlayRefAssets(declaration, [asset()], new Map(), "v7");
    expect(JSON.stringify(declaration)).toBe(before);
  });

  it("copes with a module that declares no assets at all", () => {
    const overlaid = overlayRefAssets({ id: "x" }, [asset()], new Map());
    expect(Object.keys(overlaid.assets as Record<string, unknown>)).toEqual(["intro-audio"]);
  });
});

describe("versioning the URLs inside a configuration", () => {
  const versions = mediaUrlVersions([asset()], "v7");

  it("replaces a URL the manifest produced, wherever it sits", () => {
    const configuration = {
      scenes: [{ audio: { src: "{{MEDIA}}/sight-words/intro.mp3" } }],
      top: "{{MEDIA}}/sight-words/intro.mp3",
    };
    expect(versionMediaUrls(configuration, versions)).toEqual({
      scenes: [{ audio: { src: "{{MEDIA}}/sight-words/intro.mp3?v=v7" } }],
      top: "{{MEDIA}}/sight-words/intro.mp3?v=v7",
    });
  });

  it("leaves a string that merely resembles a media URL", () => {
    // Built from the manifest rather than by rewriting whatever looks like one.
    expect(versionMediaUrls("{{MEDIA}}/not/in/the/manifest.mp3", versions)).toBe(
      "{{MEDIA}}/not/in/the/manifest.mp3",
    );
  });

  it("leaves numbers, booleans and nulls alone", () => {
    expect(versionMediaUrls({ a: 1, b: true, c: null }, versions)).toEqual({
      a: 1,
      b: true,
      c: null,
    });
  });
});

describe("a renamed asset a module reads from its configuration", () => {
  const assets = [asset({ key: "ref-intro", sourceKey: "intro-audio", languageCode: "es-MX" })];
  const aliases = aliasesByRefKey(assets);

  it("becomes reachable under the module's key", () => {
    const configuration = {
      "en-US": { "intro-audio": "{{MEDIA}}/canonical/intro.mp3" },
      "es-MX": { "ref-intro": "{{MEDIA}}/sight-words/intro.mp3" },
    };
    const applied = applyAliasesToLanguageGroups(configuration, assets, aliases) as Record<
      string,
      Record<string, string>
    >;
    expect(applied["es-MX"]!["intro-audio"]).toBe("{{MEDIA}}/sight-words/intro.mp3");
  });

  it("touches only the language group the asset belongs to", () => {
    // Writing a Spanish clip into the English group is how an activity speaks the wrong
    // language.
    const configuration = {
      "en-US": { "intro-audio": "{{MEDIA}}/canonical/intro.mp3" },
      "es-MX": { "ref-intro": "{{MEDIA}}/sight-words/intro.mp3" },
    };
    const applied = applyAliasesToLanguageGroups(configuration, assets, aliases) as Record<
      string,
      Record<string, string>
    >;
    expect(applied["en-US"]!["intro-audio"]).toBe("{{MEDIA}}/canonical/intro.mp3");
  });

  it("falls back to the manifest's own URL when the group says nothing", () => {
    const applied = applyAliasesToLanguageGroups({ "es-MX": {} }, assets, aliases) as Record<
      string,
      Record<string, string>
    >;
    expect(applied["es-MX"]!["intro-audio"]).toBe("{{MEDIA}}/sight-words/intro.mp3");
  });

  it("leaves a configuration that is not grouped by language", () => {
    const flat = { "ref-intro": "x" };
    expect(applyAliasesToLanguageGroups(flat, assets, aliases)).toBe(flat);
  });

  it("does not mutate what it was given", () => {
    const configuration = { "es-MX": { "ref-intro": "{{MEDIA}}/sight-words/intro.mp3" } };
    const before = JSON.stringify(configuration);
    applyAliasesToLanguageGroups(configuration, assets, aliases);
    expect(JSON.stringify(configuration)).toBe(before);
  });
});
