/**
 * The hierarchy panel, drawn the way Loom draws it: text rows, thin guides for depth, and
 * the names first. What a row says about its state sits after the name, small: an alert mark
 * for media that still needs a real file, missing or a placeholder (a closed scene carries its
 * children's mark so it is not lost when folded), a section's unsaved edits or invalidity, how
 * many scenes or narrations it holds, and what a section that cannot open yet is waiting
 * for. Scenes go by the script's titles, and a picture or video row leads with a small
 * picture of its file.
 *
 * A row with a target opens it; a row that only groups (a scene's "Audio") folds. A
 * branch with a target does both: its name opens it, its chevron folds it, so reaching
 * the Storyboard never collapses the scenes under it.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Chevron, GlyphIcon, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk, type Tone } from "../../lib/tone";
import { MARK_PATH } from "./journey-header";
import type { MediaPreview } from "./media-preview";
import { MediaThumb } from "./media-thumb";
import type { SceneAssetSelection } from "./scene-asset-tree";
import {
  isCurrent,
  pathTo,
  phaseOfNode,
  type SectionTrail,
  type StudioNode,
  type StudioTarget,
} from "./studio-tree";
import type { WorkspaceSection } from "./workspace-model";

function labelOf(node: StudioNode): string {
  if ("text" in node.label) return node.label.text;
  const key = node.label.key;
  if (key.startsWith("group:"))
    return S.activities.studioTree.groups[
      key.slice(6) as keyof typeof S.activities.studioTree.groups
    ];
  return S.activities.studioTree.rows[key as keyof typeof S.activities.studioTree.rows];
}

/** What hovering a row says: why it will not open, or the id a scene's title stands for. */
function rowHint(node: StudioNode, label: string): string {
  const words = S.activities.studioTree;
  if (node.waitsFor) return words.waitsHelp[node.waitsFor];
  if (node.sceneId && node.sceneNumber !== undefined)
    return words.sceneTitle(node.sceneNumber, label, node.sceneId);
  return label;
}

/** What a marked row's dot means, read at render time so the words follow the locale. */
const MARK_WORDS: Record<NonNullable<StudioNode["mark"]>, () => string> = {
  unbound: () => S.activities.studioTree.needsMedia,
  placeholder: () => S.activities.studioTree.placeholder,
};

const TRAIL_TONE: Record<Exclude<SectionTrail["kind"], "count" | "valid">, Tone> = {
  unsaved: "attention",
  invalid: "danger",
};

/**
 * A section's state beside its name: unsaved edits, validity, or how many it holds. The word
 * is the mark, in its tone. A valid section is the settled case, which the journey's
 * Specification step already shows, so its word goes to a reader only.
 */
function Trail({ trail }: { trail: SectionTrail }) {
  const words = S.activities.studioTree.trail;
  if (trail.kind === "count")
    return (
      <span className="ml-2 shrink-0 text-xs text-gray-400 tabular-nums dark:text-gray-500">
        {trail.count}
      </span>
    );
  if (trail.kind === "valid") return <span className="sr-only">{words.valid}</span>;
  return (
    <span className={`ml-2 shrink-0 text-xs ${toneInk[TRAIL_TONE[trail.kind]]}`}>
      {words[trail.kind]}
    </span>
  );
}

