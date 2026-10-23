/**
 * A ref's `asset_manifest.json` as Loom and WAF Harness share it.
 *
 * Loom's manifest holds more than WAF Harness's media plan can: asset roles a book reader uses
 * (`bookIntro`, `bookPageTurn`, `bookVocabulary`, `bookSoundOut`, ...), and fields on an asset
 * WAF Harness has no use for (`imageLabels`, `vocabulary`, `boldWords`, `segmentTimings`,
 * `pageText`, `manifestOwned`, an image's `customized`, ...). WAF Harness never sees them and
 * never loses them:
 *
 * - `wafHarnessManifest` is what WAF Harness reads: the assets it holds (wafHarnessHolds), with only the
 *   fields it knows (MEDIA_ASSET_FIELDS), in the languages it supports.
 * - `mergeLoomManifest` is what WAF Harness writes: its manifest, with every field it does not
 *   know put back on the asset it came from, and every asset it cannot hold put back where it
 *   was. What WAF Harness left out of an asset or a group it can hold, it removed.
 *
 * The two are inverses: reading back what was written gives WAF Harness its own manifest again,
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
 * Whether `field` is WAF Harness's to write on an asset. Loom marks any asset an author changed
 * as `customized`; WAF Harness's `customized` is a word pronunciation's alone. Loom gives a word
 * pronunciation the `sourceKey` of the narration it came from, which every word of that
 * narration shares; WAF Harness's words say where they are in `usages` and have none. A role only
 * Loom's book reader knows (`bookIntro`, ...) is Loom's.
 */
function wafhsField(field: string, asset: Json): boolean {
  if (!MEDIA_ASSET_FIELDS.has(field)) return false;
  const word = asset["role"] === BOOK_WORD_ROLE;
  if (field === "customized") return word;
  if (field === "role") return asset["role"] === undefined || word;
  return field !== "sourceKey" || !word;
}

/** The asset with only the fields WAF Harness knows. */
function wafHarnessFields(asset: Json): Json {
  return Object.fromEntries(Object.entries(asset).filter(([field]) => wafhsField(field, asset)));
}

/**
 * Whether the asset is one WAF Harness holds: one with the scenes it is used in, which every asset
 * WAF Harness plans or carries records and none of Loom's own has. An asset of Loom's stays Loom's
 * until WAF Harness carries it.
 */
