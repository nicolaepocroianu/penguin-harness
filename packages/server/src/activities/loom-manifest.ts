/**
 * A ref's `asset_manifest.json` as Loom and Penguin share it.
 *
 * Loom's manifest holds more than Penguin's media plan can: asset roles a book reader uses
 * (`bookIntro`, `bookPageTurn`, `bookVocabulary`, `bookSoundOut`, ...), and fields on an asset
 * Penguin has no use for (`imageLabels`, `vocabulary`, `boldWords`, `segmentTimings`,
 * `pageText`, `manifestOwned`, an image's `customized`, ...). Penguin never sees them and
 * never loses them:
 *
 * - `penguinManifest` is what Penguin reads: the assets it holds (penguinHolds), with only the
 *   fields it knows (MEDIA_ASSET_FIELDS), in the languages it supports.
 * - `mergeLoomManifest` is what Penguin writes: its manifest, with every field it does not
 *   know put back on the asset it came from, and every asset it cannot hold put back where it
 *   was. What Penguin left out of an asset or a group it can hold, it removed.
 *
 * The two are inverses: reading back what was written gives Penguin its own manifest again,
 * so a draft's revision survives the round trip.
 */
import { BOOK_WORD_ROLE } from "./book-words.js";
import type { ActivityAddress } from "./domain.js";
import { DEFAULT_LANGUAGE_CODE, findLanguage } from "./languages.js";
import { MEDIA_ASSET_FIELDS, type AssetManifest } from "./media.js";
import { refMediaFolder } from "./waf-layout.js";

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The manifest's groups by language; Loom's older flat list is the default language's. */
function groupsOf(manifest: Json | null | undefined): Record<string, Json[]> {
  const assets = manifest?.["assets"];
  const raw: Record<string, unknown> = Array.isArray(assets)
    ? { [DEFAULT_LANGUAGE_CODE]: assets }
    : isRecord(assets)
      ? assets
      : {};
  const groups: Record<string, Json[]> = {};
  for (const [language, list] of Object.entries(raw))
    if (Array.isArray(list)) groups[language] = list.filter(isRecord);
  return groups;
}

/**
 * Whether `field` is Penguin's to write on an asset. Loom marks any asset an author changed
 * as `customized`; Penguin's `customized` is a word pronunciation's alone. Loom gives a word
 * pronunciation the `sourceKey` of the narration it came from, which every word of that
 * narration shares; Penguin's words say where they are in `usages` and have none.
 */
function penguinsField(field: string, asset: Json): boolean {
  if (!MEDIA_ASSET_FIELDS.has(field)) return false;
  const word = asset["role"] === BOOK_WORD_ROLE;
  if (field === "customized") return word;
  return field !== "sourceKey" || !word;
}

/** The asset with only the fields Penguin knows. */
function penguinFields(asset: Json): Json {
  return Object.fromEntries(Object.entries(asset).filter(([field]) => penguinsField(field, asset)));
}

/**
 * Whether the asset is one Penguin holds: a role it knows (a word pronunciation, or none), and
 * the scenes it is used in, which every asset Penguin plans or carries records. An asset of
 * Loom's without them stays Loom's until Penguin carries it.
 */
function penguinHolds(asset: Json): boolean {
  if (asset["role"] !== undefined && asset["role"] !== BOOK_WORD_ROLE) return false;
  return Array.isArray(asset["usages"]);
}

/** The address a manifest names, or `fallback` where it names none. */
function addressOf(manifest: Json | null | undefined, fallback?: ActivityAddress) {
  const productCode = manifest?.["productCode"];
  const refNum = manifest?.["refNum"];
  return {
    productCode: typeof productCode === "string" ? productCode : (fallback?.productCode ?? ""),
    refNum: Number.isSafeInteger(refNum) ? (refNum as number) : (fallback?.refNum ?? 0),
  };
}

/** What Penguin reads of a manifest on disk (see the file comment). */
export function penguinManifest(onDisk: unknown, fallback?: ActivityAddress): AssetManifest {
  const manifest = isRecord(onDisk) ? onDisk : null;
  const address = addressOf(manifest, fallback);
  const assets: AssetManifest["assets"] = {};
  for (const [language, list] of Object.entries(groupsOf(manifest))) {
    if (!findLanguage(language)) continue;
    const keys = new Set<unknown>();
    assets[language] = list
      .filter((asset) => {
        // A key Loom listed twice is Penguin's once; the first is the one it reads.
        if (keys.has(asset["key"]) || !penguinHolds(asset)) return false;
        keys.add(asset["key"]);
        return true;
      })
      .map((asset) => penguinFields(asset) as unknown as AssetManifest["assets"][string][number]);
  }
  return { ...address, assets };
}

/**
 * Penguin's asset with what Loom keeps beside it after it: Penguin's fields first, in its own
 * order, so what it reads back is what it wrote, field for field.
 */
