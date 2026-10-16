/**
 * The Asset Library's model: every asset the media plan asks for, and every file uploaded
 * for the activity, each with what connects it to the other. Kept pure so the filters and
 * the "used by" counts are the same wherever they are read.
 */
import type { AssetManifest, UploadedMedia } from "@prismshadow/penguin-server/api";
import { isUploadPath } from "./media-library";
import { NO_PLACEHOLDERS, bindingOf, type PlaceholderPaths } from "./placeholder-media";

type MediaAsset = AssetManifest["assets"][string][number];

export type LibraryKind = "all" | MediaAsset["type"];
export type LibraryBinding = "any" | "unbound" | "bound";

export interface PlannedEntry {
  key: string;
  type: MediaAsset["type"];
  description: string;
  path: string | null;
  /**
   * Where the bound file came from, or null while nothing is bound. A placeholder is its own
   * source, so a blank clip is never read as a file the checkout supplied.
   */
  source: "generated" | "upload" | "checkout" | "placeholder" | null;
  sceneIds: string[];
}

export interface UploadEntry {
  upload: UploadedMedia;
  /** The planned assets bound to this file, in manifest order. */
  usedBy: string[];
}

export function plannedEntries(
  assets: readonly MediaAsset[],
  placeholders: PlaceholderPaths = NO_PLACEHOLDERS,
): PlannedEntry[] {
  return assets.map((asset) => ({
    key: asset.key,
    type: asset.type,
    description: asset.description,
    path: asset.path ?? null,
    source: !asset.path
      ? null
      : asset.generatedAudio || asset.generatedImage || asset.generatedVideo
        ? "generated"
        : isUploadPath(asset.path)
          ? "upload"
          : bindingOf(placeholders, asset.path) === "placeholder"
            ? "placeholder"
            : "checkout",
    sceneIds: [...new Set(asset.usages.map((usage) => usage.sceneId))],
  }));
}

export function uploadEntries(
  uploads: readonly UploadedMedia[],
  assets: readonly MediaAsset[],
): UploadEntry[] {
  return uploads.map((upload) => ({
    upload,
    usedBy: assets.filter((asset) => asset.path === upload.path).map((asset) => asset.key),
  }));
}

const matches = (query: string, ...fields: string[]) => {
  const wanted = query.trim().toLowerCase();
  return !wanted || fields.some((field) => field.toLowerCase().includes(wanted));
};

export function filterPlanned(
  entries: readonly PlannedEntry[],
  kind: LibraryKind,
  binding: LibraryBinding,
  query: string,
): PlannedEntry[] {
  return entries.filter(
    (entry) =>
      (kind === "all" || entry.type === kind) &&
      (binding === "any" || (binding === "bound") === !!entry.path) &&
      matches(query, entry.key, entry.description, entry.path ?? "", ...entry.sceneIds),
  );
}

export function filterUploads(
  entries: readonly UploadEntry[],
  kind: LibraryKind,
  binding: LibraryBinding,
  query: string,
): UploadEntry[] {
  return entries.filter(
    (entry) =>
      (kind === "all" || entry.upload.kind === kind) &&
      (binding === "any" || (binding === "bound") === entry.usedBy.length > 0) &&
      matches(query, entry.upload.name, entry.upload.path, ...entry.usedBy),
  );
}

/**
 * An asset that still needs a file: nothing bound, or only the placeholder, which plays the
 * same stand-in clip for every asset. The grid puts these first.
 */
export function needsAttention(entry: PlannedEntry): boolean {
  return !entry.path || entry.source === "placeholder";
}

/** How the Library lays out what it lists: pictures in a grid, or rows in a table. */
export type LibraryLayout = "grid" | "table";

export const LIBRARY_LAYOUT_KEY = "penguin.activityLibraryLayout";

/** This viewer's choice; unreadable storage, or none yet, gives the grid. */
export function readLibraryLayout(storage?: Pick<Storage, "getItem">): LibraryLayout {
  try {
    return (storage ?? localStorage).getItem(LIBRARY_LAYOUT_KEY) === "table" ? "table" : "grid";
  } catch {
    return "grid";
  }
}

export function writeLibraryLayout(
  layout: LibraryLayout,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (storage ?? localStorage).setItem(LIBRARY_LAYOUT_KEY, layout);
  } catch {
    // Storage may be unavailable; the choice then lasts as long as the page.
  }
}
