/**
 * Reading a product Loom authored in a module, for a project to adopt in place.
 *
 * Read-only: this opens a module's `generated/` files and reports what it found, and never
 * writes. Adopting (service.claimModuleProduct) is what then gives each ref WAF Harness's own
 * files beside Loom's.
 *
 *     <wafRoot>/modules/<moduleFolder>/generated/<productCode>/   (see waf-layout.ts)
 *       spec/activity_metadata.json      product: canonical ref, type, templateStable
 *       spec/wafh.json                which WAF Harness project owns it, once one does
 *       spec/state-machine.json          the canonical product machine
 *       refs/<productCode>-<refNum>/spec/
 *         activity_metadata.json         ref: number, display name
 *         activity_spec.json             scenes
 *         asset_manifest.json            media, keyed by language
 *         activity_description.txt       what an author typed
 *         state-machine.json             this ref's machine
 */
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeFeatureSelection } from "./implementation-features.js";
import {
  REF_DESCRIPTION_FILE,
  REF_FEATURES_FILE,
  REF_MANIFEST_FILE,
  REF_METADATA_FILE,
  REF_SPEC_FILE,
  STATE_MACHINE_FILE,
} from "./ref-files.js";
import {
  childFolders,
  parseRefFolderName,
  type ModuleLayout,
  type WafLayout,
} from "./waf-layout.js";

/** What a product's metadata says, with Loom's names translated to WAF Harness's. */
export interface LoomProductMetadata {
  productCode: string;
  moduleFolder: string;
  title: string | null;
  canonicalRefNum: number | null;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
  /** Loom's product-level `templateStable`: whether new refs may be made from the canonical one. */
  templateStable: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const asRefNum = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function mapProductMetadata(
  productCode: string,
  moduleFolder: string,
  json: unknown,
): LoomProductMetadata {
  const record = asRecord(json);
  const type = asString(record["activityType"]) ?? asString(record["type"]);
  const bookMode = asString(record["bookMode"]);
  return {
    productCode,
    // Where the files are is where WAF Harness reads and writes them, whatever an older copy of
    // the folder's name in the file says.
    moduleFolder,
    title: asString(record["title"]),
    canonicalRefNum: asRefNum(record["canonicalRefNum"]),
    activityType: type === "book" ? "book" : "standard",
    bookMode: bookMode === "decodable" || bookMode === "readAlong" ? bookMode : null,
    templateStable: record["templateStable"] === true,
  };
}

/**
 * What a ref's metadata says. Stability is not read here: Loom keeps `templateStable` on the
 * product, and a ref's copy of it is a stale snapshot (see readLoomRef).
 */
export interface LoomRefMetadata {
  refNum: number | null;
  title: string | null;
  displayName: string | null;
  stable: boolean;
}

export function mapRefMetadata(json: unknown): LoomRefMetadata {
  const record = asRecord(json);
  return {
    refNum: asRefNum(record["refNum"]),
    title: asString(record["title"]),
    displayName: asString(record["displayName"]),
    stable: false,
  };
}

/** One ref as read off disk, with whatever was missing named rather than filled in. */
export interface LoomRef extends LoomRefMetadata {
  refNum: number;
  canonical: boolean;
  spec: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
  description: string;
  hasStateMachine: boolean;
  /** Loom's implementation features this ref selected, known ones only. */
  implementationFeatures: string[];
  /** Languages the manifest holds, which is how multi-language arrives from Loom. */
  languages: string[];
  /** What could not be read. An empty list means a complete ref. */
  problems: string[];
}

export interface LoomProductRead {
  product: LoomProductMetadata;
  refs: LoomRef[];
  /** The canonical machine sits here; a ref copy appears only after implementation. */
  hasProductStateMachine: boolean;
  problems: string[];
}

/** Reads a JSON file, or reports why it could not. Never throws for a missing file. */
async function readJson(
  file: string,
  problems: string[],
  label: string,
): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      problems.push(`${label} could not be read: ${(error as Error).message}`);
    else problems.push(`${label} is missing.`);
    return null;
  }
  try {
    return asRecord(JSON.parse(text));
  } catch (error) {
    problems.push(`${label} is not valid JSON: ${(error as Error).message}`);
    return null;
  }
}

