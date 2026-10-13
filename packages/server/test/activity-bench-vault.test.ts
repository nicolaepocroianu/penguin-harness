/**
 * Where the activity bench's cases are kept: a plain folder as people write it (the placeholder
 * cases), and the sealed file it becomes — no case text, criterion or canary readable in it,
 * opened only with its passphrase, each case's hidden checks unsealed on their own, and nothing
 * opened once its public header was changed.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlainVault, SealedVault, sealCases } from "../../../scripts/activity-bench/vault.js";
import { CANARY, PLACEHOLDER, removeTemps, tempDir } from "./activity-bench-fixtures.js";

const PASSPHRASE = "correct horse battery staple";

afterEach(removeTemps);

describe("the placeholder cases", () => {
  it("are three placeholders, two dev and one held out, with the canary in every hidden file", async () => {
    const vault = new PlainVault(PLACEHOLDER);
    const set = await vault.describe();
    expect(set.bench).toBe("placeholder");
    expect(set.cases.map(({ id, split, placeholder }) => ({ id, split, placeholder }))).toEqual([
      { id: "CASE-001-placeholder-tap-the-star", split: "dev", placeholder: true },
      { id: "CASE-002-placeholder-count-the-apples", split: "dev", placeholder: true },
      { id: "CASE-003-placeholder-held-out-match-the-sound", split: "heldOut", placeholder: true },
    ]);
    expect(set.cases.every((item) => item.title.startsWith("PLACEHOLDER: "))).toBe(true);
    const request = await vault.request(set.cases[0]!.id);
    expect(request).toMatchObject({ productCode: "BENCHPH", refNum: 1, sequences: ["all"] });
    expect(request.script).toContain("This is a placeholder case");
    for (const item of set.cases) {
      const hidden = await vault.hidden(item.id);
      expect(hidden.test).toContain(CANARY);
      expect(hidden.criteria).toHaveLength(4);
    }
    expect(vault.tripwires()).toEqual([CANARY, path.resolve(PLACEHOLDER)]);
  });

  it("refuses a case whose hidden checks lack the canary", () => {
    const dir = tempDir();
    fs.cpSync(PLACEHOLDER, dir, { recursive: true });
    const file = path.join(dir, "CASE-002-placeholder-count-the-apples", "hidden.test.mjs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll(CANARY, "no canary"));
    expect(() => new PlainVault(dir)).toThrow(
      "CASE-002-placeholder-count-the-apples: hidden.test.mjs must contain the canary.",
    );
  });
});

describe("a sealed bench", () => {
  async function sealed() {
    const out = path.join(tempDir(), "placeholder.sealed");
    const plain = new PlainVault(PLACEHOLDER);
    await sealCases(plain, PASSPHRASE, out);
    return { plain, out };
  }

  it("opens with its passphrase into the very cases that were sealed", async () => {
    const { plain, out } = await sealed();
    const vault = new SealedVault(out, PASSPHRASE);
    expect(vault.sealed).toBe(true);
    const set = await plain.describe();
    expect(await vault.describe()).toEqual(set);
    for (const item of set.cases) {
      expect(await vault.request(item.id)).toEqual(await plain.request(item.id));
      expect(await vault.hidden(item.id)).toEqual(await plain.hidden(item.id));
    }
    expect(vault.tripwires()).toEqual([CANARY, path.resolve(out)]);
  });

  it("holds no case text, criterion or canary in the clear", async () => {
    const { plain, out } = await sealed();
    const text = fs.readFileSync(out, "utf8");
    expect(text).not.toContain(CANARY);
    for (const item of (await plain.describe()).cases) {
      const hidden = await plain.hidden(item.id);
      for (const criterion of hidden.criteria) expect(text).not.toContain(criterion);
      expect(text).not.toContain("openActivity");
      expect(text).not.toContain((await plain.request(item.id)).script.split("\n")[4]!);
    }
  });

  it("does not open with another passphrase, or once its header was changed", async () => {
    const { out } = await sealed();
    expect(() => new SealedVault(out, "not the passphrase at all")).toThrow(
      "The passphrase does not open this bench, or the sealed file was changed.",
    );
    const file = JSON.parse(fs.readFileSync(out, "utf8"));
    file.cases[0].weight = 5;
    const changed = path.join(path.dirname(out), "changed.sealed");
    fs.writeFileSync(changed, JSON.stringify(file));
    expect(() => new SealedVault(changed, PASSPHRASE)).toThrow(/does not open this bench/);
  });

  it("unseals one case's hidden checks at a time, and refuses one moved to another case", async () => {
    const { out } = await sealed();
    const file = JSON.parse(fs.readFileSync(out, "utf8"));
    const [first, second] = Object.keys(file.hidden) as [string, string];
    [file.hidden[first], file.hidden[second]] = [file.hidden[second], file.hidden[first]];
    const swapped = path.join(path.dirname(out), "swapped.sealed");
    fs.writeFileSync(swapped, JSON.stringify(file));
    const vault = new SealedVault(swapped, PASSPHRASE);
    await expect(vault.hidden(first)).rejects.toThrow();
    expect(await vault.request(first)).toMatchObject({ refNum: 1 });
  });

  it("takes a passphrase of twelve characters or more", async () => {
    await expect(
      sealCases(new PlainVault(PLACEHOLDER), "short", path.join(tempDir(), "x.sealed")),
    ).rejects.toThrow("Use a passphrase of at least 12 characters.");
  });
});
