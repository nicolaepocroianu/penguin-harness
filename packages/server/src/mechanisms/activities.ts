import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AudioTarget, AudioResult } from "../activities/audio.js";
import type { ImageRequest } from "../activities/image.js";
import type { ImageTarget, ImageResult } from "../activities/generated-image.js";
import type { MediaTextTarget } from "../activities/media-text.js";
import type { AssistFocus, AssistProposal } from "../activities/assist.js";
import type { UploadedMedia } from "../activities/upload.js";
import type { ImportOutcome } from "../activities/import-apply.js";
import type { ImportedActivity } from "../activities/loom-import.js";
import type { ImportMapping } from "../activities/import-mapping.js";
import type {
  ActivityDraft,
  ActivityProduct,
  ActivityRecord,
  ActivityRun,
  ActivityRunSummary,
  CollectionManifest,
} from "../activities/domain.js";

export abstract class ActivityGeneration extends Interface<{
  shutdown(): Promise<void>;
  start(
    projectId: string,
    activityId: string,
    agentId: string,
    expectedRevision: string,
    module?: {
      wafRoot?: string;
      bookMode?: string;
      audio?: { language: string; assetKey: string; voice: string };
      image?: { language: string; assetKey: string };
      mediaText?: { language: string; assetKey: string };
      /** An assist run: the author's first message and what they had open. */
      assist?: { message: string; focus: AssistFocus | null };
    },
    /** Run on an external coding agent instead of the Penguin agent `agentId` names. */
    runtime?: { codingAgentId?: string },
  ): Promise<ActivityRun>;
  list(projectId: string, activityId: string): Promise<ActivityRunSummary[]>;
  candidate(projectId: string, activityId: string, runId: string): Promise<string | null>;
  /** An assist run's current proposal, read from its workspace. */
  proposal(
    projectId: string,
    activityId: string,
    runId: string,
  ): Promise<{ proposal: AssistProposal | null; error: string | null }>;
  cancel(projectId: string, activityId: string, runId: string): Promise<ActivityRun>;
  acceptAudio(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  audioContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array>;
  imageCandidateContent(projectId: string, activityId: string, runId: string): Promise<Uint8Array>;
  acceptImage(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  acceptMediaText(
    projectId: string,
    activityId: string,
    runId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
}>() {}

export abstract class ActivityAuthoring extends Interface<{
  applyMediaText(
    projectId: string,
    activityId: string,
    target: MediaTextTarget,
    text: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  storeImage(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<ImageResult>;
  readImage(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
  ): Promise<Uint8Array>;
  applyImage(
    projectId: string,
    activityId: string,
    target: ImageTarget,
    result: ImageResult,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  prepareImageMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void>;
  imageContent(
    projectId: string,
    activityId: string,
    input: ImageRequest,
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
  storeAudio(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<AudioResult>;
  readAudio(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
  ): Promise<Uint8Array>;
  applyAudio(
    projectId: string,
    activityId: string,
    target: AudioTarget,
    result: AudioResult,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  prepareAudioMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void>;
  /** Stage author-uploaded media into an assembly workspace, beside the generated media. */
  prepareUploadedMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void>;
  uploadMedia(
    projectId: string,
    activityId: string,
    name: string,
    bytes: Buffer,
  ): Promise<UploadedMedia>;
  listMedia(projectId: string, activityId: string): Promise<UploadedMedia[]>;
  uploadContent(
    projectId: string,
    activityId: string,
    reference: string,
  ): Promise<{ bytes: Buffer; mimeType: string }>;
  planMedia(
    projectId: string,
    activityId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  applyMedia(
    projectId: string,
    activityId: string,
    manifest: unknown,
    expectedRevision: string,
  ): Promise<ActivityDraft>;
  ensureCollection(projectId: string, collectionId?: string): Promise<CollectionManifest>;
  listActivities(projectId: string, collectionId?: string): Promise<ActivityRecord[]>;
  createActivity(
    projectId: string,
    input: {
      collectionId?: string;
      productCode: unknown;
      refNum: unknown;
      title: string;
      activityType?: "standard" | "book";
    },
  ): Promise<ActivityRecord & { draft: ActivityDraft }>;
  getActivity(
    projectId: string,
    activityId: string,
  ): Promise<ActivityRecord & { draft: ActivityDraft }>;
  /** The product a ref belongs to, or null for a row predating the product level. */
  productOf(activity: ActivityRecord): ActivityProduct | null;
  /** Whether this ref owns the module code; only the canonical ref may change it. */
  isCanonicalRef(activity: ActivityRecord): boolean;
  /** What an author calls a ref, and whether others may build against it. */
  setRefIdentity(
    projectId: string,
    activityId: string,
    identity: { displayName?: unknown; stable?: boolean },
  ): Promise<ActivityRecord>;
  /** A book product's reading mode; it belongs to the product, not to a ref. */
  setProductBookMode(
    projectId: string,
    collectionId: string,
    productCode: string,
    mode: "decodable" | "readAlong",
  ): Promise<ActivityProduct>;
  /** Create everything a Loom product's mapping describes, and report what happened. */
  importProduct(
    projectId: string,
    collectionId: string | undefined,
    mapping: ImportMapping,
  ): Promise<ImportOutcome>;
  /** The Loom products a checkout offers. Reading only; nothing is imported by looking. */
  availableImports(): Promise<{ modulesDir: string | null; products: ImportedActivity[] }>;
  /** Read one Loom product, decide what Penguin would make of it, and make it. */
  importFromLoom(
    projectId: string,
    moduleFolder: string,
    productCode: string,
    collectionId?: string,
  ): Promise<{
    mapping: ImportMapping;
    outcome: ImportOutcome;
    message: string;
    problems: string[];
  }>;
  updateDescription(
    projectId: string,
    activityId: string,
    description: string,
    expectedRevision?: string,
  ): Promise<ActivityDraft>;
  applySpec(
    projectId: string,
    activityId: string,
    spec: unknown,
    expectedRevision?: string,
  ): Promise<ActivityDraft>;
  draftWorkspace(
    projectId: string,
    collectionId: string,
    activityId: string,
    draftId: string,
  ): string;
}>() {}
