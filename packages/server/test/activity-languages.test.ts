import { describe, expect, it } from "vitest";
import {
  ACTIVITY_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  addableLanguages,
  canAddLanguage,
  findLanguage,
  languageProblems,
  mediaTargetPath,
  translationTargets,
} from "../src/activities/languages.js";
import { scaffoldLanguage } from "../src/activities/waf-module.js";

const codes = (languages: { code: string }[]) => languages.map((language) => language.code);

describe("the language table", () => {
  it("is Loom's three, with English first", () => {
    expect(codes([...ACTIVITY_LANGUAGES])).toEqual(["en-US", "es-MX", "ro-RO"]);
    expect(ACTIVITY_LANGUAGES[0]!.code).toBe(DEFAULT_LANGUAGE_CODE);
  });

  it("gives every language a folder, since its media has to live somewhere", () => {
    for (const language of ACTIVITY_LANGUAGES)
      expect(language.folder, language.code).toMatch(/^[a-z]+$/);
  });

  it("gives every translation target a name a translator would recognise", () => {
    for (const language of translationTargets())
      expect(language.translationName, language.code).toBeTruthy();
  });

  it("gives the default no translation name, because nothing translates into it", () => {
    expect(findLanguage(DEFAULT_LANGUAGE_CODE)?.translationName).toBeUndefined();
  });

  it("does not know a language that is not in the table", () => {
    expect(findLanguage("fr-FR")).toBeUndefined();
  });
});

describe("what can still be added", () => {
  it("offers both targets to an activity with only the default", () => {
    expect(codes(addableLanguages(["en-US"]))).toEqual(["es-MX", "ro-RO"]);
  });

  it("stops offering one that is already there", () => {
    expect(codes(addableLanguages(["en-US", "es-MX"]))).toEqual(["ro-RO"]);
  });

  it("never offers the default, which is always present", () => {
    expect(codes(addableLanguages([]))).not.toContain("en-US");
  });

  it("offers nothing once every language is present", () => {
    expect(addableLanguages(["en-US", "es-MX", "ro-RO"])).toEqual([]);
  });
});

describe("whether a language may be added", () => {
  it("allows a supported target when the default is present", () => {
    expect(canAddLanguage(["en-US"], "es-MX")).toBeNull();
  });

  it("refuses one this product does not support, and lists what it does", () => {
    const refusal = canAddLanguage(["en-US"], "fr-FR");
    expect(refusal?.kind).toBe("unknown");
    expect(refusal?.message).toContain("en-US, es-MX, ro-RO");
  });

  it("refuses the default, which is always there", () => {
    expect(canAddLanguage(["en-US"], "en-US")?.kind).toBe("is_default");
  });

  it("refuses one already added", () => {
    expect(canAddLanguage(["en-US", "es-MX"], "es-MX")?.kind).toBe("already_present");
  });

  it("refuses when there is nothing to translate from", () => {
    // A Spanish group with no English source is not a multi-language activity; it is an
    // activity whose default group is missing, and every later stage would look for it.
    const refusal = canAddLanguage(["es-MX"], "ro-RO");
    expect(refusal?.kind).toBe("default_missing");
    expect(refusal?.message).toContain("en-US");
  });
});

describe("where media lives", () => {
  it("puts default-language audio under the language folder, not the code", () => {
    expect(
      mediaTargetPath({
        productCode: "sight-words",
        refNum: 1,
        type: "audio",
        assetKey: "intro",
        extension: "mp3",
      }),
    ).toBe("media/loom/sight-words/sight-words-1/audios/english/intro.mp3");
  });

  it("separates a translation into its own folder", () => {
    expect(
      mediaTargetPath({
        productCode: "sight-words",
        refNum: 1,
        type: "audio",
        assetKey: "intro",
        extension: "mp3",
        language: "es-MX",
      }),
    ).toBe("media/loom/sight-words/sight-words-1/audios/spanish/intro.mp3");
  });

  it("uses the plural folder each visual type expects", () => {
    const base = { productCode: "p", refNum: 0, assetKey: "k", extension: "svg" };
    expect(mediaTargetPath({ ...base, type: "image" })).toContain("/images/");
    expect(mediaTargetPath({ ...base, type: "video" })).toContain("/videos/");
    expect(mediaTargetPath({ ...base, type: "animation" })).toContain("/animations/");
  });

  it("tolerates a leading dot on the extension", () => {
    expect(
      mediaTargetPath({
        productCode: "p",
        refNum: 0,
        type: "image",
        assetKey: "k",
        extension: ".svg",
      }),
    ).toMatch(/k\.svg$/);
  });

  it("refuses an unknown type, language or empty extension rather than guessing", () => {
    const base = { productCode: "p", refNum: 0, assetKey: "k", extension: "svg" };
    expect(mediaTargetPath({ ...base, type: "hologram" })).toBeNull();
    expect(mediaTargetPath({ ...base, type: "image", language: "fr-FR" })).toBeNull();
    expect(mediaTargetPath({ ...base, type: "image", extension: "." })).toBeNull();
  });
});

describe("whether a manifest's languages are coherent", () => {
  it("accepts the default alone, and the default with translations", () => {
    expect(languageProblems(["en-US"])).toEqual([]);
    expect(languageProblems(["en-US", "es-MX", "ro-RO"])).toEqual([]);
  });

  it("reports a manifest with nothing to translate from", () => {
    expect(languageProblems(["es-MX"])[0]).toContain("no en-US group");
  });

  it("reports a repeated language", () => {
    expect(languageProblems(["en-US", "es-MX", "es-MX"])).toContain(
      'The manifest repeats the language "es-MX".',
    );
  });

  it("reports one this product does not support", () => {
    expect(languageProblems(["en-US", "fr-FR"])).toContain(
      'The manifest holds "fr-FR", which this product does not support.',
    );
  });

  it("reports every problem rather than the first", () => {
    expect(languageProblems(["fr-FR", "fr-FR"]).length).toBeGreaterThan(2);
  });
});

describe("the language a built module starts in", () => {
  const activity = (assets: Record<string, unknown[]>) =>
    ({
      draft: { mediaPlan: { manifest: { assets } } },
    }) as never;

  it("is the default when the manifest has it", () => {
    expect(scaffoldLanguage(activity({ "en-US": [], "es-MX": [] }))).toBe("en-US");
  });

  it("is the one language present when the default is not there", () => {
    expect(scaffoldLanguage(activity({ "es-MX": [] }))).toBe("es-MX");
  });

  it("falls back to the default for groups this build does not recognise", () => {
    // Building in a language nothing has assets for produces an activity that loads and
    // then plays nothing.
    expect(scaffoldLanguage(activity({ "fr-FR": [], "de-DE": [] }))).toBe("en-US");
  });

  it("is the default when there is no media plan at all", () => {
    expect(scaffoldLanguage({ draft: {} } as never)).toBe("en-US");
  });
});
