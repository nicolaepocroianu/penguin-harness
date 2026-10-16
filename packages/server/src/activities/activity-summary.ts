/**
 * What the Activities home says about one ref: how far along it is and the one thing
 * worth knowing now. Three milestones — the facts the studio already gates its sections
 * on — rather than the nine pipeline stages, which nothing running computes per activity.
 * Type-only imports, so the web can read these types without pulling in services.
 */
import type { ActivityRun } from "./domain.js";
import type { MediaAsset } from "./media.js";

export type SummaryMilestone = "spec" | "mediaPlan" | "module";
export const SUMMARY_MILESTONES: readonly SummaryMilestone[] = ["spec", "mediaPlan", "module"];

export type ActivitySummaryStatus =
  | { kind: "running"; runKind: ActivityRun["kind"] }
  | { kind: "stale"; what: "mediaPlan" }
  | { kind: "built" }
  | { kind: "next"; milestone: SummaryMilestone };

/**
 * The picture the list shows for a ref: the first image or video its scenes use that has a
 * real file, in the specification's scene order. Only what names the file is carried; the App
 * decodes the picture from wherever the file plays, as its other posters do, so nothing about
 * it is stored. An asset bound to the stand-in clip is passed over: it would picture every
 * activity alike.
 */
export interface ActivityPoster {
  language: string;
  asset: Pick<MediaAsset, "key" | "type" | "path" | "generatedImage" | "generatedVideo">;
}

export interface ActivitySummary {
  canonical: boolean;
  /** Any media plan, current or not: what a new ref copies, so the New ref card waits for it. */
  hasPlan: boolean;
  done: number;
  total: number;
  status: ActivitySummaryStatus;
  /** Null when no scene has a picture or video with a real file yet. */
  poster: ActivityPoster | null;
}

export interface SummaryFacts {
  canonical: boolean;
  specValid: boolean;
  plan: "none" | "current" | "stale";
  hasModule: boolean;
  runningKind: ActivityRun["kind"] | null;
  poster?: ActivityPoster | null;
}

export function summarize(facts: SummaryFacts): ActivitySummary {
  const reached: Record<SummaryMilestone, boolean> = {
    spec: facts.specValid,
    mediaPlan: facts.plan === "current",
    module: facts.hasModule,
  };
  const done = SUMMARY_MILESTONES.filter((milestone) => reached[milestone]).length;
  const missing = SUMMARY_MILESTONES.find((milestone) => !reached[milestone]);
  // Precedence: live work, then something that needs redoing, then finished, then next.
  const status: ActivitySummaryStatus = facts.runningKind
    ? { kind: "running", runKind: facts.runningKind }
    : facts.plan === "stale"
      ? { kind: "stale", what: "mediaPlan" }
      : missing
        ? { kind: "next", milestone: missing }
        : { kind: "built" };
  return {
    canonical: facts.canonical,
    hasPlan: facts.plan !== "none",
    done,
    total: SUMMARY_MILESTONES.length,
    status,
    poster: facts.poster ?? null,
  };
}

/** The language a poster is read in: American English where the plan has it, else its first. */
function posterLanguage(assets: Readonly<Record<string, readonly MediaAsset[]>>): string | null {
  if (assets["en-US"]) return "en-US";
  return Object.keys(assets)[0] ?? null;
}

/** The specification's scene ids, in its order: `scenes`, or `stages` in older ones. */
function sceneIdsOf(spec: unknown): string[] {
  const record = spec && typeof spec === "object" ? (spec as Record<string, unknown>) : null;
  const list = Array.isArray(record?.scenes)
    ? record.scenes
    : Array.isArray(record?.stages)
      ? record.stages
      : [];
  return list.flatMap((scene) => {
    const id = scene && typeof scene === "object" ? (scene as Record<string, unknown>).id : null;
    return typeof id === "string" ? [id] : [];
  });
}

/**
 * The ref's poster (see ActivityPoster): scene by scene in the specification's order, the
 * plan's first picture or video there with a file other than a placeholder.
 */
export function posterOf(
  assets: Readonly<Record<string, readonly MediaAsset[]>> | undefined,
  spec: unknown,
  placeholders: ReadonlySet<string>,
): ActivityPoster | null {
  if (!assets) return null;
  const language = posterLanguage(assets);
  if (!language) return null;
  const pictures = (assets[language] ?? []).filter(
    (asset) =>
      (asset.type === "image" || asset.type === "video") &&
      !!asset.path &&
      !placeholders.has(asset.path),
  );
  for (const sceneId of sceneIdsOf(spec)) {
    const found = pictures.find((asset) => asset.usages.some((usage) => usage.sceneId === sceneId));
    if (found)
      return {
        language,
        asset: {
          key: found.key,
          type: found.type,
          path: found.path,
          ...(found.generatedImage ? { generatedImage: found.generatedImage } : {}),
          ...(found.generatedVideo ? { generatedVideo: found.generatedVideo } : {}),
        },
      };
  }
  return null;
}
