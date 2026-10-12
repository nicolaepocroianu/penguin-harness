/**
 * The draft's field-level three-way merge: what the author holds over the saved draft, set
 * against a newer saved draft, one field at a time. The fields are the script, the
 * specification (whole), each asset's every property in the media plan (a timeline among
 * them), and each timeline the author is editing on its own.
 *
 * For each field: the author's value (local), the saved value their edit began from (base),
 * and the newer saved value (server).
 * - Not edited (local is base): the server's value is taken.
 * - Edited, server still at base: the edit stays, now over the newer draft.
 * - Edited, server equal to the edit: the edit has landed and is an edit no more.
 * - Edited, server moved elsewhere: a conflict; the edit stays and the field is marked.
 *
 * Values are compared whatever their keys' order, since the server writes them in its own.
 */
import type { ActivityDraft, AssetManifest, VideoTimeline } from "@prismshadow/penguin-server/api";

/** One field of the draft: `description`, `spec`, `media`, `manifest#…`, `asset:…`, `timeline:…`. */
export type FieldId = string;

/** What the author holds over the saved draft. */
export interface LocalDraft {
  description: string;
  /** The specification's text, which may not read as JSON while it is typed. */
  spec: string;
  /** The media plan's text, likewise. */
  media: string;
  /** Timelines edited on their own, by `${language}/${assetKey}`. */
  timelines: Readonly<Record<string, VideoTimeline>>;
}

export interface MergeResult {
  local: LocalDraft;
  /** The base of each field the author still holds an edit to. */
  bases: Map<FieldId, unknown>;
  /** The fields edited here and changed differently in the saved draft. */
  conflicts: Set<FieldId>;
}

type Asset = AssetManifest["assets"][string][number];

/** A value no field holds: the field is absent. */
const ABSENT = Symbol("absent");

/** A value in a fixed key order, so equal values print equal. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  return value;
}

/** Whether two values are the same whatever their keys' order. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === ABSENT || right === ABSENT) return false;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export const pretty = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");

/** Text as a value: empty is none; text that does not read as JSON is only ever itself. */
function textValue(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { "#text": text };
  }
}

const assetId = (language: string, key: string) => `${language}/${key}`;

/** A manifest as fields: its own properties, and each asset's presence and properties. */
function manifestFields(manifest: unknown): Map<FieldId, unknown> {
  const fields = new Map<FieldId, unknown>();
  if (!manifest || typeof manifest !== "object") return fields;
  for (const [prop, value] of Object.entries(manifest as Record<string, unknown>)) {
    if (prop !== "assets") fields.set(`manifest#${prop}`, value);
  }
  const assets = (manifest as { assets?: Record<string, unknown> }).assets ?? {};
  for (const [language, group] of Object.entries(assets)) {
    if (!Array.isArray(group)) continue;
    for (const asset of group as Asset[]) {
      if (!asset || typeof asset.key !== "string") continue;
      const id = assetId(language, asset.key);
      fields.set(`asset:${id}`, true);
      for (const [prop, value] of Object.entries(asset)) fields.set(`asset:${id}#${prop}`, value);
    }
  }
  return fields;
}

/** The manifest the merged fields describe, built on the server's own. */
function buildManifest(server: unknown, fields: Map<FieldId, unknown>, local: unknown): unknown {
  const base = (server ?? local ?? {}) as Record<string, unknown>;
  const manifest: Record<string, unknown> = {};
  for (const [prop, value] of Object.entries(base)) if (prop !== "assets") manifest[prop] = value;
  for (const [id, value] of fields) {
    if (!id.startsWith("manifest#")) continue;
    const prop = id.slice("manifest#".length);
    if (value === ABSENT) delete manifest[prop];
    else manifest[prop] = value;
  }
  // Each language keeps the server's order, with assets only the author has after them.
  const groups: Record<string, Asset[]> = {};
  const order = (source: unknown) => {
    const assets = (source as { assets?: Record<string, Asset[]> } | null)?.assets ?? {};
    for (const [language, group] of Object.entries(assets))
      for (const asset of Array.isArray(group) ? group : []) {
        const list = (groups[language] ??= []);
        if (!list.some((entry) => entry.key === asset.key)) list.push({ key: asset.key } as Asset);
      }
  };
  order(server);
  order(local);
  const assets: Record<string, Asset[]> = {};
  for (const [language, group] of Object.entries(groups)) {
    const kept: Asset[] = [];
    for (const { key } of group) {
      const id = assetId(language, key);
      if (fields.get(`asset:${id}`) !== true) continue;
      const asset: Record<string, unknown> = {};
      const prefix = `asset:${id}#`;
      for (const [field, value] of fields)
        if (field.startsWith(prefix) && value !== ABSENT) asset[field.slice(prefix.length)] = value;
      kept.push(asset as unknown as Asset);
    }
    assets[language] = kept;
  }
  manifest.assets = assets;
  return manifest;
}