function wafHarnessHolds(asset: Json): boolean {
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

/** What WAF Harness reads of a manifest on disk (see the file comment). */
export function wafHarnessManifest(onDisk: unknown, fallback?: ActivityAddress): AssetManifest {
  const manifest = isRecord(onDisk) ? onDisk : null;
  const address = addressOf(manifest, fallback);
  const assets: AssetManifest["assets"] = {};
  for (const [language, list] of Object.entries(groupsOf(manifest))) {
    if (!findLanguage(language)) continue;
    const keys = new Set<unknown>();
    assets[language] = list
      .filter((asset) => {
        // A key Loom listed twice is WAF Harness's once; the first is the one it reads.
        if (keys.has(asset["key"]) || !wafHarnessHolds(asset)) return false;
        keys.add(asset["key"]);
        return true;
      })
      .map(
        (asset) => wafHarnessFields(asset) as unknown as AssetManifest["assets"][string][number],
      );
  }
  return { ...address, assets };
}

/**
 * WAF Harness's asset with what Loom keeps beside it after it: WAF Harness's fields first, in its own
 * order, so what it reads back is what it wrote, field for field.
 */
function mergeAsset(wafh: Json, loom: Json): Json {
  const merged: Json = { ...wafh };
  // Whose a field is follows the role the written asset ends up with: Loom's, unless WAF Harness's.
  const written = { ...loom, ...wafh, role: wafh["role"] ?? loom["role"] };
  for (const [field, value] of Object.entries(loom))
    if (!wafhsField(field, written) && !(field in merged)) merged[field] = value;
  return merged;
}

/** Where `asset` of WAF Harness's is in `loom`: by key, or for a word, by the word. -1 for nowhere. */
function findLoom(asset: Json, loom: readonly Json[], taken: (index: number) => boolean): number {
  const byKey = loom.findIndex((candidate) => candidate["key"] === asset["key"]);
  if (byKey >= 0) return taken(byKey) ? -1 : byKey;
  // WAF Harness keys a word pronunciation by its word; an older Loom one may be keyed otherwise.
  if (asset["role"] !== BOOK_WORD_ROLE) return -1;
  return loom.findIndex(
    (candidate, at) =>
      !taken(at) &&
      candidate["role"] === BOOK_WORD_ROLE &&
      candidate["normalizedWord"] === asset["normalizedWord"],
  );
}

/**
 * One language's assets: WAF Harness's, each with Loom's fields from the file (or, for one the file
 * has lost, from `before`, Loom's copy taken at adoption), and the assets WAF Harness does not hold
 * back after the asset they followed in the file. A key the file lists twice is the first one's.
 */
function mergeGroup(
  wafh: readonly Json[],
  loom: readonly Json[],
  before: readonly Json[] = [],
): Json[] {
  const matched = new Map<number, Json>();
  const merged = wafh.map((asset) => {
    const index = findLoom(asset, loom, (at) => matched.has(at));
    if (index < 0) {
      const earlier = before[findLoom(asset, before, () => false)];
      return earlier ? mergeAsset(asset, earlier) : asset;
    }
    const result = mergeAsset(asset, loom[index]!);
    matched.set(index, result);
    return result;
  });
  const mine = new Set(wafh.map((asset) => asset["key"]));
  const seen = new Set<unknown>();
  loom.forEach((asset, index) => {
    const first = !seen.has(asset["key"]);
    seen.add(asset["key"]);
    if (matched.has(index) || !first || mine.has(asset["key"]) || wafHarnessHolds(asset)) return;
    let after = -1;
    for (let at = index - 1; at >= 0 && after < 0; at--)
      if (matched.has(at)) after = merged.indexOf(matched.get(at)!);
    merged.splice(after + 1, 0, asset);
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
 * What WAF Harness writes over the manifest on disk (see the file comment). `wafh` null is a
 * draft with no media plan: only what WAF Harness does not hold stays. `original` is Loom's
 * manifest as it was when the ref was adopted (`asset_manifest.loom.json`), if there is one. It
 * only fills in Loom's fields on an asset WAF Harness holds that the file has lost: one an earlier
 * write of the same adoption left out before Loom's bindings were carried back onto the plan.
 * It never puts back an asset the file no longer has.
 */
export function mergeLoomManifest(
  onDisk: unknown,
  wafh: AssetManifest | null,
  address: ActivityAddress,
  original?: unknown,
): Json {
  const loom = isRecord(onDisk) ? onDisk : null;
  const loomGroups = readdressedGroups(loom, address);
  const before = readdressedGroups(isRecord(original) ? original : null, address);
  const mine = (wafh?.assets ?? {}) as unknown as Record<string, Json[]>;
  const assets: Record<string, Json[]> = {};
  for (const [language, list] of Object.entries(loomGroups)) {
    if (mine[language]) assets[language] = mergeGroup(mine[language], list, before[language]);
    // A language WAF Harness does not support stays as Loom had it; one it does, WAF Harness removed.
    else if (!findLanguage(language)) assets[language] = list;
    else {
      const kept = mergeGroup([], list);
      if (kept.length) assets[language] = kept;
    }
  }
  for (const [language, list] of Object.entries(mine))
    if (!assets[language]) assets[language] = mergeGroup(list, [], before[language]);
  if (!Object.keys(assets).length) assets[DEFAULT_LANGUAGE_CODE] = [];
  const merged: Json = {};
  for (const [field, value] of Object.entries(loom ?? {}))
    if (field !== "productCode" && field !== "refNum" && field !== "assets") merged[field] = value;
  return { productCode: address.productCode, refNum: address.refNum, ...merged, assets };
}
