/**
 * The activity hierarchy, in Loom's shape.
 *
 * Loom navigates an activity through one text tree: the script, the documents generated
 * from it, and the scenes with their media grouped by kind. Authors moving over from Loom
 * know where things are by that tree, so the studio keeps its order and its names rather
 * than inventing new ones. Each row either opens a workspace section or selects an asset;
 * rows for documents Penguin does not produce yet stay in the tree, disabled, so the tree
 * never looks like an activity with fewer parts than Loom showed.
 *
 * Pure: the view draws what this returns and holds no derivation of its own, so the tree,
 * the main panel and the tests cannot disagree about what a row does.
 */
import type { SceneAssetSelection } from "./scene-asset-tree";
import type { SceneAssetTree, SceneAssetType } from "./scene-assets";
import type { WorkspaceSection, WorkspaceSectionEntry } from "./workspace-model";

/** Loom's documents that have no Penguin counterpart yet. */
export type LoomOnlyDocument = "implementationFeatures" | "configurationData" | "assessmentData";

/** What choosing a row does. */
export type StudioTarget =
  | { kind: "section"; section: WorkspaceSection }
  | { kind: "asset"; selection: SceneAssetSelection }
  | { kind: "unavailable"; document: LoomOnlyDocument };

/** The one piece of state a row may carry; the view owns the words and the colour. */
export type StudioMark = "unbound" | null;

export interface StudioNode {
  /** Stable across rebuilds, so open and closed branches survive a refresh. */
  id: string;
  /** A dictionary key for fixed rows, or the activity's own text for scenes and assets. */
  label: { key: StudioLabel } | { text: string };
  /** Absent on a branch that only groups (a scene's "Audios"), which opens instead. */
  target?: StudioTarget;
  disabled: boolean;
  mark: StudioMark;
  children: StudioNode[];
}

/** The fixed rows' names, looked up in the dictionary by the view. */
export type StudioLabel =
  | "activityScript"
  | "activitySpec"
  | LoomOnlyDocument
  | "moduleDefinition"
  | "audios"
  | "scenes"
  | "unassigned"
  | "mediaLibrary"
  | "history"
  | `group:${SceneAssetType}`;

/** Loom lists a scene's media as images, then videos, then audios, then animations. */
const GROUP_ORDER: readonly SceneAssetType[] = ["image", "video", "audio", "animation"];

function sectionRow(
  id: string,
  key: StudioLabel,
  section: WorkspaceSection,
  sections: readonly WorkspaceSectionEntry[],
  children: StudioNode[] = [],
): StudioNode {
  const entry = sections.find((candidate) => candidate.key === section);
  return {
    id,
    label: { key },
    target: { kind: "section", section },
    disabled: !entry?.enabled,
    mark: null,
    children,
  };
}

function unavailableRow(document: LoomOnlyDocument): StudioNode {
  return {
    id: document,
    label: { key: document },
    target: { kind: "unavailable", document },
    disabled: true,
    mark: null,
    children: [],
  };
}

function assetRow(sceneId: string, asset: { key: string; bound: boolean }): StudioNode {
  return {
    id: `asset:${sceneId}:${asset.key}`,
    label: { text: asset.key },
    target: { kind: "asset", selection: { sceneId, key: asset.key } },
    disabled: false,
    mark: asset.bound ? null : "unbound",
    children: [],
  };
}

