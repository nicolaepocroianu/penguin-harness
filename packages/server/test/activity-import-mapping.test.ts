import { describe, expect, it } from "vitest";
import {
  assemblyBlockers,
  describeImport,
  importIsFaithful,
  mapImport,
  type SourceProduct,
  type SourceRef,
} from "../src/activities/import-mapping.js";

const product = (overrides: Partial<SourceProduct> = {}): SourceProduct => ({
  productCode: "sight-words",
  moduleFolder: "waf-module-sight-words",
  title: "Sight Words",
  canonicalRefNum: 1,
  activityType: "standard",
  bookMode: null,
  ...overrides,
});

const ref = (overrides: Partial<SourceRef> = {}): SourceRef => ({
  refNum: 1,
  title: "Sight Words 1",
  displayName: null,
  stable: false,
  spec: { id: "sight-words", scenes: [] },
  manifest: { assets: { "en-US": [] } },
  description: "Practice sight words.",
  languages: ["en-US"],
  ...overrides,
});

describe("a clean import", () => {
  const mapping = mapImport(product(), [ref()]);

  it("carries the product as it was", () => {
    expect(mapping.product).toEqual({
      productCode: "sight-words",
      moduleFolder: "waf-module-sight-words",
      canonicalRefNum: 1,
      activityType: "standard",
      bookMode: null,
    });
  });

  it("carries each ref with its name and stability", () => {
    expect(mapping.activities).toEqual([
      {
        refNum: 1,
        title: "Sight Words 1",
        displayName: null,
        stable: false,
        description: "Practice sight words.",
        spec: { id: "sight-words", scenes: [] },
        languages: ["en-US"],
      },
    ]);
  });

  it("drops and repairs nothing", () => {
    expect(mapping.dropped).toEqual([]);
    expect(mapping.repaired).toEqual([]);
    expect(importIsFaithful(mapping)).toBe(true);
  });

  it("orders refs by number whatever order they were read in", () => {
    const mapping = mapImport(product({ canonicalRefNum: 2 }), [
      ref({ refNum: 5 }),
      ref({ refNum: 2 }),
    ]);
    expect(mapping.activities.map((activity) => activity.refNum)).toEqual([2, 5]);
  });
});

describe("repairs, which are recorded rather than silent", () => {
  it("takes the lowest ref when the canonical one does not exist", () => {
    // Three real products in the checkout need this; it is the same repair migration 18
    // makes for existing rows.
    const mapping = mapImport(product({ canonicalRefNum: 1 }), [
      ref({ refNum: 3 }),
      ref({ refNum: 5 }),
    ]);
    expect(mapping.product.canonicalRefNum).toBe(3);
    expect(mapping.repaired[0]).toContain("named ref 1 as canonical, which does not exist");
  });

  it("takes the lowest ref when none was named", () => {
    const mapping = mapImport(product({ canonicalRefNum: null }), [ref({ refNum: 2 })]);
    expect(mapping.product.canonicalRefNum).toBe(2);
    expect(mapping.repaired[0]).toContain("named no canonical ref");
  });

  it("falls back to the address when nothing has a title", () => {
    const mapping = mapImport(product({ title: null }), [ref({ title: null })]);
    expect(mapping.activities[0]!.title).toBe("sight-words-1");
    expect(mapping.repaired[0]).toContain("had no title");
  });

  it("uses the product's title when the ref has none, without calling it a repair", () => {
    const mapping = mapImport(product(), [ref({ title: "   " })]);
    expect(mapping.activities[0]!.title).toBe("Sight Words");
    expect(mapping.repaired).toEqual([]);
  });

  it("still counts as faithful, because nothing was lost", () => {
    const mapping = mapImport(product({ canonicalRefNum: null }), [ref({ refNum: 2 })]);
    expect(importIsFaithful(mapping)).toBe(true);
  });
});

describe("what cannot be carried", () => {
  it("names a language group this product does not support", () => {
    const mapping = mapImport(product(), [ref({ languages: ["en-US", "fr-FR"] })]);
    expect(mapping.activities[0]!.languages).toEqual(["en-US"]);
    expect(mapping.dropped[0]).toContain('"fr-FR" language group');
    expect(importIsFaithful(mapping)).toBe(false);
  });

  it("names a manifest with nothing to translate from", () => {
    const mapping = mapImport(product(), [ref({ languages: ["es-MX"] })]);
    expect(mapping.dropped.join(" ")).toContain("no en-US group");
  });

  it("names a missing specification, manifest and description separately", () => {
    const mapping = mapImport(product(), [
      ref({ spec: null, manifest: null, description: "  ", languages: [] }),
    ]);
    expect(mapping.dropped.join(" ")).toContain("no specification");
    expect(mapping.dropped.join(" ")).toContain("no asset manifest");
    expect(mapping.dropped.join(" ")).toContain("no description");
  });

  it("does not complain about a missing default group when there is no manifest at all", () => {
    // One problem, not two: the manifest being absent is the thing to report.
    const mapping = mapImport(product(), [ref({ manifest: null, languages: [] })]);
    expect(mapping.dropped.filter((entry) => entry.includes("translate from"))).toEqual([]);
  });
});

describe("a book", () => {
  it("carries its reading mode", () => {
    const mapping = mapImport(product({ activityType: "book", bookMode: "readAlong" }), [ref()]);
    expect(mapping.product.bookMode).toBe("readAlong");
    expect(assemblyBlockers(mapping)).toEqual([]);
  });

  it("reports a missing reading mode rather than inventing one", () => {
    // Guessing produces the wrong kind of book, and an author finds out at assembly.
    const mapping = mapImport(product({ activityType: "book", bookMode: null }), [ref()]);
    expect(mapping.product.bookMode).toBeNull();
    expect(assemblyBlockers(mapping)[0]).toContain("no reading mode recorded");
  });

  it("keeps that separate from fidelity, because the import itself is faithful", () => {
    const mapping = mapImport(product({ activityType: "book", bookMode: null }), [ref()]);
    expect(importIsFaithful(mapping)).toBe(true);
    expect(assemblyBlockers(mapping)).toHaveLength(1);
  });

  it("asks nothing of a standard activity", () => {
    expect(assemblyBlockers(mapImport(product(), [ref()]))).toEqual([]);
  });
});

describe("what an author is told", () => {
  it("states the refs, the canonical one, and that nothing was dropped", () => {
    const message = describeImport(mapImport(product(), [ref()]));
    expect(message).toContain("1 ref, ref 1 canonical");
    expect(message).toContain("Nothing was dropped.");
  });

  it("lists repairs and losses separately, since they are different news", () => {
    const mapping = mapImport(product({ canonicalRefNum: null }), [
      ref({ refNum: 2, languages: ["en-US", "fr-FR"] }),
    ]);
    const message = describeImport(mapping);
    expect(message).toContain("1 thing was repaired");
    expect(message).toContain("1 thing could not be carried");
  });
});
