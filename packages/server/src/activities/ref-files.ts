/**
 * An activity ref's files in its module, in Loom's layout:
 *
 *     <wafRoot>/modules/<moduleFolder>/generated/<pc>/
 *       spec/activity_metadata.json        the product: code, module, type, canonical ref, tags
 *       spec/penguin.json                  Penguin's own: which project owns the product
 *       refs/<pc>-<ref>/spec/
 *         activity_metadata.json           the ref: number, title, display name, stability
 *         activity_spec.json               the specification (`{}` until one is saved)
 *         activity_description.txt         what the author wrote
 *         asset_manifest.json              the media plan's manifest (no assets until planned)
 *         implementation_features.json     `{ selectedIds }`
 *         penguin.json                     Penguin's bookkeeping for the draft
 *
 * Penguin is the only writer, so its own fields may sit inside Loom's files; what Loom's
 * files have no place for (the draft's status and revision, which specification the media
 * plan was made from, module document edits, a pinned build) is `penguin.json`, committed
 * with the module like the rest. `penguin.json` is written last: a draft whose other files
 * changed after it reads as "draft" until it is saved again, as `draft.json` did before.
 *
 * Loom lists a ref only when its spec, manifest, description and metadata are all there (and
 * the module's `configurations/<pc>-<ref>.json`), so none of them is ever removed: a draft
 * with no specification or plan leaves Loom's, or writes Loom's own empty stub. Every Loom
 * file is merged into rather than replaced, so what Loom wrote that Penguin does not use
 * stays (see loom-manifest.ts for the manifest).
 *
 * File I/O only: where the folders are is waf-layout.ts; the service owns locking, validation
 * and the index.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { renameOver } from "../internal/rename-over.js";
import type { ActivityAddress, ActivityDraft, ModuleDocumentOverrides } from "./domain.js";
import { mergeLoomManifest, penguinManifest } from "./loom-manifest.js";

export const REF_METADATA_FILE = "activity_metadata.json";
export const REF_SPEC_FILE = "activity_spec.json";
export const REF_DESCRIPTION_FILE = "activity_description.txt";
export const REF_MANIFEST_FILE = "asset_manifest.json";
export const REF_FEATURES_FILE = "implementation_features.json";
/** Loom's manifest as it was when a project adopted the ref, kept beside Penguin's. */
export const LOOM_MANIFEST_COPY = "asset_manifest.loom.json";
export const PENGUIN_FILE = "penguin.json";
/** The behaviour machine, on the product (Loom's canonical one) or on a ref once implemented. */
export const STATE_MACHINE_FILE = "state-machine.json";

/** What `penguin.json` holds for a ref: the draft less what Loom's files carry. */
export interface PenguinRefState {
  schemaVersion: 1;
  draftId: string;
  activityId: string;
  baseVersionId: string | null;
  /** The revision the draft had when it was saved; a mismatch on read means "draft". */
  contentRevision: string;
  status: ActivityDraft["status"];
  /** The media plan's bookkeeping; its manifest is `asset_manifest.json`. */
  mediaPlan?: { specRevision: string; requirements: Record<string, string> };
  moduleDocuments?: ModuleDocumentOverrides;
  pinnedModuleRunId?: string;
  /**
   * The draft has no specification. `activity_spec.json` is then Loom's (one Penguin could
   * not accept) or Loom's empty `{}`, and is not the draft's.
   */
  noSpec?: true;
  updatedAt: string;
}

/** The ref's identity, as `activity_metadata.json` records it. */
export interface RefMetadata {
  productCode: string;
  refNum: number;
  title: string;
  moduleFolder: string;
  displayName: string | null;
  stable: boolean;
  runtime?: unknown;
}

/** The product's identity, as its `activity_metadata.json` records it. */
export interface ProductMetadata {
  productCode: string;
  title: string;
  moduleFolder: string;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
  canonicalRefNum: number | null;
  tags: string[];
  runtime?: unknown;
}

