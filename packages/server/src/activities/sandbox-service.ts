/**
 * The dev sandbox, assembled.
 *
 * Reports what state a preview is in, builds the module on demand, and serves the draft's
 * media. Everything it decides lives in `sandbox-model`, `sandbox-paths`, `media-origin`
 * and `sandbox-builder`; this is the part that touches the filesystem and the activity
 * record, kept thin on purpose.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type Opaque } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import { planMediaResponse } from "./media-origin.js";
import { previewMediaPath, previewState } from "./sandbox-model.js";
import {
  sandboxMediaRoot,
  sandboxStatus,
  withinRoot,
  type SandboxStatus,
} from "./sandbox-paths.js";

/** Files whose modification times decide whether a built module is current. */
const SOURCE_DIRS = ["module/src", "module/res", "module/generated"];

export interface SandboxMediaResponse {
  status: number;
  headers: Record<string, string>;
  /** Absent for 304 and 416, which carry no body. */
  body?: Opaque<"Uint8Array", Uint8Array>;
}

/** The sandbox as its callers see it. */
export abstract class ActivitySandbox extends Interface<{
  status(projectId: string, activityId: string): Promise<SandboxStatus>;
  media(
    projectId: string,
    activityId: string,
    rawPath: string,
    request: { range?: string | null; ifRange?: string | null; ifNoneMatch?: string | null },
  ): Promise<SandboxMediaResponse>;
}>() {}

@Component({})
export class ActivitySandboxService implements ActivitySandbox {
  @Use() private readonly activities!: ActivityAuthoring;

  /** What the client is told about a preview. Never claims more than it can show. */
  async status(projectId: string, activityId: string): Promise<SandboxStatus> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const canonical = this.activities.isCanonicalRef(activity);
    // No module run means nothing has been built; the run's workspace is where a build
    // would land, and its absence is the honest answer rather than a guess.
    const state = previewState({
      hasSpec: activity.draft.status === "valid" && activity.draft.spec !== null,
      hasModule: false,
      canonicalRef: canonical,
      builtAtMs: null,
      sourceMtimesMs: [],
    });
    return sandboxStatus(state, null);
  }

  /**
   * One media file from the draft, with range handling.
   *
   * The path is checked twice — by shape, then by where it lands — and the file is read
   * only after both pass.
   */
  async media(
    projectId: string,
    activityId: string,
    rawPath: string,
    request: { range?: string | null; ifRange?: string | null; ifNoneMatch?: string | null },
  ): Promise<SandboxMediaResponse> {
    const relative = previewMediaPath(rawPath);
    if (!relative) throw new HttpError(400, "media_path_invalid", "That is not a media path.");
    const activity = await this.activities.getActivity(projectId, activityId);
    const root = sandboxMediaRoot({
      draftWorkspace: this.activities.draftWorkspace(
        projectId,
        activity.collectionId,
        activity.id,
        activity.draft.draftId,
      ),
    });
    const file = withinRoot(root, relative);
    if (!file) throw new HttpError(400, "media_path_invalid", "That is not a media path.");

    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile())
      throw new HttpError(404, "media_not_found", `No media file at ${relative}.`);

    const plan = planMediaResponse(relative, { size: stat.size, mtimeMs: stat.mtimeMs }, request);
    if (plan.status === 304 || plan.status === 416)
      return { status: plan.status, headers: plan.headers };

    const handle = await fs.open(file, "r");
    try {
      const length = plan.range ? plan.range.length : stat.size;
      const buffer = new Uint8Array(length);
      // Read exactly the planned window. Reading the whole file and slicing would put a
      // multi-megabyte video in memory to answer a request for ten kilobytes of it.
      const { bytesRead } = await handle.read(buffer, 0, length, plan.range ? plan.range.start : 0);
      return {
        status: plan.status,
        headers: plan.headers,
        body: bytesRead === length ? buffer : buffer.subarray(0, bytesRead),
      };
    } finally {
      await handle.close();
    }
  }

  /** Modification times of everything a module build reads, for the freshness check. */
  async sourceMtimes(workspace: string): Promise<number[]> {
    const found: number[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          const stat = await fs.stat(full).catch(() => null);
          if (stat) found.push(stat.mtimeMs);
        }
      }
    };
    for (const relative of SOURCE_DIRS) await walk(path.join(workspace, relative));
    return found;
  }
}
