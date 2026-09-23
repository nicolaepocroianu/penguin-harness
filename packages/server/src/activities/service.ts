import fs from "node:fs/promises";
import type { ProposalChange } from "./assist.js";
import { validateBookSpec } from "./book.js";
import path from "node:path";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { projectDir } from "@prismshadow/penguin-core";
import type { Config, Db } from "../hmr/capabilities.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import type { ProjectActivityWork } from "../mechanisms/projects.js";
import { HttpError } from "../http/errors.js";
import { planMedia, validateManifest, validateMediaCoverage } from "./media.js";
import { mediaTextField, type MediaTextTarget } from "./media-text.js";
import { AUDIO_MAX_BYTES, inspectWave, type AudioResult, type AudioTarget } from "./audio.js";
import { readArtifactBytes } from "./artifact.js";
import {
  isUploadReference,
  listUploads,
  readUpload,
  storeUpload,
  type UploadedMedia,
} from "./upload.js";
import { readBoundImage, type ImageRequest } from "./image.js";
import {
  applyImport,
  describeOutcome,
  type ExistingProduct,
  type ImportOutcome,
  type ImportTarget,
} from "./import-apply.js";
import { describeImport, mapImport, type ImportMapping } from "./import-mapping.js";
import { discoverLoomProducts, readLoomProduct, type ImportedActivity } from "./loom-import.js";
import { findWafRoot } from "./waf-module.js";
import {
  GENERATED_IMAGE_MAX_BYTES,
  inspectPng,
  type ImageResult,
  type ImageTarget,
} from "./generated-image.js";
import {
  contentRevision,
  draftRevision,
  newCollectionManifest,
  newId,
  normalizeDisplayName,
  normalizeModuleFolder,
  normalizeProductCode,
  normalizeRefNum,
  type ActivityDraft,
  type ActivityProduct,
  type ActivityRecord,
  type CollectionManifest,
  validateActivitySpec,
} from "./domain.js";

