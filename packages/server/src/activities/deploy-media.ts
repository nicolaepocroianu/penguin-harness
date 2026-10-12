/**
 * Making sure every media file a QA deploy's data names is in the media repository.
 *
 * Authored media (accepted takes and uploads) is written straight into the media clone, so a
 * file the data names is either in its working tree, new or changed since the repository last
 * had it (to be published), or already committed. A file outside the partial clone's folders
 * is looked for in git's trees, which a partial clone has without downloading any file. A
 * file found nowhere is missing, and the stage fails naming it.
 *
 * git goes through the stage's clone, so a test answers it with a fake; files are read and
 * written only inside the draft roots and the media clone.
 */
import fs from "node:fs/promises";
import type { Clone } from "./clone.js";
import { mediaRepoPath } from "./waf-layout.js";
import { sidecarPath } from "./ref-media.js";
import { withinRoot } from "./sandbox-paths.js";

export interface MediaSyncPorts {
  /** The media clone. */
  clone: Pick<Clone, "inHead" | "changed">;
  log(text: string): void;
}

export interface MediaSyncInput {
  /** The media clone. */
  dir: string;
  /** Every media file the data names, as a path in the repository (`media/…`). */
  references: readonly string[];
}

export interface MediaSyncResult {
  /** Files new or changed in the clone since the repository last had them: to publish. */
  copied: string[];
  /** Files found nowhere. */
  missing: string[];
  /** Files the repository already had as they are. */
  present: number;
}

export async function syncMedia(
  input: MediaSyncInput,
  ports: MediaSyncPorts,
): Promise<MediaSyncResult> {
  const result: MediaSyncResult = { copied: [], missing: [], present: 0 };
  for (const reference of input.references) {
    // The data names `media/...`; the clone is the media repository, which that folder is.
    const inRepo = mediaRepoPath(reference);
    const target = inRepo ? withinRoot(input.dir, inRepo) : null;
    if (!inRepo || !target) {
      result.missing.push(reference);
      continue;
    }
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat?.isFile()) {
      // Not in the working tree: a file of the repository outside the partial clone's folders
      // is still in its trees, which a partial clone can list without downloading anything.
      if (await ports.clone.inHead(inRepo)) result.present++;
      else result.missing.push(reference);
      continue;
    }
    // New or changed since the repository last had it: authored media to publish.
    if (await ports.clone.changed(inRepo)) result.copied.push(inRepo);
    else result.present++;
    // An accepted file's Loom sidecar (`<key>.json`, what made it) goes with it: the data
    // never names it, so it would otherwise stay behind in the clone.
    const sidecar = sidecarPath(inRepo);
    if (sidecar === inRepo || result.copied.includes(sidecar)) continue;
    const beside = withinRoot(input.dir, sidecar);
    if (!beside || !(await fs.lstat(beside).catch(() => null))?.isFile()) continue;
    if (await ports.clone.changed(sidecar)) result.copied.push(sidecar);
  }
  ports.log(
    `Media: ${result.present} already in the repository, ${result.copied.length} to publish, ${result.missing.length} missing.`,
  );
  return result;
}