/** Which Penguin project owns a product, as the product's `penguin.json` records it. */
export interface PenguinProductState {
  schemaVersion: 1;
  projectId: string;
  productId: string;
  collectionId: string;
}

/** Written whole to a sibling temporary file, then renamed over the target. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, text, "utf8");
    await renameOver(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(file: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text) as unknown;
}

/**
 * The draft the ref's files make, or null when the ref has no `penguin.json` (a ref Penguin
 * never saved). A file that does not parse is an error: the caller reports the draft corrupt.
 */
export async function readRefDraft(specDir: string): Promise<ActivityDraft | null> {
  const state = (await readJson(path.join(specDir, PENGUIN_FILE))) as PenguinRefState | undefined;
  if (state === undefined) return null;
  if (!state || typeof state !== "object" || state.schemaVersion !== 1)
    throw new Error("penguin.json is corrupt.");
  const spec = state.noSpec ? undefined : await readJson(path.join(specDir, REF_SPEC_FILE));
  const manifest = await readJson(path.join(specDir, REF_MANIFEST_FILE));
  const description = await fs
    .readFile(path.join(specDir, REF_DESCRIPTION_FILE), "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  const draft: ActivityDraft = {
    draftId: state.draftId,
    activityId: state.activityId,
    baseVersionId: state.baseVersionId ?? null,
    contentRevision: state.contentRevision,
    status: state.status,
    description,
    spec: spec === undefined ? null : (spec as Record<string, unknown>),
    updatedAt: state.updatedAt,
  };
  // A plan is its bookkeeping and its manifest together; either alone is no plan.
  if (state.mediaPlan && manifest !== undefined)
    draft.mediaPlan = { ...state.mediaPlan, manifest: penguinManifest(manifest) };
  if (state.moduleDocuments) draft.moduleDocuments = state.moduleDocuments;
  if (state.pinnedModuleRunId) draft.pinnedModuleRunId = state.pinnedModuleRunId;
  return draft;
}

/**
 * Writes the draft into the ref's files, `penguin.json` last. A specification or plan the
 * draft lacks leaves the file as Loom has it, unless Penguin wrote it, when it becomes Loom's
 * empty stub; a missing file becomes the stub, so Loom still lists the ref.
 */
export async function writeRefDraft(
  specDir: string,
  draft: ActivityDraft,
  address: ActivityAddress,
): Promise<void> {
  await fs.mkdir(specDir, { recursive: true });
  const specFile = path.join(specDir, REF_SPEC_FILE);
  const manifestFile = path.join(specDir, REF_MANIFEST_FILE);
  const previous = (await readJson(path.join(specDir, PENGUIN_FILE)).catch(() => undefined)) as
    PenguinRefState | undefined;
  const ours = !!previous && typeof previous === "object" && previous.schemaVersion === 1;
  if (draft.spec !== null) await writeFileAtomic(specFile, json(draft.spec));
  else if ((ours && !previous.noSpec) || !(await exists(specFile)))
    await writeFileAtomic(specFile, json({}));
  const onDisk = await readJson(manifestFile).catch(() => undefined);
  if (draft.mediaPlan || (ours && previous.mediaPlan) || onDisk === undefined) {
    // An adopted ref's manifest as Loom left it (see loom-manifest.ts).
    const original = await readJson(path.join(specDir, LOOM_MANIFEST_COPY)).catch(() => undefined);
    await writeFileAtomic(
      manifestFile,
      json(mergeLoomManifest(onDisk, draft.mediaPlan?.manifest ?? null, address, original)),
    );
  }
  await writeFileAtomic(path.join(specDir, REF_DESCRIPTION_FILE), draft.description);
  const state: PenguinRefState = {
    schemaVersion: 1,
    draftId: draft.draftId,
    activityId: draft.activityId,
    baseVersionId: draft.baseVersionId,
    contentRevision: draft.contentRevision,
    status: draft.status,
    ...(draft.mediaPlan
      ? {
          mediaPlan: {
            specRevision: draft.mediaPlan.specRevision,
            requirements: draft.mediaPlan.requirements,
          },
        }
      : {}),
    ...(draft.moduleDocuments ? { moduleDocuments: draft.moduleDocuments } : {}),
    ...(draft.pinnedModuleRunId ? { pinnedModuleRunId: draft.pinnedModuleRunId } : {}),
    ...(draft.spec === null ? { noSpec: true as const } : {}),
    updatedAt: draft.updatedAt,
  };
  await writeFileAtomic(path.join(specDir, PENGUIN_FILE), json(state));
}