/** Serializes compare-and-publish operations within the server's single-writer lifetime. */
export class ActivityLocks {
  private readonly pending = new Map<string, Promise<unknown>>();
  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.pending.set(key, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(key) === next) this.pending.delete(key);
    }
  }
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${newId("tmp")}`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

@Component()
export class ActivityService implements ActivityAuthoring {
  @Use() private readonly projectWork!: ProjectActivityWork;
  @Use() private readonly config!: Config;
  @Use() private readonly db!: Db;
  private readonly locks = new ActivityLocks();

  async imageContent(projectId: string, activityId: string, input: ImageRequest) {
    const activity = await this.getActivity(projectId, activityId);
    const generated = activity.draft.mediaPlan?.manifest.assets[input.language]?.find(
      (asset) => asset.key === input.assetKey,
    )?.generatedImage;
    if (generated) {
      if (activity.draft.contentRevision !== input.expectedRevision)
        throw new HttpError(
          409,
          "draft_conflict",
          "The draft changed. Reload it before previewing media.",
        );
      if (
        activity.draft.status !== "valid" ||
        activity.draft.mediaPlan!.specRevision !== contentRevision(activity.draft.spec)
      )
        throw new HttpError(409, "media_stale", "Rebuild the media plan before previewing images.");
      return {
        bytes: await this.readImage(projectId, activityId, generated.runId, generated.sha256),
        mimeType: "image/png",
      };
    }
    const bound = activity.draft.mediaPlan?.manifest.assets[input.language]?.find(
      (asset) => asset.key === input.assetKey,
    )?.path;
    // An upload lives in this activity's workspace; only checkout media needs a WAF root.
    if (isUploadReference(bound))
      return readUpload(this.activityWorkspace(projectId, activity), bound!);
    return readBoundImage(activity, input);
  }

  private activityWorkspace(
    projectId: string,
    activity: ActivityRecord & { draft: ActivityDraft },
  ): string {
    return this.draftWorkspace(
      projectId,
      activity.collectionId,
      activity.id,
      activity.draft.draftId,
    );
  }
  async uploadMedia(
    projectId: string,
    activityId: string,
    name: string,
    bytes: Buffer,
  ): Promise<UploadedMedia> {
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      return storeUpload(this.activityWorkspace(projectId, activity), name, bytes);
    });
  }
  async listMedia(projectId: string, activityId: string): Promise<UploadedMedia[]> {
    const activity = await this.getActivity(projectId, activityId);
    return listUploads(this.activityWorkspace(projectId, activity));
  }
  async uploadContent(
    projectId: string,
    activityId: string,
    reference: string,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const activity = await this.getActivity(projectId, activityId);
    return readUpload(this.activityWorkspace(projectId, activity), reference);
  }
  /** Stage every uploaded binding beside the generated ones, for assembly. */
  async prepareUploadedMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void> {
    const activity = await this.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== expectedRevision)
      throw new HttpError(409, "draft_conflict", "Media changed before assembly.");
    const source = this.activityWorkspace(projectId, activity);
    const copied = new Set<string>();
    for (const asset of Object.values(activity.draft.mediaPlan?.manifest.assets ?? {}).flat()) {
      if (!isUploadReference(asset.path) || copied.has(asset.path!)) continue;
      const { bytes } = await readUpload(source, asset.path!);
      const file = path.join(workspace, asset.path!);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      copied.add(asset.path!);
    }
  }

  private imagePath(
    projectId: string,
    activity: ActivityRecord & { draft: ActivityDraft },
    runId: string,
  ) {
    if (!/^run_[a-f0-9]{32}$/.test(runId))
      throw new HttpError(404, "run_not_found", "Image candidate not found.");
    return path.join(
      this.draftWorkspace(projectId, activity.collectionId, activity.id, activity.draft.draftId),
      "images",
      `${runId}.png`,
    );
  }
  async storeImage(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<ImageResult> {
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      const result = inspectPng(bytes, runId);
      const file = this.imagePath(projectId, activity, runId);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      return result;
    });
  }
  async readImage(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
  ): Promise<Uint8Array> {
    const activity = await this.getActivity(projectId, activityId);
    const bytes = await readArtifactBytes(
      this.imagePath(projectId, activity, runId),
      GENERATED_IMAGE_MAX_BYTES,
    );
    if (inspectPng(bytes, runId).sha256 !== sha256)
      throw new HttpError(409, "image_changed", "Stored image changed. Generate a new candidate.");
    return bytes;
  }
  async applyImage(
    projectId: string,
    activityId: string,
    target: ImageTarget,
    result: ImageResult,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    await this.readImage(projectId, activityId, result.runId, result.sha256);
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const plan = draft.mediaPlan;
      if (!plan || plan.specRevision !== contentRevision(draft.spec) || draft.status !== "valid")
        throw new HttpError(
          409,
          "media_stale",
          "Rebuild the media plan before accepting an image.",
        );
      const manifest = structuredClone(plan.manifest);
      const asset = manifest.assets[target.language]?.find(
        (entry) => entry.key === target.assetKey,
      );
      if (!asset || asset.type !== "image" || asset.description !== target.prompt)
        throw new HttpError(
          409,
          "image_changed",
          "The image description changed. Generate a new candidate.",
        );
      asset.path = `media/generated/${result.runId}.png`;
      asset.generatedImage = { runId: result.runId, sha256: result.sha256 };
      return { ...draft, mediaPlan: { ...plan, manifest } };
    });
  }
  async applyMediaText(
    projectId: string,
    activityId: string,
    target: MediaTextTarget,
    text: string,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    if (!text.trim() || text.length > 5000)
      throw new HttpError(422, "media_text_invalid", "Media text must contain 1–5000 characters.");
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const plan = draft.mediaPlan;
      if (!plan || plan.specRevision !== contentRevision(draft.spec) || draft.status !== "valid")
        throw new HttpError(
          409,
          "media_stale",
          "Rebuild the media plan before accepting improved media text.",
        );
      const manifest = structuredClone(plan.manifest);
      const asset = manifest.assets[target.language]?.find(
        (entry) => entry.key === target.assetKey,
      );
      if (!asset || asset.type !== target.type || mediaTextField(asset) !== target.text)
        throw new HttpError(
          409,
          "media_text_changed",
          "The selected media text changed. Generate a new candidate.",
        );
      if (target.type === "image") asset.description = text;
      else asset.script = text;
      return { ...draft, mediaPlan: { ...plan, manifest } };
    });
  }
  async prepareImageMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void> {
    const activity = await this.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== expectedRevision)
      throw new HttpError(409, "draft_conflict", "Media changed before assembly.");
    const copied = new Set<string>();
    for (const asset of Object.values(activity.draft.mediaPlan?.manifest.assets ?? {}).flat()) {
      if (!asset.generatedImage || copied.has(asset.path!)) continue;
      const bytes = await this.readImage(
        projectId,
        activityId,
        asset.generatedImage.runId,
        asset.generatedImage.sha256,
      );
      const file = path.join(workspace, asset.path!);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      copied.add(asset.path!);
    }
  }

  private collectionDir(projectId: string, collectionId: string): string {
    return path.join(projectDir(this.config.root, projectId), "activities", collectionId);
  }
  draftWorkspace(
    projectId: string,
    collectionId: string,
    activityId: string,
    draftId: string,
  ): string {
    return path.join(
      this.collectionDir(projectId, collectionId),
      "activities",
      activityId,
      "drafts",
      draftId,
    );
  }

  async ensureCollection(projectId: string, collectionId?: string): Promise<CollectionManifest> {
    return this.projectWork.run(projectId, () =>
      this.ensureCollectionFiles(projectId, collectionId),
    );
  }

  private async ensureCollectionFiles(
    projectId: string,
    collectionId?: string,
  ): Promise<CollectionManifest> {
    return this.locks.run(`collection:${projectId}`, async () => {
      const row = (
        collectionId
          ? this.db
              .prepare(
                "SELECT collection_id FROM activity_collections WHERE project_id = ? AND collection_id = ?",
              )
              .get(projectId, collectionId)
          : this.db
              .prepare(
                "SELECT collection_id FROM activity_collections WHERE project_id = ? ORDER BY created_at, collection_id LIMIT 1",
              )
              .get(projectId)
      ) as { collection_id: string } | undefined;
      if (collectionId && !row)
        throw new HttpError(404, "collection_not_found", "Collection not found.");
      if (row) {
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(this.collectionDir(projectId, row.collection_id), "collection.json"),
            "utf8",
          ),
        ) as CollectionManifest;
        if (manifest.schemaVersion !== 1 || manifest.collectionId !== row.collection_id)
          throw new Error("Collection manifest is corrupt.");
        return manifest;
      }
      const manifest = { ...newCollectionManifest(), collectionId: newId("col") };
      const dir = this.collectionDir(projectId, manifest.collectionId);
      await fs.mkdir(dir, { recursive: true });
      await atomicJson(path.join(dir, "collection.json"), manifest);
      this.db
        .prepare(
          "INSERT INTO activity_collections (project_id, collection_id, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(projectId, manifest.collectionId, dir, manifest.createdAt, manifest.updatedAt);
      return manifest;
    });
  }

  async createActivity(
    projectId: string,
    input: {
      collectionId?: string;
      productCode: unknown;
      refNum: unknown;
      title: string;
      activityType?: "standard" | "book";
      /** Only read when this is the product's first ref; later refs join what exists. */
      moduleFolder?: unknown;
    },
  ): Promise<ActivityRecord & { draft: ActivityDraft }> {
    let productCode: string, refNum: number;
    try {
      productCode = normalizeProductCode(input.productCode);
      refNum = normalizeRefNum(input.refNum);
    } catch (error) {
      throw new HttpError(400, "activity_invalid", (error as Error).message);
    }
    const title = input.title.trim();
    if (!title) throw new HttpError(400, "activity_invalid", "title is required.");
    return this.projectWork.run(projectId, async () => {
      const collection = await this.ensureCollectionFiles(projectId, input.collectionId);
      return this.locks.run(`create:${collection.collectionId}`, async () => {
        if (
          this.db
            .prepare(
              "SELECT id FROM activities WHERE collection_id = ? AND product_code = ? AND ref_num = ?",
            )
            .get(collection.collectionId, productCode, refNum)
        )
          throw new HttpError(
            409,
            "activity_exists",
            "This productCode/refNum is already reserved.",
          );
        const now = new Date().toISOString();
        const activityType = input.activityType ?? "standard";
        // A ref belongs to a product, and the first ref of a product creates it and is its
        // canonical one: the module code has to belong to some ref, and the only ref there
        // is at that moment is this one.
        const product = this.ensureProduct({
          projectId,
          collectionId: collection.collectionId,
          productCode,
          activityType,
          moduleFolder: input.moduleFolder,
          now,
        });
        const activity: ActivityRecord = {
          id: newId("act"),
          collectionId: collection.collectionId,
          productId: product.productId,
          productCode,
          refNum,
          title,
          displayName: null,
          stable: false,
          activityType,
          createdAt: now,
          updatedAt: now,
          archived: false,
        };
        const draft: ActivityDraft = {
          draftId: newId("draft"),
          activityId: activity.id,
          baseVersionId: null,
          contentRevision: contentRevision({ description: "", spec: null }),
          status: "draft",
          description: "",
          spec: null,
          updatedAt: now,
        };
        await this.writeDraft(projectId, draft, collection.collectionId);
        this.db.exec("BEGIN");
        try {
          this.db
            .prepare(
              "INSERT INTO activities (id, collection_id, product_id, product_code, ref_num, title, display_name, stable, activity_type, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, 0)",
            )
            .run(
              activity.id,
              activity.collectionId,
              activity.productId,
              productCode,
              refNum,
              title,
              activity.activityType,
              now,
              now,
            );
          // The product's canonical ref is whichever ref existed first; a product created
          // by this very activity has none yet.
          this.db
            .prepare(
              "UPDATE activity_products SET canonical_ref_num = ?, updated_at = ? WHERE product_id = ? AND canonical_ref_num IS NULL",
            )
            .run(refNum, now, activity.productId);
          this.db
            .prepare(
              "INSERT INTO activity_drafts (draft_id, activity_id, base_version_id, content_revision, status, updated_at) VALUES (?, ?, NULL, ?, ?, ?)",
            )
            .run(draft.draftId, activity.id, draft.contentRevision, draft.status, now);
          this.db.exec("COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
        return { ...activity, draft };
      });
    });
  }

  async listActivities(projectId: string, collectionId?: string): Promise<ActivityRecord[]> {
    return (
      this.db
        .prepare(
          `SELECT a.* FROM activities a
      JOIN activity_collections c ON c.collection_id = a.collection_id
      WHERE c.project_id = ? AND a.archived = 0 AND (? IS NULL OR a.collection_id = ?)
      ORDER BY a.product_code, a.ref_num, a.id`,
        )
        .all(projectId, collectionId ?? null, collectionId ?? null) as Record<string, unknown>[]
    ).map((row) => this.mapActivity(row));
  }

  async getActivity(
    projectId: string,
    activityId: string,
  ): Promise<ActivityRecord & { draft: ActivityDraft }> {
    const row = this.db
      .prepare(
        `SELECT a.* FROM activities a
      JOIN activity_collections c ON c.collection_id = a.collection_id
      WHERE a.id = ? AND c.project_id = ? AND a.archived = 0`,
      )
      .get(activityId, projectId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, "activity_not_found", "Activity not found.");
    const activity = this.mapActivity(row);
    const draftRow = this.db
      .prepare(
        "SELECT draft_id FROM activity_drafts WHERE activity_id = ? ORDER BY updated_at DESC, draft_id LIMIT 1",
      )
      .get(activityId) as { draft_id: string } | undefined;
    if (!draftRow) throw new Error("Activity draft index is missing.");
    const file = JSON.parse(
      await fs.readFile(
        path.join(
          this.draftWorkspace(projectId, activity.collectionId, activityId, draftRow.draft_id),
          "draft.json",
        ),
        "utf8",
      ),
    ) as ActivityDraft;
    if (
      file.draftId !== draftRow.draft_id ||
      file.activityId !== activityId ||
      typeof file.description !== "string" ||
      (file.spec !== null && (typeof file.spec !== "object" || Array.isArray(file.spec)))
    )
      throw new Error("Activity draft is corrupt.");
    if (file.mediaPlan) {
      if (!/^[a-f0-9]{64}$/.test(file.mediaPlan.specRevision))
        throw new Error("Media plan is corrupt.");
      const requirements = file.mediaPlan.requirements;
      if (
        !requirements ||
        typeof requirements !== "object" ||
        Array.isArray(requirements) ||
        Object.values(requirements).some(
          (value) => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value),
        )
      )
        throw new Error("Media requirements are corrupt.");
      validateManifest(file.mediaPlan.manifest, activity);
    }
    // The file is authoritative. Never substitute the index for missing/corrupt content.
    const revision = draftRevision(file);
    return {
      ...activity,
      draft: {
        ...file,
        contentRevision: revision,
        status: revision === file.contentRevision ? file.status : "draft",
      },
    };
  }

  /**
   * An agent's whole proposal, applied as one change to the draft so that it lands whole or
   * not at all. Media text goes first, while the plan still matches the specification it
   * was planned from; then the script; then the specification, whose new revision leaves
   * the plan to be rebuilt, as any specification change does.
   */
  async applyProposal(
    projectId: string,
    activityId: string,
    changes: ProposalChange[],
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      let next: ActivityDraft = { ...draft };
      const media = changes.filter(
        (change): change is Extract<ProposalChange, { target: "media" }> =>
          change.target === "media",
      );
      if (media.length) {
        const plan = next.mediaPlan;
        if (!plan || next.status !== "valid" || plan.specRevision !== contentRevision(next.spec))
          throw new HttpError(
            409,
            "media_stale",
            "Rebuild the media plan from the saved specification before applying media changes.",
          );
        const manifest = structuredClone(plan.manifest);
        for (const change of media) {
          const asset = manifest.assets[change.language]?.find(
            (item) => item.key === change.assetKey,
          );
          if (!asset || (change.field === "script" && asset.type !== "audio"))
            throw new HttpError(
              422,
              "proposal_invalid",
              `The media plan has no ${change.language} ${change.field === "script" ? "narration" : "asset"} named ${change.assetKey}.`,
            );
          asset[change.field] = change.text;
        }
        try {
          next = {
            ...next,
            mediaPlan: { ...plan, manifest: validateManifest(manifest, activity) },
          };
        } catch (error) {
          throw new HttpError(422, "media_invalid", (error as Error).message);
        }
      }
      const description = changes.find((change) => change.target === "description");
      if (description) next = { ...next, description: description.text, status: "draft" };
      const spec = changes.find((change) => change.target === "spec");
      if (spec) {
        let parsed: Record<string, unknown>;
        try {
          parsed = validateActivitySpec(spec.spec);
          if (activity.activityType === "book") validateBookSpec(parsed);
        } catch (error) {
          throw new HttpError(422, "spec_invalid", (error as Error).message);
        }
        next = { ...next, spec: parsed, status: "valid" };
      }
      return next;
    });
  }
  async updateDescription(
    projectId: string,
    activityId: string,
    description: string,
    expectedRevision?: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft) => ({
      ...draft,
      description,
      status: "draft",
    }));
  }
  async applySpec(
    projectId: string,
    activityId: string,
    spec: unknown,
    expectedRevision?: string,
  ): Promise<ActivityDraft> {
    let parsed: Record<string, unknown>;
    try {
      parsed = validateActivitySpec(spec);
    } catch (error) {
      throw new HttpError(422, "spec_invalid", (error as Error).message);
    }
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      if (activity.activityType === "book") {
        try {
          validateBookSpec(parsed);
        } catch (error) {
          throw new HttpError(422, "spec_invalid", (error as Error).message);
        }
      }
      return { ...draft, spec: parsed, status: "valid" };
    });
  }
  async planMedia(
    projectId: string,
    activityId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      try {
        return { ...draft, mediaPlan: planMedia({ ...activity, draft }) };
      } catch (error) {
        throw new HttpError(422, "media_invalid", (error as Error).message);
      }
    });
  }
  async applyMedia(
    projectId: string,
    activityId: string,
    manifest: unknown,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, async (draft, activity) => {
      if (
        !draft.mediaPlan ||
        draft.mediaPlan.specRevision !== contentRevision(draft.spec) ||
        draft.status !== "valid"
      )
        throw new HttpError(
          409,
          "media_stale",
          "Rebuild the media plan from the saved specification before saving bindings.",
        );
      try {
        const parsed = validateManifest(manifest, activity);
        validateMediaCoverage(parsed, { ...activity, draft });
        for (const [language, assets] of Object.entries(parsed.assets)) {
          for (const asset of assets) {
            if (!asset.generatedImage) continue;
            const accepted = draft.mediaPlan.manifest.assets[language]?.find(
              (previous) => previous.key === asset.key,
            )?.generatedImage;
            if (
              !accepted ||
              accepted.runId !== asset.generatedImage.runId ||
              accepted.sha256 !== asset.generatedImage.sha256
            )
              throw new Error("Use Accept this image to bind a generated candidate.");
          }
        }
        // An upload is bytes this server holds, so what it actually is can be checked
        // rather than assumed. A path alone says nothing about the media it names.
        const workspace = this.activityWorkspace(projectId, { ...activity, draft });
        for (const assets of Object.values(parsed.assets))
          for (const asset of assets) {
            if (!isUploadReference(asset.path)) continue;
            const { mimeType } = await readUpload(workspace, asset.path!);
            const kind = mimeType.slice(0, mimeType.indexOf("/"));
            const wanted =
              asset.type === "image" ? "image" : asset.type === "audio" ? "audio" : "video";
            if (kind !== wanted)
              throw new Error(
                `Asset ${asset.key} expects ${wanted} media, but ${asset.path} holds ${kind} media.`,
              );
          }
        return { ...draft, mediaPlan: { ...draft.mediaPlan, manifest: parsed } };
      } catch (error) {
        throw new HttpError(422, "media_invalid", (error as Error).message);
      }
    });
  }
  async storeAudio(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<AudioResult> {
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      const result = inspectWave(bytes, runId);
      const file = this.audioPath(projectId, activity, runId);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      return result;
    });
  }
  private audioPath(
    projectId: string,
    activity: ActivityRecord & { draft: ActivityDraft },
    runId: string,
  ): string {
    if (!/^run_[a-f0-9]{32}$/.test(runId))
      throw new HttpError(404, "run_not_found", "Audio candidate not found.");
    return path.join(
      this.draftWorkspace(projectId, activity.collectionId, activity.id, activity.draft.draftId),
      "audio",
      `${runId}.wav`,
    );
  }
  async readAudio(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
  ): Promise<Uint8Array> {
    const activity = await this.getActivity(projectId, activityId);
    const bytes = await readArtifactBytes(
      this.audioPath(projectId, activity, runId),
      AUDIO_MAX_BYTES,
    );
    if (inspectWave(bytes, runId).sha256 !== sha256)
      throw new HttpError(409, "audio_changed", "Stored audio changed. Generate a new candidate.");
    return bytes;
  }
  async applyAudio(
    projectId: string,
    activityId: string,
    target: AudioTarget,
    result: AudioResult,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    // Verify immutable bytes before the same compare-and-publish lock used by all draft edits.
    await this.readAudio(projectId, activityId, result.runId, result.sha256);
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const plan = draft.mediaPlan;
      if (!plan || plan.specRevision !== contentRevision(draft.spec) || draft.status !== "valid")
        throw new HttpError(409, "media_stale", "Rebuild the media plan before accepting speech.");
      const manifest = structuredClone(plan.manifest);
      const asset = manifest.assets[target.language]?.find(
        (entry) => entry.key === target.assetKey,
      );
      if (!asset || asset.type !== "audio" || asset.script !== target.script)
        throw new HttpError(
          409,
          "audio_changed",
          "The speech requirement changed. Generate a new candidate.",
        );
      asset.path = `media/generated/${result.runId}.wav`;
      asset.generatedAudio = { runId: result.runId, sha256: result.sha256 };
      return { ...draft, mediaPlan: { ...plan, manifest } };
    });
  }
  async prepareAudioMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void> {
    const activity = await this.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== expectedRevision)
      throw new HttpError(409, "draft_conflict", "Media changed before assembly.");
    const copied = new Set<string>();
    for (const asset of Object.values(activity.draft.mediaPlan?.manifest.assets ?? {}).flat()) {
      if (!asset.generatedAudio || copied.has(asset.path!)) continue;
      const bytes = await this.readAudio(
        projectId,
        activityId,
        asset.generatedAudio.runId,
        asset.generatedAudio.sha256,
      );
      const file = path.join(workspace, asset.path!);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      copied.add(asset.path!);
    }
  }
  private async change(
    projectId: string,
    activityId: string,
    expectedRevision: string | undefined,
    edit: (
      draft: ActivityDraft,
      activity: ActivityRecord,
    ) => ActivityDraft | Promise<ActivityDraft>,
  ): Promise<ActivityDraft> {
    return this.projectWork.run(projectId, () =>
      this.locks.run(activityId, async () => {
        const current = await this.getActivity(projectId, activityId);
        if (!expectedRevision || expectedRevision !== current.draft.contentRevision)
          throw new HttpError(
            409,
            "draft_conflict",
            "Draft changed. Reload it before applying your edit.",
          );
        const draft = await edit(current.draft, current);
        draft.contentRevision = draftRevision(draft);
        draft.updatedAt = new Date().toISOString();
        await this.writeDraft(projectId, draft, current.collectionId);
        this.db
          .prepare(
            "UPDATE activity_drafts SET content_revision = ?, status = ?, updated_at = ? WHERE draft_id = ?",
          )
          .run(draft.contentRevision, draft.status, draft.updatedAt, draft.draftId);
        this.db
          .prepare("UPDATE activities SET title = ?, updated_at = ? WHERE id = ?")
          .run(
            draft.status === "valid" ? (draft.spec!.title as string) : current.title,
            draft.updatedAt,
            activityId,
          );
        return draft;
      }),
    );
  }
  private async writeDraft(
    projectId: string,
    draft: ActivityDraft,
    collectionId: string,
  ): Promise<void> {
    const dir = this.draftWorkspace(projectId, collectionId, draft.activityId, draft.draftId);
    await fs.mkdir(dir, { recursive: true });
    // These two files are exports; only the atomically published draft is authoritative.
    if (draft.spec !== null) await atomicJson(path.join(dir, "activity-spec.json"), draft.spec);
    if (draft.mediaPlan)
      await atomicJson(path.join(dir, "asset-manifest.json"), draft.mediaPlan.manifest);
    await fs.writeFile(path.join(dir, "description.md"), draft.description, "utf8");
    await atomicJson(path.join(dir, "draft.json"), draft);
  }
  private mapActivity(row: Record<string, unknown>): ActivityRecord {
    return {
      id: row.id as string,
      collectionId: row.collection_id as string,
      productId: (row.product_id as string | null) ?? null,
      productCode: row.product_code as string,
      refNum: row.ref_num as number,
      title: row.title as string,
      displayName: (row.display_name as string | null) ?? null,
      stable: Boolean(row.stable),
      activityType: row.activity_type as ActivityRecord["activityType"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      archived: Boolean(row.archived),
    };
  }

  private mapProduct(row: Record<string, unknown>): ActivityProduct {
    return {
      productId: row.product_id as string,
      projectId: row.project_id as string,
      collectionId: row.collection_id as string,
      productCode: row.product_code as string,
      moduleFolder: row.module_folder as string,
      canonicalRefNum: (row.canonical_ref_num as number | null) ?? null,
      activityType: row.activity_type as ActivityProduct["activityType"],
      bookMode: (row.book_mode as ActivityProduct["bookMode"]) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * The product a ref belongs to, created on first use.
   *
   * A product is not something an author makes on purpose: it appears the moment the
   * first ref of a product code does, and every later ref of that code joins it. Its type
   * comes from the ref that created it, because that ref is also its canonical one.
   */
  private ensureProduct(input: {
    projectId: string;
    collectionId: string;
    productCode: string;
    activityType: ActivityRecord["activityType"];
    moduleFolder?: unknown;
    now: string;
  }): ActivityProduct {
    const existing = this.db
      .prepare("SELECT * FROM activity_products WHERE collection_id = ? AND product_code = ?")
      .get(input.collectionId, input.productCode) as Record<string, unknown> | undefined;
    if (existing) return this.mapProduct(existing);
    const product: ActivityProduct = {
      productId: newId("prd"),
      projectId: input.projectId,
      collectionId: input.collectionId,
      productCode: input.productCode,
      moduleFolder: normalizeModuleFolder(input.moduleFolder, input.productCode),
      canonicalRefNum: null,
      activityType: input.activityType,
      bookMode: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.db
      .prepare(
        `INSERT INTO activity_products
           (product_id, project_id, collection_id, product_code, module_folder,
            canonical_ref_num, activity_type, book_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        product.productId,
        product.projectId,
        product.collectionId,
        product.productCode,
        product.moduleFolder,
        product.activityType,
        product.createdAt,
        product.updatedAt,
      );
    return product;
  }

  /** The product a ref belongs to, or null for a row predating the product level. */
  productOf(activity: ActivityRecord): ActivityProduct | null {
    if (!activity.productId) return null;
    const row = this.db
      .prepare("SELECT * FROM activity_products WHERE product_id = ?")
      .get(activity.productId) as Record<string, unknown> | undefined;
    return row ? this.mapProduct(row) : null;
  }

  /**
   * Whether this ref owns the module code.
   *
   * Only the canonical ref may change the shared module; the others are configuration on
   * top of it. Three generation stages are gated on this. A ref with no product at all
   * predates the product level and is treated as canonical, because it is the only ref
   * anyone could have been building against.
   */
  isCanonicalRef(activity: ActivityRecord): boolean {
    const product = this.productOf(activity);
    if (!product) return true;
    return product.canonicalRefNum === null || product.canonicalRefNum === activity.refNum;
  }

  /** What a product code already holds in this collection, or null if nothing does. */
  existingProduct(collectionId: string, productCode: string): ExistingProduct | null {
    const product = this.db
      .prepare("SELECT * FROM activity_products WHERE collection_id = ? AND product_code = ?")
      .get(collectionId, productCode) as Record<string, unknown> | undefined;
    if (!product) return null;
    const refs = this.db
      .prepare(
        "SELECT ref_num AS refNum FROM activities WHERE collection_id = ? AND product_code = ? ORDER BY ref_num",
      )
      .all(collectionId, productCode) as { refNum: number }[];
    return {
      refNums: refs.map((ref) => ref.refNum),
      canonicalRefNum: this.mapProduct(product).canonicalRefNum,
    };
  }

  /**
   * What an author calls a ref, and whether others may build against it.
   *
   * Neither belongs to the draft: renaming a ref does not change its content, so putting
   * them through the draft revision would make a label edit conflict with an unsaved
   * specification.
   */
  async setRefIdentity(
    projectId: string,
    activityId: string,
    identity: { displayName?: unknown; stable?: boolean },
  ): Promise<ActivityRecord> {
    let displayName: string | null | undefined;
    try {
      if (identity.displayName !== undefined)
        displayName = normalizeDisplayName(identity.displayName);
    } catch (error) {
      throw new HttpError(400, "activity_invalid", (error as Error).message);
    }
    return this.projectWork.run(projectId, () =>
      this.locks.run(activityId, async () => {
        const activity = await this.getActivity(projectId, activityId);
        const now = new Date().toISOString();
        const next: ActivityRecord = {
          ...activity,
          displayName: displayName === undefined ? activity.displayName : displayName,
          stable: identity.stable === undefined ? activity.stable : identity.stable,
          updatedAt: now,
        };
        this.db
          .prepare(
            "UPDATE activities SET display_name = ?, stable = ?, updated_at = ? WHERE id = ?",
          )
          .run(next.displayName, next.stable ? 1 : 0, now, activityId);
        return next;
      }),
    );
  }

  /**
   * A book product's reading mode.
   *
   * It belongs to the product rather than to a ref: every ref of a book shares one module,
   * and a module is built either read-along or decodable, never both.
   */
  async setProductBookMode(
    projectId: string,
    collectionId: string,
    productCode: string,
    mode: "decodable" | "readAlong",
  ): Promise<ActivityProduct> {
    return this.projectWork.run(projectId, async () => {
      const row = this.db
        .prepare(
          "SELECT * FROM activity_products WHERE collection_id = ? AND product_code = ? AND project_id = ?",
        )
        .get(collectionId, productCode, projectId) as Record<string, unknown> | undefined;
      if (!row) throw new HttpError(404, "product_not_found", "No such product.");
      const product = this.mapProduct(row);
      if (product.activityType !== "book")
        throw new HttpError(400, "book_mode_invalid", "Reading mode only applies to books.");
      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE activity_products SET book_mode = ?, updated_at = ? WHERE product_id = ?")
        .run(mode, now, product.productId);
      return { ...product, bookMode: mode, updatedAt: now };
    });
  }

  /**
   * The Loom products a checkout offers, read only.
   *
   * Nothing is imported by looking; this is the list an author chooses from, and a product
   * that could not be read fully arrives with its problems attached rather than hidden.
   */
  async availableImports(): Promise<{ modulesDir: string | null; products: ImportedActivity[] }> {
    const wafRoot = await findWafRoot();
    if (!wafRoot) return { modulesDir: null, products: [] };
    const modulesDir = path.join(wafRoot, "modules");
    return { modulesDir, products: await discoverLoomProducts(modulesDir) };
  }

  /**
   * Read one Loom product, decide what Penguin would make of it, and make it.
   *
   * The three steps stay separate on purpose: the reader never writes, the mapping never
   * touches the store, and this reports all of it together so an author sees what was
   * repaired and what was lost beside what was created.
   */
  async importFromLoom(
    projectId: string,
    moduleFolder: string,
    productCode: string,
    collectionId?: string,
  ): Promise<{
    mapping: ImportMapping;
    outcome: ImportOutcome;
    message: string;
    problems: string[];
  }> {
    const wafRoot = await findWafRoot();
    if (!wafRoot)
      throw new HttpError(
        400,
        "waf_checkout_missing",
        "WAF checkout not found. Select a root containing framework, modules and media.",
      );
    let source: ImportedActivity;
    try {
      source = await readLoomProduct(
        path.join(wafRoot, "modules"),
        normalizeModuleFolder(moduleFolder, "module"),
        normalizeProductCode(productCode),
      );
    } catch (error) {
      throw new HttpError(400, "activity_invalid", (error as Error).message);
    }
    if (!source.refs.length)
      throw new HttpError(404, "loom_product_not_found", "No such product in the checkout.");
    const mapping = mapImport(source.product, source.refs);
    const outcome = await this.importProduct(projectId, collectionId, mapping);
    return {
      mapping,
      outcome,
      message: `${describeImport(mapping)} ${describeOutcome(outcome, mapping.product.productCode)}`,
      problems: [...source.problems, ...source.refs.flatMap((ref) => ref.problems)],
    };
  }

  /**
   * Import one Loom product into a collection.
   *
   * The ordering and failure policy live in `applyImport`; this only supplies the store.
   * Every call it makes is an ordinary authoring call, so an imported activity is
   * indistinguishable from one an author made here — which is the point of the trial.
   */
  async importProduct(
    projectId: string,
    collectionId: string | undefined,
    mapping: ImportMapping,
  ): Promise<ImportOutcome> {
    const collection = await this.ensureCollection(projectId, collectionId);
    const target: ImportTarget = {
      existingProduct: async (productCode) =>
        this.existingProduct(collection.collectionId, productCode),
      createRef: async (input) => {
        const created = await this.createActivity(projectId, {
          collectionId: collection.collectionId,
          productCode: input.productCode,
          refNum: input.refNum,
          title: input.title,
          activityType: input.activityType,
          moduleFolder: input.moduleFolder,
        });
        return { activityId: created.id, revision: created.draft.contentRevision };
      },
      setRefIdentity: async (activityId, identity) => {
        await this.setRefIdentity(projectId, activityId, identity);
      },
      setDescription: async (activityId, description, revision) =>
        (await this.updateDescription(projectId, activityId, description, revision))
          .contentRevision,
      setSpec: async (activityId, spec, revision) =>
        (await this.applySpec(projectId, activityId, spec, revision)).contentRevision,
      setBookMode: async (productCode, mode) => {
        await this.setProductBookMode(projectId, collection.collectionId, productCode, mode);
      },
    };
    return applyImport(mapping, target);
  }
}