function mergeAsset(penguin: Json, loom: Json): Json {
  const merged: Json = { ...penguin };
  for (const [field, value] of Object.entries(loom))
    if (!penguinsField(field, penguin) && !(field in merged)) merged[field] = value;
  return merged;
}

/** One language's assets: Penguin's, merged, with the assets it cannot hold back in place. */
function mergeGroup(penguin: readonly Json[], loom: readonly Json[]): Json[] {
  const byKey = new Map(loom.map((asset, index) => [asset["key"], index]));
  const matched = new Map<number, Json>();
  const merged = penguin.map((asset) => {
    let index = byKey.get(asset["key"]);
    // Penguin keys a word pronunciation by its word; an older Loom one may be keyed otherwise.
    if (index === undefined && asset["role"] === BOOK_WORD_ROLE)
      index = loom.findIndex(
        (candidate, at) =>
          !matched.has(at) &&
          candidate["role"] === BOOK_WORD_ROLE &&
          candidate["normalizedWord"] === asset["normalizedWord"],
      );
    if (index === undefined || index < 0 || matched.has(index)) return asset;
    const result = mergeAsset(asset, loom[index]!);
    matched.set(index, result);
    return result;
  });
  // An asset Penguin cannot hold goes back after the asset it followed in the file.
  loom.forEach((asset, index) => {
    if (matched.has(index)) return;
    if (penguin.some((mine) => mine["key"] === asset["key"])) return;
    if (penguinHolds(asset)) return;
    let before = -1;
    for (let at = index - 1; at >= 0 && before < 0; at--)
      if (matched.has(at)) before = merged.indexOf(matched.get(at)!);
    merged.splice(before + 1, 0, asset);
    matched.set(index, asset);
  });
  return merged;
}

/** The manifest's groups, with every path in the media folder it names moved to `to`'s. */
function readdressedGroups(manifest: Json | null, to: ActivityAddress): Record<string, Json[]> {
  const from = addressOf(manifest, to);
  // A ref renumbered or made from another moves its media folder; Loom's assets move with it.
  const fromFolder = from.productCode ? refMediaFolder(from.productCode, from.refNum) : "";
  const toFolder = refMediaFolder(to.productCode, to.refNum);
  const groups = groupsOf(manifest);
  if (!fromFolder || fromFolder === toFolder) return groups;
  const moved = (asset: Json): Json =>
    typeof asset["path"] === "string" && asset["path"].startsWith(`${fromFolder}/`)
      ? { ...asset, path: `${toFolder}${asset["path"].slice(fromFolder.length)}` }
      : asset;
  return Object.fromEntries(
    Object.entries(groups).map(([language, list]) => [language, list.map(moved)]),
  );
}

/**
 * What Penguin writes over the manifest on disk (see the file comment). `penguin` null is a
 * draft with no media plan: only what Penguin cannot hold stays. `original` is Loom's manifest
 * as it was before Penguin first wrote it (`asset_manifest.loom.json`), if there is one: what
 * Penguin cannot hold and the disk has lost, and the Loom fields of an asset Penguin carried
 * back after a write that had not carried it yet, come from there.
 */
export function mergeLoomManifest(
  onDisk: unknown,
  penguin: AssetManifest | null,
  address: ActivityAddress,
  original?: unknown,
): Json {
  const loom = isRecord(onDisk) ? onDisk : null;
  const loomGroups = readdressedGroups(loom, address);
  const before = readdressedGroups(isRecord(original) ? original : null, address);
  for (const [language, list] of Object.entries(before)) {
    const group = (loomGroups[language] ??= []);
    const keys = new Set(group.map((asset) => asset["key"]));
    for (const asset of list) if (!keys.has(asset["key"])) group.push(asset);
  }
  const mine = (penguin?.assets ?? {}) as unknown as Record<string, Json[]>;
  const assets: Record<string, Json[]> = {};
  for (const [language, list] of Object.entries(loomGroups)) {
    if (mine[language]) assets[language] = mergeGroup(mine[language], list);
    // A language Penguin does not support stays as Loom had it; one it does, Penguin removed.
    else if (!findLanguage(language)) assets[language] = list;
    else {
      const kept = mergeGroup([], list);
      if (kept.length) assets[language] = kept;
    }
  }
  for (const [language, list] of Object.entries(mine))
    if (!assets[language]) assets[language] = mergeGroup(list, []);
  if (!Object.keys(assets).length) assets[DEFAULT_LANGUAGE_CODE] = [];
  const merged: Json = {};
  for (const [field, value] of Object.entries(loom ?? {}))
    if (field !== "productCode" && field !== "refNum" && field !== "assets") merged[field] = value;
  return { productCode: address.productCode, refNum: address.refNum, ...merged, assets };
}
