/**
 * Which images a run generates, and which it leaves alone.
 *
 * Loom's images are SVG written by the coding agent, not raster output from a diffusion
 * model. That makes the skip rules matter more than they would otherwise: an agent pass per
 * image is expensive, and regenerating artwork an author already accepted is worse than
 * expensive — it silently replaces work somebody looked at.
 *
 * The rules are Loom's, out of `generate_images.py`, including the one that is easy to get
 * backwards: a placeholder file counts as absent, because `assets_configuration` seeds
 * every image asset with a shared `empty.jpg` and treating that as generated art skips the
 * whole stage.
 */

/** Generated artwork is SVG. A target with any other extension was uploaded, not generated. */
export const GENERATED_IMAGE_EXTENSION = ".svg";

/**
 * Whether a bound path is a seeded placeholder rather than real artwork.
 *
 * `assets_configuration` binds every image asset to a shared empty file so the module has
 * something to load. Loom matches on the stem being `empty`, so `empty.jpg`, `empty.png`
 * and `empty.svg` all count.
 */
export function isPlaceholderImage(relativePath: string): boolean {
  const name = relativePath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.toLowerCase() === "empty";
}

export interface ImageAssetState {
  key: string;
  /** The description the artwork is drawn from. */
  description: string;
  /** Where the asset is bound, or undefined when it is unbound. */
  path?: string;
  /** Whether a file exists at that path. */
  fileExists: boolean;
  /**
   * The description the existing file was drawn from, when it recorded one. Absent means
   * the file carries no provenance.
   */
  generatedFrom?: string;
}

export type ImageDecision =
  /** Generate it. */
  | { action: "generate"; reason: string }
  /** Leave it alone. */
  | { action: "skip"; reason: string }
  /** Cannot generate: the target is not an SVG, so it was uploaded rather than drawn. */
  | { action: "refuse"; reason: string };

/**
 * What to do about one image asset.
 *
 * The order matters and mirrors Loom's. A placeholder is treated as absent before anything
 * else — otherwise every asset looks generated and the stage does nothing at all.
 */
export function imageDecision(asset: ImageAssetState): ImageDecision {
  if (!asset.path) return { action: "generate", reason: "no file is bound yet" };

  if (isPlaceholderImage(asset.path))
    return {
      action: "generate",
      reason: "the bound file is the seeded placeholder, not artwork",
    };

  const isSvg = asset.path.toLowerCase().endsWith(GENERATED_IMAGE_EXTENSION);

  if (!asset.fileExists) {
    // A missing file is a missing file whatever its extension: there is nothing to keep.
    if (!isSvg)
      return {
        action: "refuse",
        reason: `the bound path ${asset.path} is not an SVG, so it was uploaded rather than drawn; upload a file or clear the path`,
      };
    return { action: "generate", reason: "the bound file is not there" };
  }

  if (!isSvg)
    return {
      action: "skip",
      reason: "the bound file was uploaded rather than drawn, so it is left alone",
    };

  if (asset.generatedFrom === undefined)
    return {
      action: "skip",
      reason: "the existing artwork records no description, so it is not assumed stale",
    };

  if (asset.generatedFrom !== asset.description)
    return {
      action: "generate",
      reason: "the description changed since this artwork was drawn",
    };

  return { action: "skip", reason: "the artwork already matches its description" };
}

export interface ImagePlan {
  generate: string[];
  skip: string[];
  refuse: { key: string; reason: string }[];
}

/** What a run over a whole manifest would do, by asset key. */
export function planImages(assets: readonly ImageAssetState[]): ImagePlan {
  const plan: ImagePlan = { generate: [], skip: [], refuse: [] };
  for (const asset of assets) {
    const decision = imageDecision(asset);
    if (decision.action === "generate") plan.generate.push(asset.key);
    else if (decision.action === "skip") plan.skip.push(asset.key);
    else plan.refuse.push({ key: asset.key, reason: decision.reason });
  }
  return plan;
}

/**
 * One line about what a run will do.
 *
 * A refusal is named, not folded into the skip count. An asset that cannot be generated
 * needs an author to do something; one that is already current does not, and reporting
 * them together hides the difference.
 */
export function describeImagePlan(plan: ImagePlan): string {
  const parts: string[] = [];
  parts.push(
    plan.generate.length === 0
      ? "No artwork needs drawing."
      : `Drawing ${plan.generate.length} ${plan.generate.length === 1 ? "image" : "images"}.`,
  );
  if (plan.skip.length) parts.push(`${plan.skip.length} already current.`);
  if (plan.refuse.length)
    parts.push(
      `${plan.refuse.length} cannot be drawn: ${plan.refuse.map((entry) => entry.key).join(", ")}.`,
    );
  return parts.join(" ");
}

/**
 * Whether a checkpoint should be written after this asset.
 *
 * Loom writes the manifest after every generated image rather than at the end. That is
 * worth keeping: an agent pass per image means a run of twenty images can be interrupted
 * two thirds of the way through, and a manifest written only at the end would throw away
 * thirteen images somebody paid for.
 */
export function checkpointAfterEach(): boolean {
  return true;
}
