/**
 * The specification passes: the first, which writes the scenes from the script, and the media
 * pass, which lists the media the scenes' tags ask for. Both write `activity-spec.json`, and
 * both are run again, told why, when what they wrote fails its checks.
 */
import path from "node:path";
import { readCandidate } from "../artifact.js";
import {
  validateActivitySpec,
  type ActivityDetail,
  type ActivityRunKind,
  type MediaSpecRun,
  type SpecRun,
} from "../domain.js";
import type { RunRequestOf } from "../run-request.js";
import { atomicJson } from "../service.js";
import {
  expectedPrimarySceneCount,
  mediaContractIssues,
  mediaSpecSceneMismatch,
  normalizeActivitySpec,
  normalizeActivitySpecUpdate,
  normalizeMediaSpec,
  normalizeMediaTags,
  normalizeScenes,
  normalizedSceneIds,
  rawScenes,
  specHasMediaEntries,
} from "../spec-normalization.js";
import {
  CURRENT_SPEC_FILE,
  SPEC_TEMPLATE,
  SPEC_TEMPLATE_FILE,
  activitySpecPrompt,
  mediaSpecPrompt,
  repairPrompt,
} from "../spec-prompts.js";
import { HttpError } from "../../http/errors.js";
import {
  DOCUMENT_RUN_MS,
  hasValidSpec,
  requireCompleted,
  type CollectInput,
  type SessionRunKind,
  type Settlement,
} from "./contract.js";

/** What a specification pass writes. */
export const SPEC_OUTPUT = "activity-spec.json";

/**
 * What a specification pass saves, Loom's way: the agent's JSON normalized onto the
 * canonical scene shape. The first pass must write the scenes the script asks for; the media
 * pass must keep the scenes it was given and list an asset for every tag. Throws, with
 * the reason a repair attempt is told, when it does not.
 */
export function specOfPass(
  kind: ActivityRunKind,
  generated: unknown,
  activity: Pick<ActivityDetail, "draft"> & Partial<Pick<ActivityDetail, "activityType">>,
): Record<string, unknown> {
  if (!generated || typeof generated !== "object" || Array.isArray(generated))
    throw new Error("activity-spec.json must hold one JSON object.");
  const written = generated as Record<string, unknown>;
  const current = activity.draft.spec;
  const description = normalizeMediaTags(activity.draft.description);
  if (kind === "media-spec") {
    const existing = current ?? {};
    const mismatch = mediaSpecSceneMismatch(
      normalizedSceneIds(existing),
      normalizedSceneIds(written),
    );
    if (mismatch) throw new Error(mismatch);
    // Book page media and narration come from the first pass's prose contract, not tags.
    const enriched = normalizeMediaSpec(
      existing,
      activity.activityType === "book" ? existing : written,
    );
    const issues = mediaContractIssues(enriched);
    if (issues.length)
      throw new Error(`The listed media does not match the scene tags: ${issues.join("; ")}.`);
    return enriched;
  }
  const count = normalizeScenes(rawScenes(written)).length;
  const expected = expectedPrimarySceneCount(description);
  if (count === 0 || (expected !== null && count !== expected))
    throw new Error(
      `The specification has ${count} scenes. It must include a non-empty top-level scenes list.` +
        (expected !== null
          ? ` The description defines ${expected} primary scenes, so it must contain exactly that many.`
          : ""),
    );
  return current
    ? normalizeActivitySpecUpdate(current, written, description)
    : normalizeActivitySpec(written, description);
}

/**
 * Keeps what a specification pass wrote as its candidate, then saves it as the draft's
 * specification, compared against the revision the pass started from.
 */
async function collectSpecPass({
  services,
  run,
  workspace,
  observed,
  stopping,
  save,
}: CollectInput<SpecRun | MediaSpecRun>): Promise<Settlement | null> {
  const candidate = await readCandidate(path.join(workspace, SPEC_OUTPUT));
  run.candidate = candidate;
  save(run);
  if (stopping()) return null;
  requireCompleted(observed, "The session ended without a confirmed completed request.");
  const current = await services.activities.getActivity(run.projectId, run.activityId);
  let spec: Record<string, unknown>;
  try {
    spec = validateActivitySpec(specOfPass(run.kind, JSON.parse(candidate), current));
  } catch (error) {
    // What the agent wrote failed its checks: the one failure a repair run can fix.
    run.repairable = true;
    throw error;
  }
  return {
    kept: true,
    // The authoring service serializes this comparison against draft edits.
    apply: async () => {
      await services.activities.applySpec(run.projectId, run.activityId, spec, run.inputRevision);
    },
  };
}

export const specKind: SessionRunKind<RunRequestOf<"spec">, { repair?: string }, SpecRun> = {
  run: "spec",
  runner: "session",
  needsScript: true,
  // A pass writes one specification and runs no program.
  limits: { wallClockMs: DOCUMENT_RUN_MS },
  check: async (_services, request) => ({ repair: request.repair }),
  record: () => ({}),
  // The pass reads the specification it starts from, or, for a first one, the template.
  async stage({ activity, workspace }) {
    if (activity.draft.spec)
      await atomicJson(path.join(workspace, CURRENT_SPEC_FILE), activity.draft.spec);
    else await atomicJson(path.join(workspace, SPEC_TEMPLATE_FILE), SPEC_TEMPLATE);
  },
  prompt({ activity, description, prepared }) {
    const base = activitySpecPrompt(description, !!activity.draft.spec);
    return prepared.repair === undefined ? base : repairPrompt(base, prepared.repair);
  },
  outputs: [SPEC_OUTPUT],
  collect: collectSpecPass,
};

export const mediaSpecKind: SessionRunKind<
  RunRequestOf<"media-spec">,
  { repair?: string },
  MediaSpecRun
> = {
  run: "media-spec",
  runner: "session",
  // The media pass is written from the specification.
  needsScript: false,
  // Like the first pass, it writes one specification and runs no program.
  limits: { wallClockMs: DOCUMENT_RUN_MS },
  async check(_services, request, activity) {
    if (!hasValidSpec(activity))
      throw new HttpError(
        400,
        "media_spec_spec_required",
        "Save a valid specification before listing its media.",
      );
    return { repair: request.repair };
  },
  record: () => ({}),
  async stage({ activity, workspace }) {
    if (activity.draft.spec)
      await atomicJson(path.join(workspace, CURRENT_SPEC_FILE), activity.draft.spec);
  },
  prompt({ activity, prepared }) {
    const expectedSceneIds = normalizedSceneIds(activity.draft.spec);
    const base = mediaSpecPrompt(
      expectedSceneIds,
      specHasMediaEntries(activity.draft.spec),
      activity.activityType === "book",
    );
    return prepared.repair === undefined
      ? base
      : repairPrompt(base, prepared.repair, expectedSceneIds);
  },
  outputs: [SPEC_OUTPUT],
  collect: collectSpecPass,
};
