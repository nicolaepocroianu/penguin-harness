/**
 * Narration as the script tells it: each line under the scene that says it, the scenes in
 * the specification's order, and the lines of a scene in the order the script says them.
 * Lines the plan gives no scene follow at the end, so none is ever hidden.
 *
 * The plan does not point back into the script, so a line's place is found by its words,
 * the way the script's clip chips find theirs: the narration's script against the words of
 * the scene's audio elements. A line the script does not say keeps its place in the plan,
 * after the ones it does.
 */
import { elementText, normalizeWords } from "./script-media";
import { mediaElementSpans, type ScriptScene } from "./script-model";
import type { SceneAssetTree } from "./scene-assets";
import { scriptSceneFor } from "./studio-tree";

export interface NarrationScene<T> {
  /** The scene's id in the specification; empty for the lines no scene uses. */
  sceneId: string;
  /** The script's title for the scene, or null when the script names no such scene. */
  title: string | null;
  /** The scene's number in the script, or null when the script names no such scene. */
  number: number | null;
  /** A scene of shared media rather than a step of the activity. */
  general: boolean;
  rows: T[];
}

/** The words a scene's narration says, in the script's order. */
function spokenLines(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    mediaElementSpans(line)
      .filter((span) => span.element === "audio")
      .map((span) => normalizeWords(elementText(line.slice(span.from, span.to)))),
  );
}

/**
 * Group rows by scene. A line several scenes use is listed once, under the first of them,
 * so a scene's count and a run through every scene each say it once. With `every`, it is
 * listed under each scene that says it instead, for a view of one scene at a time (the
 * player's), where a line missing from its scene would never light up there.
 */
export function narrationScenes<T extends { key: string; sceneIds: readonly string[] }>(
  rows: readonly T[],
  tree: SceneAssetTree,
  script: { text: string; scenes: readonly ScriptScene[] },
  wordsOf: (key: string) => string | undefined,
  { every = false }: { every?: boolean } = {},
): NarrationScene<T>[] {
  const lines = script.text.replace(/\r\n/g, "\n").split("\n");
  const place = new Map(tree.scenes.map((scene, index) => [scene.sceneId, index]));
  const groups: NarrationScene<T>[] = tree.scenes.map((scene) => {
    const named = scriptSceneFor(scene.sceneId, script.scenes);
    return {
      sceneId: scene.sceneId,
      title: named?.title ?? null,
      number: named?.number ?? null,
      general: scene.general,
      rows: [],
    };
  });
  const unplaced: T[] = [];
  for (const row of rows) {
    const homes = [
      ...new Set(
        row.sceneIds
          .map((sceneId) => place.get(sceneId))
          .filter((index): index is number => index !== undefined),
      ),
    ].sort((left, right) => left - right);
    if (!homes.length) unplaced.push(row);
    else for (const home of every ? homes : homes.slice(0, 1)) groups[home]!.rows.push(row);
  }
  for (const group of groups) {
    const named = scriptSceneFor(group.sceneId, script.scenes);
    if (!named || group.rows.length < 2) continue;
    // `heading` is the heading's 1-based line, so the body starts at that index.
    const said = spokenLines(lines.slice(named.heading, named.last));
    const at = (row: T) => {
      const index = said.indexOf(normalizeWords(wordsOf(row.key) ?? ""));
      return index < 0 ? said.length : index;
    };
    // A stable sort, so lines the script does not say keep the plan's order among themselves.
    group.rows.sort((left, right) => at(left) - at(right));
  }
  return [
    ...groups.filter((group) => group.rows.length > 0),
    ...(unplaced.length
      ? [{ sceneId: "", title: null, number: null, general: false, rows: unplaced }]
      : []),
  ];
}