/** The asset's saved timeline, or none. */
function savedTimeline(draft: ActivityDraft, id: string): unknown {
  const slash = id.indexOf("/");
  const language = id.slice(0, slash);
  const key = id.slice(slash + 1);
  return draft.mediaPlan?.manifest.assets[language]?.find((asset) => asset.key === key)?.timeline;
}

/**
 * Merge what the author holds over `base` (the draft their texts sit on, with `bases` for
 * the fields whose edit began on an older one) with the newer saved draft `server`.
 */
export function mergeDraft(input: {
  base: ActivityDraft;
  bases: ReadonlyMap<FieldId, unknown>;
  local: LocalDraft;
  server: ActivityDraft;
  /** Fields the author's own save just wrote: their base is what the server now holds. */
  landed?: (id: FieldId) => boolean;
}): MergeResult {
  const { base, local, server } = input;
  const bases = new Map<FieldId, unknown>();
  const conflicts = new Set<FieldId>();
  const baseOf = (id: FieldId, fallback: unknown) =>
    input.bases.has(id) ? input.bases.get(id) : fallback;
  /** The merged value of one field, recording what the author still holds. */
  const merge = (id: FieldId, mine: unknown, base: unknown, theirs: unknown): unknown => {
    const was = input.landed?.(id) ? theirs : base;
    if (sameValue(mine, was) || sameValue(mine, theirs)) return theirs;
    bases.set(id, was);
    if (!sameValue(theirs, was)) conflicts.add(id);
    return mine;
  };

  const description = merge(
    "description",
    local.description,
    baseOf("description", base.description),
    server.description,
  ) as string;

  const specMine = textValue(local.spec);
  const specMerged = merge(
    "spec",
    specMine,
    baseOf("spec", base.spec ?? null),
    server.spec ?? null,
  );
  const spec = specMerged === specMine && bases.has("spec") ? local.spec : pretty(server.spec);

  let media: string;
  const mediaMine = textValue(local.media);
  const serverManifest = server.mediaPlan?.manifest ?? null;
  if (mediaMine && typeof mediaMine === "object" && "#text" in mediaMine) {
    // Text that is not JSON yet holds the whole plan: it stays unless the plan moved.
    const was = baseOf("media", base.mediaPlan?.manifest ?? null);
    media =
      merge("media", mediaMine, was, serverManifest) === mediaMine
        ? local.media
        : pretty(serverManifest);
  } else {
    const mine = manifestFields(mediaMine);
    const baseFields = manifestFields(base.mediaPlan?.manifest ?? null);
    const theirs = manifestFields(serverManifest);
    const merged = new Map<FieldId, unknown>();
    let moved = false;
    for (const id of new Set([...mine.keys(), ...baseFields.keys(), ...theirs.keys()])) {
      const was = baseOf(id, baseFields.has(id) ? baseFields.get(id) : ABSENT);
      const server = theirs.has(id) ? theirs.get(id) : ABSENT;
      if (!sameValue(server, was)) moved = true;
      merged.set(id, merge(id, mine.has(id) ? mine.get(id) : ABSENT, was, server));
    }
    // The author's text stays as typed unless the saved plan moved under it; then the plan is
    // the server's, with whatever the author still holds over it.
    if (!moved) media = local.media;
    else if ([...merged.keys()].some((id) => bases.has(id)))
      media = pretty(buildManifest(serverManifest, merged, mediaMine));
    else media = pretty(serverManifest);
  }

  const timelines: Record<string, VideoTimeline> = {};
  for (const [id, edit] of Object.entries(local.timelines)) {
    const field = `timeline:${id}`;
    const value = merge(
      field,
      edit,
      baseOf(field, savedTimeline(base, id)),
      savedTimeline(server, id),
    );
    if (bases.has(field)) timelines[id] = value as VideoTimeline;
  }

  return { local: { description, spec, media, timelines }, bases, conflicts };
}