export function StudioTreeView({
  nodes,
  section,
  selection,
  onChoose,
  previewOf,
}: {
  nodes: readonly StudioNode[];
  section: WorkspaceSection;
  selection: SceneAssetSelection | null;
  onChoose: (target: StudioTarget) => void;
  /** What a picture or video row looks like, drawn small before its name. */
  previewOf?: (assetKey: string) => MediaPreview;
}) {
  // Scenes starts open because it is where most of the work is; every other branch
  // starts closed so a thirteen-scene activity still fits the panel.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(["scenes"]));
  const path = useMemo(() => pathTo(nodes, section, selection), [nodes, section, selection]);
  // Whatever the main panel shows is always visible in the tree, however it was chosen.
  useEffect(() => {
    if (!path.length) return;
    setOpened((current) =>
      path.every((id) => current.has(id)) ? current : new Set([...current, ...path]),
    );
  }, [path]);
  function toggle(id: string) {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function row(node: StudioNode, depth: number) {
    const branch = node.children.length > 0;
    const open = branch && opened.has(node.id);
    const current = isCurrent(node, section, selection);
    const label = labelOf(node);
    const words = S.activities.studioTree;
    const hint = rowHint(node, label);
    return (
      <li key={node.id} role="none">
        <div
          className={`group flex items-center rounded-md pr-2 ${
            current
              ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
              : "hover:bg-gray-50 dark:hover:bg-gray-900"
          }`}
          style={{ paddingLeft: `${4 + depth * 14}px` }}
        >
          {branch ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={
                open ? S.activities.studioTree.fold(label) : S.activities.studioTree.unfold(label)
              }
              onClick={() => toggle(node.id)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            >
              <Chevron open={open} size={ICON_SIZE.chevronDense} />
            </button>
          ) : (
            <span aria-hidden className="size-5 shrink-0" />
          )}
          <button
            type="button"
            role="treeitem"
            aria-level={depth + 1}
            aria-current={current ? "true" : undefined}
            aria-disabled={node.disabled || undefined}
            aria-expanded={branch ? open : undefined}
            data-tooltip={hint}
            onClick={() => {
              if (node.disabled) return;
              if (node.target) onChoose(node.target);
              else toggle(node.id);
            }}
            className={`min-w-0 flex-1 truncate py-1 text-left text-xs ${
              depth === 0 ? "font-medium" : ""
            } ${node.disabled ? "cursor-not-allowed text-gray-400 dark:text-gray-600" : ""}`}
          >
            {node.sceneNumber !== undefined && (
              <span
                aria-hidden
                className="mr-1.5 inline-block min-w-3 font-mono text-xs text-gray-400 tabular-nums dark:text-gray-500"
              >
                {node.sceneNumber}
              </span>
            )}
            {previewOf &&
              node.target?.kind === "asset" &&
              (node.assetType === "image" || node.assetType === "video") && (
                <span className="mr-1.5 inline-block h-3.5 w-5 overflow-hidden rounded-sm align-middle">
                  <MediaThumb
                    preview={previewOf(node.target.selection.key)}
                    type={node.assetType}
                    compact
                  />
                </span>
              )}
            {label}
          </button>
          {node.waitsFor && (
            <span aria-hidden className="ml-2 shrink-0 text-xs text-gray-400 dark:text-gray-600">
              {words.waits[node.waitsFor]}
            </span>
          )}
          {node.trail && <Trail trail={node.trail} />}
          {node.mark && (
            <span
              role="img"
              aria-label={MARK_WORDS[node.mark]()}
              data-tooltip={MARK_WORDS[node.mark]()}
              className={`ml-1.5 shrink-0 ${toneInk.attention}`}
            >
              <GlyphIcon d={MARK_PATH.attention} size={ICON_SIZE.rowMark} />
            </span>
          )}
        </div>
        {open && (
          <ul
            role="group"
            className="relative before:absolute before:top-0 before:bottom-1 before:left-[var(--guide)] before:w-px before:bg-gray-200 dark:before:bg-gray-800"
            style={{ ["--guide" as string]: `${14 + depth * 14}px` }}
          >
            {node.children.map((child) => row(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <nav
      aria-label={S.activities.studioTree.label}
      className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
    >
      <ul role="tree" aria-label={S.activities.studioTree.label}>
        {nodes.map((node, index) => {
          const phase = phaseOfNode(node);
          const starts =
            phase !== null && (index === 0 || phase !== phaseOfNode(nodes[index - 1]!));
          return (
            <Fragment key={node.id}>
              {starts && (
                <li
                  role="none"
                  aria-hidden
                  className="px-2 pb-1 pt-3 text-xs font-medium text-gray-400 first:pt-1 dark:text-gray-500"
                >
                  {S.activities.studioTree.phases[phase!]}
                </li>
              )}
              {row(node, 0)}
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