/** The whole hierarchy, top to bottom, in Loom's order. */
export function buildStudioTree(
  sections: readonly WorkspaceSectionEntry[],
  scenes: SceneAssetTree,
): StudioNode[] {
  const sceneRows: StudioNode[] = scenes.scenes.map((scene) => {
    const groups = GROUP_ORDER.flatMap((type) => {
      const category = scene.categories.find((entry) => entry.type === type);
      if (!category?.assets.length) return [];
      return [
        {
          id: `group:${scene.sceneId}:${type}`,
          label: { key: `group:${type}` as const },
          disabled: false,
          mark: null,
          children: category.assets.map((asset) => assetRow(scene.sceneId, asset)),
        } satisfies StudioNode,
      ];
    });
    return {
      id: `scene:${scene.sceneId}`,
      label: { text: scene.sceneId },
      disabled: false,
      // A scene is marked when anything under it is, so a closed scene still says so.
      mark: groups.some((group) => group.children.some((row) => row.mark)) ? "unbound" : null,
      children: groups,
    };
  });
  if (scenes.unassigned.length)
    sceneRows.push({
      id: "scene:",
      label: { key: "unassigned" },
      disabled: false,
      mark: "unbound",
      children: scenes.unassigned.map((asset) => assetRow("", asset)),
    });
  return [
    sectionRow("script", "activityScript", "description", sections),
    sectionRow("spec", "activitySpec", "specification", sections),
    unavailableRow("implementationFeatures"),
    unavailableRow("configurationData"),
    unavailableRow("assessmentData"),
    sectionRow("module", "moduleDefinition", "module", sections),
    sectionRow("audios", "audios", "speech", sections),
    sectionRow("scenes", "scenes", "scenes", sections, sceneRows),
    sectionRow("library", "mediaLibrary", "library", sections),
    sectionRow("history", "history", "history", sections),
  ];
}

/** Whether a row is the one the main panel is showing. */
export function isCurrent(
  node: StudioNode,
  section: WorkspaceSection,
  selection: SceneAssetSelection | null,
): boolean {
  const target = node.target;
  if (!target) return false;
  if (target.kind === "asset")
    return (
      section === "scenes" &&
      !!selection &&
      selection.sceneId === target.selection.sceneId &&
      selection.key === target.selection.key
    );
  if (target.kind !== "section") return false;
  // With an asset open the Scenes row is its ancestor, not the thing on screen.
  if (target.section === "scenes") return section === "scenes" && !selection;
  return target.section === section;
}

/**
 * The branches that must be open to show the current row, so a selection made elsewhere
 * (a speech coverage link, a picked element in the player) is never hidden in a closed
 * scene.
 */
export function pathTo(
  nodes: readonly StudioNode[],
  section: WorkspaceSection,
  selection: SceneAssetSelection | null,
): string[] {
  for (const node of nodes) {
    if (isCurrent(node, section, selection)) return [];
    const below = pathTo(node.children, section, selection);
    if (below.length || node.children.some((child) => isCurrent(child, section, selection)))
      return [node.id, ...below];
  }
  return [];
}

/**
 * The ids a picked element could be known by, most specific first. Generated modules give a
 * content element its asset key as its id and a label that key plus `__label`
 * (the `waf-element-ids` skill), so both the id and its stem are worth trying, then the
 * tap target the element belongs to.
 */
export function pickCandidates(pick: {
  id: string | null;
  interactableId: string | null;
}): string[] {
  const out: string[] = [];
  for (const value of [pick.id, pick.interactableId]) {
    if (!value) continue;
    const stem = value.split("__")[0]!;
    for (const candidate of [value, stem])
      if (candidate && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * The asset a picked element shows, or null when nothing in the hierarchy is named the way
 * it is. The scene the player reports being in is searched first, since a key reused across
 * scenes should open where the author is looking; ids are case-sensitive, because in a
 * letters activity `P` and `p` are different assets.
 */
export function assetForPick(
  scenes: SceneAssetTree,
  sceneId: string | null,
  pick: { id: string | null; interactableId: string | null },
): SceneAssetSelection | null {
  const ordered = [
    ...scenes.scenes.filter((scene) => scene.sceneId === sceneId),
    ...scenes.scenes.filter((scene) => scene.sceneId !== sceneId),
  ];
  for (const candidate of pickCandidates(pick)) {
    for (const scene of ordered)
      for (const category of scene.categories)
        if (category.assets.some((asset) => asset.key === candidate))
          return { sceneId: scene.sceneId, key: candidate };
    if (scenes.unassigned.some((asset) => asset.key === candidate))
      return { sceneId: "", key: candidate };
  }
  return null;
}
