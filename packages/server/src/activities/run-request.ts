import type { AssistFocus } from "./assist.js";
import type { AcceptanceStage } from "./acceptance-types.js";

/** One asset of the media plan, in one language. */
export interface RunAssetRequest {
  language: string;
  assetKey: string;
}

/**
 * What a run is asked to do, told apart by `kind`. Speech and sound both record an `audio`
 * run; every other request records a run of its own kind.
 */
export type RunRequest =
  /** The first specification pass, or one run again, told why the attempt before failed. */
  | { kind: "spec"; repair?: string }
  /** The media pass: list the media the scenes' tags ask for (`generate_media_spec`). */
  | { kind: "media-spec"; repair?: string }
  /** The module assembled from the specification; a book names its reading mode. */
  | { kind: "module"; bookMode?: string }
  /**
   * A narration run: its voice, and the provider (Gemini, or the narration's own, when
   * absent) and model that speak it.
   */
  | {
      kind: "speech";
      speech: RunAssetRequest & { voice: string; provider?: string; model?: string };
    }
  /** A music or sound-effect run for one asset, made by the named provider. */
  | { kind: "sound"; sound: RunAssetRequest & { provider: string; model?: string } }
  | { kind: "image"; image: RunAssetRequest }
  | { kind: "media-text"; mediaText: RunAssetRequest & { translate?: boolean } }
  /** An assist run: the author's first message and what they had open. */
  | { kind: "assist"; assist: { message: string; focus: AssistFocus | null } }
  /**
   * An assessment run on the canonical ref of a specification that uses one, given the
   * assessment in effect now (the author's edit, else the module's own; null for none).
   */
  | { kind: "assessment"; assessment: { current: Record<string, unknown> | null } }
  /**
   * An acceptance test run, prepared by the acceptance service: what to test, where, and
   * an earlier run's tests when they fit the same criteria.
   */
  | { kind: "test"; test: AcceptanceStage }
  /** Sounds for a decodable book's words, proposed by a model for the author to accept. */
  | { kind: "phonemes"; phonemes: { language: string; words: unknown } }
  /**
   * An animated composition of a video or animation asset's scene, from its description
   * and bound images (experimental: refused while `activityVideoExperiment` is off).
   */
  | { kind: "composition"; composition: RunAssetRequest & { look?: string } }
  /** An agent refining a video or animation's timeline (experimental). */
  | { kind: "timeline"; timeline: RunAssetRequest }
  /** An agent critiquing a video or animation's newest recording (experimental). */
  | { kind: "critique"; critique: RunAssetRequest };

export type RunRequestKind = RunRequest["kind"];

/** The request of one kind. */
export type RunRequestOf<Kind extends RunRequestKind> = Extract<RunRequest, { kind: Kind }>;
