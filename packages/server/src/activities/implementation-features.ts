/**
 * Loom's implementation features: patterns a shipped module already implements well, which
 * an activity can ask its assembly to reproduce exactly rather than reinvent. Each names
 * the module it comes from, the files to read there, and what must survive into the new
 * module: the symbols its behaviour calls, the selectors its DOM carries, and the style
 * fragments (durations, easing, keyframes) that make it feel the same.
 *
 * The catalogue is Loom's, unchanged, so imported selections keep their meaning. A ref's
 * selection is kept beside its draft, outside its revision, and only the assembly reads it.
 */
import { MODULE_FEATURES_CLAUSE } from "./prompts/module.js";

export interface ImplementationFeature {
  id: string;
  label: string;
  description: string;
  category: string;
  sourceModule: string;
  sourcePaths: string[];
  requiredSymbols: string[];
  requiredSelectors: string[];
  requiredStyleFragments: string[];
}

export const IMPLEMENTATION_FEATURES: readonly ImplementationFeature[] = [
  {
    id: "r2phcs03l-speaker-audio-choices",
    label: "Speaker audio choices",
    description: "Positioned speaker buttons with preview playback and selection states.",
    category: "Interaction",
    sourceModule: "waf-module-r2phcs03L",
    sourcePaths: ["src/helpers.js", "src/sequence.js", "res/style.scss"],
    requiredSymbols: ["createSpeakerButton", "previewSpeakerChoices"],
    requiredSelectors: [".speakers", ".speaker", ".speaker__inner", ".speaker__icon"],
    requiredStyleFragments: [],
  },
  {
    id: "r2phcs03l-freight-conveyor",
    label: "Freight boxes and conveyor",
    description:
      "Freight-box, word-panel, and conveyor composition with the source module's deliberate 3900ms cargo-load speed and uneven five-phase 1.45s belt bump, including replacing the surviving merged-box label with the complete word.",
    category: "Scene composition",
    sourceModule: "waf-module-r2phcs03L",
    sourcePaths: ["src/helpers.js", "src/sequence.js", "res/style.scss"],
    requiredSymbols: [
      "createFreightBox",
      "createWordPanel",
      "blendTruckWord",
      "setConveyorMasksActive",
    ],
    requiredSelectors: [
      ".freight-box",
      ".word-panel",
      ".conveyor",
      ".overlay-layer.is-conveyor-masked",
    ],
    requiredStyleFragments: [
      "animation: word-panel-ride-to-truck 3900ms",
      "animation: scene-2-cargo-bounce 1.45s ease-in-out infinite",
      "24% { transform: translateY(-1.15cqh) rotate(0.65deg); }",
      "48% { transform: translateY(0.18cqh) rotate(-0.3deg); }",
      "70% { transform: translateY(-0.55cqh) rotate(0.2deg); }",
    ],
  },
  {
    id: "vocabwordsreview-final-review-cards",
    label: "Correct-first final review cards",
    description:
      "Response-driven final review that presents correct words first, then models missed words with remediation cards.",
    category: "Final review",
    sourceModule: "waf-module-vocabwordsreview",
    sourcePaths: [
      "src/vocabWordsReview.js",
      "src/correctCard.js",
      "src/wrongCard.js",
      "res/style.scss",
    ],
    requiredSymbols: ["createCorrectCards", "createWrongCards", "playCardSequence"],
    requiredSelectors: [".correctCard", ".wrongCard", ".checkmark", ".textDiv"],
    requiredStyleFragments: [],
  },
];

/** What an assembly run is handed, in its own workspace. */
export const RUN_FEATURES_FILE = "implementation-features.json";

/** The selection as stored: known ids only, in catalogue order, each once. */
export function normalizeFeatureSelection(value: unknown): string[] {
  const wanted = new Set(
    Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
  );
  return IMPLEMENTATION_FEATURES.filter((feature) => wanted.has(feature.id)).map(
    (feature) => feature.id,
  );
}

export function unknownFeatureIds(value: readonly string[]): string[] {
  const known = new Set(IMPLEMENTATION_FEATURES.map((feature) => feature.id));
  return value.filter((id) => !known.has(id));
}

/**
 * The part of the assembly prompt that asks for the selected features: its text is in
 * prompts/module.ts.
 */
export function featureClause(features: readonly ImplementationFeature[]): string {
  if (!features.length) return "";
  const names = features.map((feature) => `${feature.label} (${feature.id})`).join(", ");
  return MODULE_FEATURES_CLAUSE({ names, RUN_FEATURES_FILE });
}
