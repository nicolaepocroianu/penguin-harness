import { createHash, randomUUID } from "node:crypto";
import type { MediaPlan } from "./media.js";
import type { AudioTarget } from "./audio.js";
import type { ImageTarget } from "./generated-image.js";
import type { MediaTextTarget } from "./media-text.js";
import type { CompositionTarget, SceneCritiqueTarget } from "./composition-types.js";
import type { VideoTarget } from "./video-types.js";
import type { TimelineEditTarget } from "./video-timeline-types.js";
import type { PhonemesTarget } from "./book-word-types.js";
import type { AssistFocus } from "./assist.js";
import type { AcceptanceRunRecord } from "./acceptance-types.js";

export const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;

export interface ActivityAddress {
  productCode: string;
  refNum: number;
}

export interface CollectionManifest {
  schemaVersion: 1;
  collectionId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A product owns the module code; its refs are variations that share it.
 *
 * Loom expresses this as a directory holding many refs, one of them canonical and the
 * only one allowed to change the shared module. Three generation stages are gated on that
 * rule, so the canonical ref has to be answerable, which a flat (productCode, refNum) row
 * could not do.
 */
export interface ActivityProduct {
  productId: string;
  projectId: string;
  collectionId: string;
  productCode: string;
  /** Defaults to `waf-module-<productCode>`; one folder may host several products. */
  moduleFolder: string;
  /** The ref that owns the module code; null only before the product has any ref. */
  canonicalRefNum: number | null;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord extends ActivityAddress {
  id: string;
  collectionId: string;
  /** The product this ref belongs to; null only for rows predating the product level. */
  productId: string | null;
  title: string;
  /** What an author calls this ref. The product code and number stay the address. */
  displayName: string | null;
  /** A stable ref is one others may build against, so renumbering it is refused. */
  stable: boolean;
  activityType: "standard" | "book";
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  /** The product's tags, shared by every ref of it; empty for a ref with no product. */
  tags: string[];
}

/** The module folder a product uses unless one was chosen for it. */
export function defaultModuleFolder(productCode: string): string {
  return `waf-module-${productCode}`;
}

export const MODULE_FOLDER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;

export function normalizeModuleFolder(value: unknown, productCode: string): string {
  const folder = String(value ?? "").trim();
  if (!folder) return defaultModuleFolder(productCode);
  if (!MODULE_FOLDER_PATTERN.test(folder)) {
    throw new Error(
      "moduleFolder must be a safe path segment containing only letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return folder;
}

export interface ActivityDraft {
  draftId: string;
  activityId: string;
  baseVersionId: string | null;
  contentRevision: string;
  status: "draft" | "valid" | "invalid";
  description: string;
  spec: Record<string, unknown> | null;
  mediaPlan?: MediaPlan;
  /**
   * The module's configuration and assessment as an author edited them. Each replaces the
   * generated document in the preview and in every assembly until it is discarded. Absent on
   * drafts nobody edited, which keeps their revision what it was.
   */
  moduleDocuments?: ModuleDocumentOverrides;
  /**
   * The module build the preview plays instead of the newest one ("Play this build"), a
   * succeeded module run of this activity. Absent unless an author pinned one. It only
   * chooses what the preview plays, so it is not part of the draft's revision: a pin never
   * makes a candidate, a stage or a deploy out of date.
   */
  pinnedModuleRunId?: string;
  updatedAt: string;
}

/** A module document an author edited, kept in the draft until it is discarded. */
export interface ModuleDocumentOverride {
  value: Record<string, unknown>;
  /**
   * Revision of what the document derives from when it was edited: the media plan's manifest
   * (configuration) or the specification (assessment); null when there was none.
   */
  basis: string | null;
  editedAt: string;
  /**
   * A configuration's edit is written to the module's own file, which Loom reads: what that
   * file held before the first edit, as text (null when there was none), put back as it was
   * when the edit is discarded.
   */
  replaced?: string | null;
  /**
   * A state machine's edit writes several module files, as Loom's save does (the product's
   * machine, the ref's copy it removes, the configuration it syncs): what each held before the
   * first edit, by its path inside the module, null for none, put back as it was on a discard.
   */
  replacedFiles?: Record<string, string | null>;
  /**
   * The key paths (each a JSON array of keys) the author removed from the machine they edited,
   * which an assembly may not put back.
   */
  removed?: string[];
}

/**
 * `stateMachine` is the product's `spec/state-machine.json`, which every ref shares, as Loom
 * keeps it; the runtime boots from it once it is synced into a ref's configuration.
 */
export type ModuleDocumentKind = "configuration" | "assessment" | "definition" | "stateMachine";

export type ModuleDocumentOverrides = Partial<Record<ModuleDocumentKind, ModuleDocumentOverride>>;

export function normalizeProductCode(value: unknown): string {
  const productCode = String(value ?? "").trim();
  if (!PRODUCT_CODE_PATTERN.test(productCode)) {
    throw new Error(
      "productCode must be a safe path segment containing only letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return productCode;
}

export function normalizeRefNum(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("refNum must be a non-negative integer.");
  }
  return value;
}

/** How long a ref's display name may be. Long enough for a phrase, short enough for a list. */
export const DISPLAY_NAME_MAX = 64;

/**
 * What an author calls a ref, or null when they call it nothing.
 *
 * The product code and ref number stay the address; this is only a label, so an empty one
 * is absence rather than an error — a ref with no name shows its address.
 */
export function normalizeDisplayName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const name = String(value).trim();
  if (!name) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name))
    throw new Error("displayName must not contain control characters.");
  if (name.length > DISPLAY_NAME_MAX)
    throw new Error(`displayName must be ${DISPLAY_NAME_MAX} characters or fewer.`);
  return name;
}

export function newCollectionManifest(): CollectionManifest {
  const now = new Date().toISOString();
  return { schemaVersion: 1, collectionId: randomUUID(), createdAt: now, updatedAt: now };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function contentRevision(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/** A value with every object's keys in sorted order, so equal content serializes to equal JSON. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export type ActivityDetail = ActivityRecord & { draft: ActivityDraft };

/**
 * Preserve pre-media draft hashes until a plan is explicitly saved. The pinned module build
 * is left out: it only chooses what the preview plays.
 */
export function draftRevision(
  draft: Pick<ActivityDraft, "description" | "spec" | "mediaPlan" | "moduleDocuments">,
): string {
  return contentRevision({
    description: draft.description,
    spec: draft.spec,
    ...(draft.mediaPlan ? { mediaPlan: draft.mediaPlan } : {}),
    ...(draft.moduleDocuments ? { moduleDocuments: draft.moduleDocuments } : {}),
  });
}
export type ActivityRunStatus =
  "running" | "succeeded" | "failed" | "conflict" | "cancelled" | "interrupted";
/** What every run records, whatever its kind. */
export interface ActivityRunBase {
  runId: string;
  activityId: string;
  projectId: string;
  draftId: string;
  inputRevision: string;
  /** The WAF Harness agent whose Session ran it (the Session's owner when a coding agent did the work). */
  agentId: string;
  /**
   * The external coding agent (an ACP runtime such as Codex or OpenCode) that ran this as
   * the model of an ordinary Session; `sessionId` is that Session's. Absent on runs a
   * WAF Harness agent's own model made, and on older records.
   */
  codingAgentId?: string;
  sessionId: string | null;
  status: ActivityRunStatus;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  candidate: string | null;
}

/** What one kind of run records besides what every run does, by field. */
export interface ActivityRunFields {
  /** A module run's explicit reading mode, for a book; absent on other books' older records. */
  bookMode: "readAlong" | "decodable";
  /**
   * A specification or media pass whose agent finished but wrote a specification that failed
   * its checks: what Loom's retry runs again, told why. Absent on any other failure.
   */
  repairable: true;
  /**
   * A module run that succeeded without checking the module in the player: the test browser
   * is not installed (`noBrowser`), or the agent never ran the check it was given (`notRun`).
   * Absent when the check ran, and on older records.
   */
  unchecked: "noBrowser" | "notRun";
  /**
   * A module run's player check, as the server staged it: the SHA-256 of each file its checks
   * rest on (the harness, the runner, the input and the package.json), and `untrusted` when the
   * run left any of them changed, which leaves its results nothing to vouch for them. Absent
   * when no player check was staged, and on older records.
   */
  playerCheck: { staged: Record<string, string>; untrusted?: true };
  /**
   * A module run that repairs a tested build: the build, the test run, and the SHA-256 of the
   * test file it was handed, which the tests run again must still be. Absent on assemblies.
   */
  repair: { fromRunId: string; testRunId: string; testSha256: string };
  /** A composition run's scene, canvas and staged images, and the check it failed, if any. */
  composition: CompositionTarget;
  /** A video run's asset, the composition it recorded, and its canvas and length. */
  video: VideoTarget;
  /** A timeline run's video, and what the agent's timeline must keep to. */
  timelineEdit: TimelineEditTarget;
  /** A critique run's video, and the recording and composition it critiqued. */
  critique: SceneCritiqueTarget;
  /** A test run's criteria and specification revision, recorded when it started. */
  test: AcceptanceRunRecord;
  /** What the author had open when they started an assist run; null for the whole activity. */
  assist: { focus: AssistFocus | null };
  /** A speech or sound run's asset and what it asked the provider for. */
  audio: AudioTarget;
  image: ImageTarget;
  mediaText: MediaTextTarget;
  /** A phonemes run's language and words. */
  phonemes: PhonemesTarget;
}

/**
 * What every run carries: what every run records, and every kind's own fields as optional, so
 * a run of unknown kind can be asked for any of them. Each kind below requires the fields it
 * always records.
 */
export interface ActivityRunCommon extends ActivityRunBase, Partial<ActivityRunFields> {}

export interface SpecRun extends ActivityRunCommon {
  kind: "spec";
}
/** The media pass: the specification's media listed from its scenes' tags. */
export interface MediaSpecRun extends ActivityRunCommon {
  kind: "media-spec";
}
export interface ModuleRun extends ActivityRunCommon {
  kind: "module";
}
/** Speech or a sound for one asset; the server runs the provider's helper, not an agent. */
export interface AudioRun extends ActivityRunCommon {
  kind: "audio";
  audio: AudioTarget;
}
/**
 * An image for one asset; the server runs the image helper, not an agent. An older record
 * carries the id of the Media Agent Session that drew it.
 */
export interface ImageRun extends ActivityRunCommon {
  kind: "image";
  image: ImageTarget;
}
export interface MediaTextRun extends ActivityRunCommon {
  kind: "media-text";
  mediaText: MediaTextTarget;
}
export interface AssistRun extends ActivityRunCommon {
  kind: "assist";
  assist: { focus: AssistFocus | null };
}
export interface AssessmentRun extends ActivityRunCommon {
  kind: "assessment";
}
/** Sounds proposed for a decodable book's words espeak-ng could not sound out. */
export interface PhonemesRun extends ActivityRunCommon {
  kind: "phonemes";
  phonemes: PhonemesTarget;
}
/** Quality checks of the played activity; no Session (see quality-check.ts). */
export interface QualityRun extends ActivityRunCommon {
  kind: "quality";
}
/**
 * Acceptance tests run against the played activity (see acceptance-service.ts): a Session,
 * with its criteria recorded, when there are criteria to test and no earlier tests of them; the
 * server's own work, with no agent, when it runs those earlier tests again; none when there are
 * no criteria.
 */
export interface TestRun extends ActivityRunCommon {
  kind: "test";
}
/**
 * An agent-written animated composition of one scene, for a video or animation asset
 * (experimental; see composition.ts).
 */
export interface CompositionRun extends ActivityRunCommon {
  kind: "composition";
  composition: CompositionTarget;
}
/**
 * A composition recorded to a video in the test browser, for a video or animation asset
 * (experimental; no Session, see video-render-service.ts).
 */
export interface VideoRun extends ActivityRunCommon {
  kind: "video";
}
/** An agent refining a video's timeline (experimental; see timeline-edit.ts). */
export interface TimelineRun extends ActivityRunCommon {
  kind: "timeline";
  timelineEdit: TimelineEditTarget;
}
/** An agent critiquing a recorded scene video (experimental; see scene-critique.ts). */
export interface CritiqueRun extends ActivityRunCommon {
  kind: "critique";
  critique: SceneCritiqueTarget;
}

/** A run of any kind, told apart by `kind`. */
export type ActivityRun =
  | SpecRun
  | MediaSpecRun
  | ModuleRun
  | AudioRun
  | ImageRun
  | MediaTextRun
  | AssistRun
  | AssessmentRun
  | PhonemesRun
  | QualityRun
  | TestRun
  | CompositionRun
  | VideoRun
  | TimelineRun
  | CritiqueRun;

export type ActivityRunKind = ActivityRun["kind"];

/** The run of one kind. */
export type ActivityRunOf<Kind extends ActivityRunKind> = Extract<ActivityRun, { kind: Kind }>;

/**
 * The kinds of run the server may record itself, with no Session or agent (a test run only when
 * there is nothing to test). With the kinds a start makes (`RUN_KINDS`), every kind a run
 * records: `RECORDED_RUN_KINDS` in run-kinds/index.ts.
 */
export const DETERMINISTIC_RUN_KINDS = [
  "quality",
  "test",
  "video",
] as const satisfies readonly ActivityRunKind[];
export type DeterministicRunKind = (typeof DETERMINISTIC_RUN_KINDS)[number];

/** A run as lists show it: its candidate left out, and whether it has one. */
export type ActivityRunSummary = Omit<ActivityRunCommon, "candidate"> & {
  kind: ActivityRunKind;
  hasCandidate: boolean;
};

/** Scene keys an agent writes for media, and where Loom's layout keeps them. */
const MISPLACED_SCENE_MEDIA = [
  ["tracks", "audio.tracks"],
  ["images", "media.images"],
  ["video", "media.video"],
  ["videos", "media.video"],
  ["animations", "media.animations"],
] as const;

export function validateActivitySpec(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Activity specification must be a JSON object.");
  }
  const spec = value as Record<string, unknown>;
  for (const key of ["id", "title", "activityDescription"]) {
    if (typeof spec[key] !== "string") {
      throw new Error(`Activity specification requires ${key}.`);
    }
  }
  if (!PRODUCT_CODE_PATTERN.test(spec.id as string) || !(spec.title as string).length)
    throw new Error("Activity specification requires a safe id and a non-empty title.");
  if (
    spec.moduleFolder !== undefined &&
    (typeof spec.moduleFolder !== "string" ||
      !/^waf-module-[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(spec.moduleFolder))
  )
    throw new Error("Invalid moduleFolder.");
  if (spec.runtime === null || typeof spec.runtime !== "object" || Array.isArray(spec.runtime)) {
    throw new Error("Activity specification requires a runtime object.");
  }
  const runtime = spec.runtime as Record<string, unknown>;
  if (
    runtime.engine !== "html" ||
    typeof runtime.usesAssessment !== "boolean" ||
    ["layout", "theme", "resolution"].some((key) => typeof runtime[key] !== "string")
  )
    throw new Error("runtime requires engine html, layout, theme, resolution and usesAssessment.");
  const scenes = spec.scenes ?? spec.stages;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("Activity specification requires at least one scene.");
  }
  // Mirrors Loom's activity_spec.schema.json, including the retained stages alias.
  for (const key of ["scenes", "stages"]) {
    if (spec[key] === undefined) continue;
    if (!Array.isArray(spec[key]) || spec[key].length === 0)
      throw new Error(`${key} must be a non-empty array.`);
    for (const value of spec[key]) {
      const scene = object(value, key);
      strings(scene, ["id", "description"], key);
      // Media written straight on a scene is read by nothing: the plan would come out empty.
      for (const [misplaced, home] of MISPLACED_SCENE_MEDIA)
        if (scene[misplaced] !== undefined)
          throw new Error(`Scene ${String(scene.id)}: put ${misplaced} under ${home}.`);
      if (scene.media !== undefined) {
        const media = object(scene.media, "media");
        for (const kind of ["images", "video", "animations"]) assets(media[kind], false);
      }
      if (scene.audio !== undefined) assets(object(scene.audio, "audio").tracks, true);
    }
  }
  if (
    spec.acceptance_criterias !== undefined &&
    (!Array.isArray(spec.acceptance_criterias) ||
      spec.acceptance_criterias.some((v) => typeof v !== "string"))
  )
    throw new Error("acceptance_criterias must contain strings.");
  if (spec.audience != null) {
    const audience = object(spec.audience, "audience");
    if (audience.gradeBand != null && typeof audience.gradeBand !== "string")
      throw new Error("audience.gradeBand must be a string or null.");
  }
  return spec;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function strings(value: Record<string, unknown>, keys: string[], name: string) {
  if (keys.some((key) => typeof value[key] !== "string"))
    throw new Error(`${name} requires ${keys.join(", ")} strings.`);
}
function assets(value: unknown, audio: boolean) {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error("Assets must be an array.");
  for (const item of value) {
    const asset = object(item, "Asset");
    strings(asset, ["key", "description"], "Asset");
    // Null means "not produced yet", the same as absent. Loom writes null for every asset
    // a generation stage has not filled in, which is most of them for most of a project's
    // life; refusing it would refuse the ordinary state of an unfinished activity.
    for (const key of audio ? ["targetPath", "script"] : ["targetPath"])
      if (asset[key] != null) {
        if (typeof asset[key] !== "string") throw new Error(`${key} must be a string.`);
      }
    if (audio && asset.interruptible !== undefined && typeof asset.interruptible !== "boolean")
      throw new Error("interruptible must be a boolean.");
  }
}