/** What the conflicted fields are, for the notice that names them. */
export interface ConflictParts {
  script: boolean;
  spec: boolean;
  /** The media plan as a whole, typed as text that is not JSON yet. */
  media: boolean;
  /** The assets, by key, whose properties conflict. */
  assets: string[];
  /** The assets, by key, whose timelines being edited conflict. */
  timelines: string[];
}

export function conflictParts(conflicts: Iterable<FieldId>): ConflictParts {
  const parts: ConflictParts = {
    script: false,
    spec: false,
    media: false,
    assets: [],
    timelines: [],
  };
  const keyOf = (id: string) => id.slice(id.indexOf("/") + 1).split("#")[0]!;
  for (const id of conflicts) {
    if (id === "description") parts.script = true;
    else if (id === "spec") parts.spec = true;
    else if (id === "media" || id.startsWith("manifest#")) parts.media = true;
    else if (id.startsWith("timeline:")) {
      const key = keyOf(id.slice("timeline:".length));
      if (!parts.timelines.includes(key)) parts.timelines.push(key);
    } else if (id.startsWith("asset:")) {
      const key = keyOf(id.slice("asset:".length));
      if (!parts.assets.includes(key)) parts.assets.push(key);
    }
  }
  return parts;
}

/** Whether a save of `part` would carry a conflicted field. */
export function savesConflict(
  part: "description" | "spec" | "media" | { timeline: string },
  conflicts: ReadonlySet<FieldId>,
): boolean {
  if (part === "description" || part === "spec") return conflicts.has(part);
  if (part === "media")
    return [...conflicts].some(
      (id) => id === "media" || id.startsWith("manifest#") || id.startsWith("asset:"),
    );
  return conflicts.has(`timeline:${part.timeline}`);
}

/** One thing in conflict, as the author resolves it: its fields go together. */
export interface ConflictGroup {
  kind: "script" | "spec" | "media" | "asset" | "timeline";
  /** The asset, for an asset's properties or its timeline. */
  key?: string;
  /** The timeline's language. */
  language?: string;
  fields: FieldId[];
}

/** The conflicts, one entry per thing the author resolves at once. */
export function conflictGroups(conflicts: Iterable<FieldId>): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>();
  const add = (id: string, group: Omit<ConflictGroup, "fields">, field: FieldId) => {
    const found = groups.get(id) ?? { ...group, fields: [] };
    found.fields.push(field);
    groups.set(id, found);
  };
  for (const field of conflicts) {
    if (field === "description") add("script", { kind: "script" }, field);
    else if (field === "spec") add("spec", { kind: "spec" }, field);
    else if (field === "media" || field.startsWith("manifest#"))
      add("media", { kind: "media" }, field);
    else if (field.startsWith("timeline:")) {
      const id = field.slice("timeline:".length);
      const slash = id.indexOf("/");
      add(
        field,
        { kind: "timeline", language: id.slice(0, slash), key: id.slice(slash + 1) },
        field,
      );
    } else if (field.startsWith("asset:")) {
      const id = field.slice("asset:".length).split("#")[0]!;
      add(`asset:${id}`, { kind: "asset", key: id.slice(id.indexOf("/") + 1) }, field);
    }
  }
  return [...groups.values()];
}

/** What the saved draft holds for one field, as a merge's base. */
export function savedValue(draft: ActivityDraft, field: FieldId): unknown {
  if (field === "description") return draft.description;
  if (field === "spec") return draft.spec ?? null;
  const manifest = draft.mediaPlan?.manifest ?? null;
  if (field === "media") return manifest;
  if (field.startsWith("timeline:")) return savedTimeline(draft, field.slice("timeline:".length));
  const fields = manifestFields(manifest);
  return fields.has(field) ? fields.get(field) : ABSENT;
}

/** The media plan's text with `fields` set back to what the saved draft holds. */
export function mediaWithSaved(
  text: string,
  draft: ActivityDraft,
  fields: readonly FieldId[],
): string {
  const server = draft.mediaPlan?.manifest ?? null;
  const local = textValue(text);
  if (fields.includes("media") || !local || typeof local !== "object" || "#text" in local)
    return pretty(server);
  const merged = manifestFields(local);
  const theirs = manifestFields(server);
  for (const field of fields) {
    // An asset's presence takes its properties with it.
    const related = [...new Set([...merged.keys(), ...theirs.keys()])].filter(
      (id) => id === field || id.startsWith(`${field}#`),
    );
    for (const id of related) merged.set(id, theirs.has(id) ? theirs.get(id) : ABSENT);
  }
  return pretty(buildManifest(local, merged, server));
}