/** The language groups a Loom asset manifest holds, in a stable order. */
export function manifestLanguages(manifest: Record<string, unknown> | null): string[] {
  const assets = manifest?.["assets"];
  // Loom's manifest allows either a flat list or a map keyed by language; a flat list is
  // the default language only.
  if (Array.isArray(assets)) return ["en-US"];
  return Object.keys(asRecord(assets)).sort();
}

/** Reads one ref. Returns what it has plus what is missing; never writes. */
export async function readLoomRef(
  module: ModuleLayout,
  product: LoomProductMetadata,
  refNum: number,
): Promise<LoomRef> {
  const specDir = module.refSpecDir(product.productCode, refNum);
  const file = (name: string) => path.join(specDir, name);
  const problems: string[] = [];
  const metadata = mapRefMetadata(
    await readJson(file(REF_METADATA_FILE), problems, "Ref metadata"),
  );
  const spec = await readJson(file(REF_SPEC_FILE), problems, "Activity specification");
  const manifest = await readJson(file(REF_MANIFEST_FILE), problems, "Asset manifest");
  let description = "";
  try {
    description = await fs.readFile(file(REF_DESCRIPTION_FILE), "utf8");
  } catch (error) {
    // A description is what an author typed before generating; an activity imported
    // without one is still usable, so this is a note rather than a failure.
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      problems.push("Activity description is missing.");
    else problems.push(`Activity description could not be read: ${(error as Error).message}`);
  }
  // NOT a problem when absent. Measured against the real Loom tree: 84 of 85 refs have no
  // ref-level machine. Loom keeps the canonical machine on the PRODUCT and only
  // materialises it down to a ref when implement_behavior runs, so an absent ref machine
  // is the normal state of an activity nobody has implemented behaviour for yet.
  const hasStateMachine = await fs
    .stat(file(STATE_MACHINE_FILE))
    .then((stat) => stat.isFile())
    .catch(() => false);
  // Optional in Loom: most refs select no features, and then the file is never written.
  const features: unknown = await fs
    .readFile(file(REF_FEATURES_FILE), "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => null);
  const implementationFeatures = normalizeFeatureSelection(
    (features as { selectedIds?: unknown } | null)?.selectedIds,
  );
  return {
    ...metadata,
    refNum,
    // The canonical ref is the template; the product says whether it is stable.
    stable: product.canonicalRefNum === refNum && product.templateStable,
    canonical: product.canonicalRefNum === refNum,
    spec,
    manifest,
    description,
    hasStateMachine,
    implementationFeatures,
    languages: manifestLanguages(manifest),
    problems,
  };
}

/** Reads one product and every ref beneath it. Never writes. */
export async function readLoomProduct(
  checkout: WafLayout,
  moduleFolder: string,
  productCode: string,
): Promise<LoomProductRead> {
  const problems: string[] = [];
  const module = checkout.module(moduleFolder);
  const productSpec = module.productSpecDir(productCode);
  const product = mapProductMetadata(
    productCode,
    moduleFolder,
    await readJson(path.join(productSpec, REF_METADATA_FILE), problems, "Product metadata"),
  );
  const refsDir = module.refsDir(productCode);
  const hasRefs = await fs
    .stat(refsDir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (!hasRefs) problems.push("This product has no refs directory.");
  const entries = hasRefs ? await childFolders(refsDir) : [];
  const refNums = entries
    .map((name) => parseRefFolderName(productCode, name))
    .filter((refNum): refNum is number => refNum !== null)
    .sort((a, b) => a - b);
  const refs = await Promise.all(refNums.map((refNum) => readLoomRef(module, product, refNum)));
  if (refs.length && !refs.some((ref) => ref.canonical))
    problems.push(
      product.canonicalRefNum === null
        ? "Product metadata names no canonical ref."
        : `Product metadata names ref ${product.canonicalRefNum} as canonical, but no such ref exists.`,
    );
  // Where the behaviour contract lives. The product machine is the canonical one; a ref
  // gets its own copy only once implement_behavior has run for it.
  const hasProductStateMachine = await fs
    .stat(path.join(productSpec, STATE_MACHINE_FILE))
    .then((stat) => stat.isFile())
    .catch(() => false);
  if (!hasProductStateMachine && !refs.some((ref) => ref.hasStateMachine))
    problems.push("Neither this product nor any of its refs has a state machine.");
  return { product, refs, problems, hasProductStateMachine };
}