/**
 * `fields` written over the JSON object in `file`: every other key the file has stays, in its
 * place, and a field set to undefined is removed.
 */
async function mergeJsonFile(file: string, fields: Record<string, unknown>): Promise<void> {
  const current = await readJson(file).catch(() => undefined);
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base))
    merged[key] = key in fields ? fields[key] : value;
  for (const [key, value] of Object.entries(fields)) if (!(key in merged)) merged[key] = value;
  for (const [key, value] of Object.entries(merged)) if (value === undefined) delete merged[key];
  await writeFileAtomic(file, json(merged));
}

/**
 * Loom's ref metadata: its product's code as `id`, and the ref's own identity, over what the
 * file has (a Loom ref's copy of its product's fields stays).
 */
export async function writeRefMetadata(specDir: string, ref: RefMetadata): Promise<void> {
  await mergeJsonFile(path.join(specDir, REF_METADATA_FILE), {
    id: ref.productCode,
    title: ref.title,
    moduleFolder: ref.moduleFolder,
    ...(ref.runtime !== undefined ? { runtime: ref.runtime } : {}),
    refNum: ref.refNum,
    displayName: ref.displayName ?? undefined,
    stable: ref.stable,
  });
}

/**
 * Loom's product metadata, and which project owns the product, in the product's `spec/`. What
 * else the file has (Loom's `templateStable`, `runtime`, `deploymentName`, ...) stays.
 */
export async function writeProductFiles(
  spec: string,
  product: ProductMetadata,
  owner: PenguinProductState,
): Promise<void> {
  await mergeJsonFile(path.join(spec, REF_METADATA_FILE), {
    id: product.productCode,
    title: product.title,
    moduleFolder: product.moduleFolder,
    activityType: product.activityType,
    bookMode: product.activityType === "book" && product.bookMode ? product.bookMode : undefined,
    ...(product.runtime !== undefined ? { runtime: product.runtime } : {}),
    canonicalRefNum: product.canonicalRefNum ?? undefined,
    tags: product.tags,
  });
  await writeFileAtomic(path.join(spec, PENGUIN_FILE), json(owner));
}

/** The tags the product's metadata lists; none when it lists none or cannot be read. */
export async function readProductTags(spec: string): Promise<unknown[]> {
  const metadata = (await readJson(path.join(spec, REF_METADATA_FILE)).catch(() => null)) as {
    tags?: unknown;
  } | null;
  return Array.isArray(metadata?.tags) ? metadata.tags : [];
}

/**
 * The module's `configurations/<pc>-<ref>.json` as Loom's empty `{}` when there is none, so
 * Loom lists a ref made here; one already there is left as it is.
 */
export async function ensureConfigurationFile(file: string): Promise<void> {
  if (!(await exists(file))) await writeFileAtomic(file, json({}));
}

/** The product's owner from its `spec/`, or null when no Penguin project owns it yet. */
export async function readProductOwner(spec: string): Promise<PenguinProductState | null> {
  const state = (await readJson(path.join(spec, PENGUIN_FILE))) as PenguinProductState | undefined;
  return state && typeof state === "object" && state.schemaVersion === 1 ? state : null;
}

/** The selected implementation features, or null when none are (or the file is unreadable). */
export async function readFeatureFile(specDir: string): Promise<unknown> {
  return readJson(path.join(specDir, REF_FEATURES_FILE)).catch(() => null);
}

export async function writeFeatureFile(specDir: string, selectedIds: string[]): Promise<void> {
  await writeFileAtomic(path.join(specDir, REF_FEATURES_FILE), json({ selectedIds }));
}
