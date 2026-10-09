/**
 * The Activity Script editor: one monospace surface where scenes fold to
 * their headings, media elements read as narration and footage rather than markup, and a diff
 * against a chosen base is drawn in place rather than in a second view.
 *
 * There are two bases. "Last save" is the author's own edits, each change revertible where it
 * stands. "Agent proposal" swaps in the proposed script for review: each change the agent made
 * can be accepted or rejected where it stands, and what is left once the author is done is what
 * gets applied. Changes left undecided count as accepted, since the proposal is what put them
 * there. The author's editor state is kept aside meanwhile, undo history and all, and comes back
 * untouched. A draft keeps no history, so there is no base older than the last save.
 *
 * CodeMirror owns the document while the author types; `value` is pushed in only when it
 * changes from outside, as after a reload or an accepted proposal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  codeFolding,
  foldAll,
  foldGutter,
  foldKeymap,
  foldService,
  foldedRanges,
  unfoldAll,
  unfoldEffect,
} from "@codemirror/language";
import {
  getChunks,
  getOriginalDoc,
  goToNextChunk,
  goToPreviousChunk,
  unifiedMergeView,
} from "@codemirror/merge";
import { search, searchKeymap } from "@codemirror/search";
import { Button } from "../../components/ui/button";
import { ChipGroup } from "../../components/ui/chip-group";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import {
  mediaContext,
  proposedScenes,
  sceneFold,
  scenesOf,
  scriptDecorations,
} from "./script-decorations";
import { scriptFigures, type ScriptMedia } from "./script-media";
import { diffMarkers, sceneRanges, scenesTouched } from "./script-model";
import { diffLines, diffStats } from "./spec-diff";

export type ScriptDiffBase = "off" | "saved" | "proposal";

/**
 * "read" keeps the text focusable and selectable, so an author can still copy out of a
 * draft they can no longer save; "disabled" is a draft they may not touch at all.
 */
export type ScriptAccess = "edit" | "read" | "disabled";

/** Where a proposal's review stands: changes the author has not decided yet, of how many. */
export interface ScriptReview {
  left: number;
  total: number;
}

function accessExtensions(access: ScriptAccess) {
  return [
    EditorState.readOnly.of(access !== "edit"),
    EditorView.editable.of(access !== "disabled"),
    EditorView.contentAttributes.of(access === "read" ? { "aria-readonly": "true" } : {}),
  ];
}

/** What every state of this editor shares, author's or proposal's. */
function common() {
  return [
    history(),
    codeFolding({ placeholderText: "…" }),
    foldGutter(),
    foldService.of(sceneFold),
    scriptDecorations,
    search({ top: true }),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": S.activities.studioScript.label }),
    // The editor's own words (search, folding, merge controls) in the app's dictionary.
    EditorState.phrases.of(S.activities.studioScript.editorPhrases),
    keymap.of([
      { key: "Alt-ArrowDown", run: goToNextChunk },
      { key: "Alt-ArrowUp", run: goToPreviousChunk },
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
    ]),
  ];
}

/** Never a real setting, so a comparison against it always writes. */
const STALE = "\u0000stale";

/** Unchanged stretches longer than this fold away in a diff, leaving a few lines of context. */
export const COLLAPSE = { margin: 3, minSize: 8 };

function controlButton(className: string, label: string, action: (event: MouseEvent) => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  // A press acts on mouse down, before the editor can take it as a cursor move. Enter and
  // Space reach a button only as a click with no pointer behind it (detail 0), so that click
  // acts too, and a mouse's own click, which follows its mouse down, does not act twice.
  button.onmousedown = action;
  button.onclick = (event) => {
    if (event.detail === 0) action(event);
  };
  return button;
}

export function savedDiff(saved: string, editable: boolean) {
  return unifiedMergeView({
    original: saved,
    gutter: true,
    collapseUnchanged: COLLAPSE,
    // Only "revert" means anything against the last save: accepting an edit into the saved
    // text is what Save does, for the whole script at once.
    mergeControls: editable
      ? (type, action) =>
          type === "accept"
            ? document.createElement("span")
            : controlButton("cm-revert", S.activities.studioScript.revert, action)
      : false,
  });
}

/** Each of the agent's changes, with Accept and Reject where it stands. */
function proposalReview(original: string, decided: (verdict: "accept" | "reject") => void) {
  const words = S.activities.studioScript;
  return unifiedMergeView({
    original,
    gutter: true,
    collapseUnchanged: COLLAPSE,
    mergeControls: (type, action) =>
      controlButton(
        type === "accept" ? "cm-review-accept" : "cm-review-reject",
        type === "accept" ? words.acceptChange : words.rejectChange,
        (event) => {
          action(event);
          decided(type);
        },
      ),
  });
}

/** How many changes a review state still holds. */
function chunksLeft(state: EditorState): number {
  return getChunks(state)?.chunks.length ?? 0;
}

/**
 * A review set aside, to pick up where the author left it: the proposal and script it was
 * made against, the text it has come to, the original with the accepted changes in it, and
 * what was decided. Held by the page, so it outlives the editor when another section opens.
 */
export interface SavedReview {
  proposal: string;
  value: string;
  text: string;
  original: string;
  total: number;
  rejected: number;
}

/** A review in progress: the text it has come to, and what the author decided so far. */
interface ReviewState {
  text: string;
  left: number;
  total: number;
  rejected: number;
}

/** What the review strip says, by how far the review has come. */
function reviewSummary(review: ReviewState, nothingKept: boolean): string {
  const words = S.activities.studioScript;
  if (review.left) return words.reviewLeft(review.left, review.total);
  if (nothingKept) return words.reviewNoneKept;
  return words.reviewDone(review.total - review.rejected, review.total);
}

/** "about 2 min 55 s" of narration, or seconds alone under a minute. */
function narrationText(seconds: number): string {
  const words = S.activities.studioScript.status;
  if (seconds < 60) return words.narrationSeconds(seconds);
  return words.narrationMinutes(Math.floor(seconds / 60), seconds % 60);
}

export function ScriptEditor({
  value,
  saved,
  proposal,
  access,
  canSave,
  saveDisabled,
  status = null,
  acceptBlocked,
  reveal = null,
  review: reviewRequest = null,
  media = null,
  onChange,
  onSave,
  onAcceptProposal,
  onApplyReviewed,
  onDiscardProposal,
  onOpenClip,
  onReview,
  memory,
}: {
  value: string;
  /** The script as last saved. */
  saved: string;
  /** The open proposal's script, when the agent proposed one that differs from the draft. */
  proposal: string | null;
  access: ScriptAccess;
  /** Whether this author may save at all, which shows the Save action. */
  canSave: boolean;
  saveDisabled: boolean;
  /** Where saving stands, in words: pending, saving, saved or failed. */
  status?: string | null;
  /** Why the proposal cannot be accepted right now, if it cannot. */
  acceptBlocked: string | null;
  /** A scene to bring into view, by its number in the script; `at` repeats a request. */
  reveal?: { scene: number; at: number } | null;
  /** Open the proposal for review, at a scene when one is given; `at` repeats a request. */
  review?: { scene?: number; at: number } | null;
  /** What the media plan says about the script's elements and scenes. */
  media?: ScriptMedia | null;
  onChange: (value: string) => void;
  onSave: () => void;
  /** Apply the whole proposed script, as the agent wrote it. */
  onAcceptProposal?: () => void;
  /** Apply the script as the review left it: accepted changes in, rejected ones out. */
  onApplyReviewed?: (text: string) => void;
  /** Set the proposal aside, when every change was rejected. */
  onDiscardProposal?: () => void;
  /** Open a clip's asset, from the chip at the end of its line. */
  onOpenClip?: (key: string) => void;
  /** Where the review stands, or null when no proposal is being reviewed. */
  onReview?: (review: ScriptReview | null) => void;
  /** Where a review is kept while it is set aside, so leaving it loses no decision. */
  memory?: { current: SavedReview | null };
}) {
  const words = S.activities.studioScript;
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The author's own state, set aside while the proposal is shown in its place.
  const stash = useRef<EditorState | null>(null);
  const applied = useRef({ base: STALE, saved: STALE, access: STALE, hints: STALE });
  const appliedMedia = useRef<unknown>(STALE);
  const compartments = useRef({
    diff: new Compartment(),
    access: new Compartment(),
    hints: new Compartment(),
    media: new Compartment(),
  }).current;
  const latest = useRef({ value, onChange, onReview });
  latest.current = { value, onChange, onReview };

  const [choice, setChoice] = useState<ScriptDiffBase>("off");
  const base: ScriptDiffBase = choice === "proposal" && proposal === null ? "off" : choice;
  const [folded, setFolded] = useState(false);
  const [cursorLine, setCursorLine] = useState(1);
  // The review in progress: the text it has come to, and what the author decided so far.
  const [review, setReview] = useState<ReviewState | null>(null);
  // The same, readable when the review is set aside, and what the review was made against.
  const reviewNow = useRef<ReviewState | null>(null);
  reviewNow.current = review;
  const reviewBasis = useRef<{ proposal: string; value: string } | null>(null);
  // A scene to show once the proposal's state is in place.
  const reviewScene = useRef<number | null>(null);

  /** Keep the review the view holds, before it is put away. */
  function rememberReview(view: EditorView) {
    const basis = reviewBasis.current;
    const current = reviewNow.current;
    if (!memory || !basis || !current) return;
    memory.current = {
      ...basis,
      text: view.state.doc.toString(),
      original: getOriginalDoc(view.state).toString(),
      total: current.total,
      rejected: current.rejected,
    };
  }

  // What the diff reads: the base's text against the text the editor shows.
  const [before, after] =
    base === "proposal" ? [value, proposal ?? ""] : base === "saved" ? [saved, value] : ["", ""];
  const rows = useMemo(
    () => (base === "off" ? [] : diffLines(before, after)),
    [base, before, after],
  );
  const stats = useMemo(() => diffStats(rows), [rows]);
  const shownScenes = useMemo(() => sceneRanges(after), [after]);
  const changed = useMemo(() => scenesTouched(rows, shownScenes), [rows, shownScenes]);
  const markers = useMemo(() => diffMarkers(rows, after.split("\n").length), [rows, after]);
  // Headings the proposal would change, marked while the author works on their own text.
  const hinted = useMemo(
    () =>
      proposal === null || base === "proposal"
        ? []
        : scenesTouched(diffLines(value, proposal), sceneRanges(proposal)),
    [proposal, base, value],
  );
  const figures = useMemo(() => scriptFigures(value), [value]);
  const scenes = useMemo(() => sceneRanges(value), [value]);
  const cursorScene = scenes.find(
    (scene) => scene.heading <= cursorLine && cursorLine <= scene.last,
  );

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          common(),
          compartments.diff.of([]),
          compartments.access.of([]),
          compartments.hints.of([]),
          compartments.media.of([]),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged)
              setCursorLine(update.state.doc.lineAt(update.state.selection.main.head).number);
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            if (text !== latest.current.value) latest.current.onChange(text);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      // Opening another section takes the editor away; a review in progress is kept.
      if (stash.current) rememberReview(view);
      view.destroy();
      viewRef.current = null;
    };
    // rememberReview reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compartments]);

  const mediaExtension = useMemo(
    () => mediaContext.of({ media, open: onOpenClip ?? null }),
    [media, onOpenClip],
  );

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (base === "proposal") {
      // Already reviewing, and rebuilt for a new setting: carry the decisions over.
      if (stash.current) rememberReview(view);
      else stash.current = view.state;
      const decided = (verdict: "accept" | "reject") => {
        if (verdict === "reject")
          setReview((current) =>
            current ? { ...current, rejected: current.rejected + 1 } : current,
          );
      };
      // The review the author set aside, if it was made against this proposal and this script.
      const kept = memory?.current;
      const resume = kept && kept.proposal === proposal && kept.value === value ? kept : null;
      reviewBasis.current = { proposal: proposal ?? "", value };
      view.setState(
        EditorState.create({
          doc: resume?.text ?? proposal ?? "",
          extensions: [
            common(),
            mediaExtension,
            // Read-only to typing; the review's own controls are what change it.
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            proposalReview(resume?.original ?? value, decided),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged && !update.transactions.length) return;
              const left = chunksLeft(update.state);
              const text = update.state.doc.toString();
              setReview((current) => (current ? { ...current, left, text } : current));
            }),
          ],
        }),
      );
      const left = chunksLeft(view.state);
      setReview({
        text: view.state.doc.toString(),
        left,
        total: resume?.total ?? left,
        rejected: resume?.rejected ?? 0,
      });
      if (reviewScene.current !== null) {
        const scene = scenesOf(view.state.doc).list.find(
          (entry) => entry.number === reviewScene.current,
        );
        reviewScene.current = null;
        if (scene) goTo(scene.heading);
      }
      return;
    }
    setReview(null);
    if (stash.current) {
      rememberReview(view);
      view.setState(stash.current);
      stash.current = null;
      // The stashed state carries whatever was configured when it was set aside, so
      // nothing it holds can be assumed current: mark every setting as needing a write.
      applied.current = { base: STALE, saved: STALE, access: STALE, hints: STALE };
      appliedMedia.current = STALE;
    }
    if (view.state.doc.toString() !== value)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    const last = applied.current;
    if (last.base !== base || last.saved !== saved || last.access !== access) {
      // A merge view takes its original once, when it is configured; a new base needs a
      // fresh one, so the old is taken out before the new goes in.
      view.dispatch({ effects: compartments.diff.reconfigure([]) });
      view.dispatch({
        effects: [
          compartments.diff.reconfigure(
            base === "saved" ? savedDiff(saved, access === "edit") : [],
          ),
          compartments.access.reconfigure(accessExtensions(access)),
        ],
      });
    }
    const hints = hinted.join(",");
    if (last.hints !== hints)
      view.dispatch({ effects: compartments.hints.reconfigure(proposedScenes.of(hinted)) });
    if (appliedMedia.current !== mediaExtension) {
      view.dispatch({ effects: compartments.media.reconfigure(mediaExtension) });
      appliedMedia.current = mediaExtension;
    }
    applied.current = { base, saved, access, hints };
    // goTo reads only the view, which the ref holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, proposal, saved, value, access, hinted, compartments, mediaExtension]);

  // The page hears where the review stands, so the chat's proposal card can say it too.
  const reviewLeft = review?.left ?? null;
  const reviewTotal = review?.total ?? null;
  useEffect(() => {
    latest.current.onReview?.(
      reviewLeft === null || reviewTotal === null ? null : { left: reviewLeft, total: reviewTotal },
    );
  }, [reviewLeft, reviewTotal]);
  useEffect(() => () => latest.current.onReview?.(null), []);

  // Runs after the document is in place, so a scene asked for as the editor opens is found.
  useEffect(() => {
    const view = viewRef.current;
    if (!reveal || !view) return;
    const scene = scenesOf(view.state.doc).list.find((entry) => entry.number === reveal.scene);
    if (scene) goTo(scene.heading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  useEffect(() => {
    if (!reviewRequest || proposal === null) return;
    if (base === "proposal") {
      const view = viewRef.current;
      const scene =
        view && reviewRequest.scene !== undefined
          ? scenesOf(view.state.doc).list.find((entry) => entry.number === reviewRequest.scene)
          : undefined;
      if (scene) goTo(scene.heading);
      return;
    }
    reviewScene.current = reviewRequest.scene ?? null;
    setChoice("proposal");
    // Only a new request moves the review; the base changing under it does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewRequest]);

  function goTo(line: number) {
    const view = viewRef.current;
    if (!view || line < 1) return;
    const pos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;
    const effects: ReturnType<typeof unfoldEffect.of>[] = [];
    foldedRanges(view.state).between(pos, pos, (from, to) => {
      effects.push(unfoldEffect.of({ from, to }));
    });
    view.dispatch({
      selection: { anchor: pos },
      effects: [...effects, EditorView.scrollIntoView(pos, { y: "center" })],
    });
    view.focus();
  }

  function toggleScenes() {
    const view = viewRef.current;
    if (!view) return;
    if (folded) unfoldAll(view);
    else foldAll(view);
    setFolded(!folded);
  }

  function step(command: typeof goToNextChunk) {
    const view = viewRef.current;
    if (!view) return;
    command(view);
    view.focus();
  }

  /** Every change still waiting goes back to the author's text, in one step. */
  function rejectRest() {
    const view = viewRef.current;
    if (!view) return;
    const chunks = getChunks(view.state)?.chunks ?? [];
    if (!chunks.length) return;
    const original = getOriginalDoc(view.state);
    view.dispatch({
      changes: chunks.map((chunk) => ({
        from: chunk.fromB,
        to: Math.min(chunk.toB, view.state.doc.length),
        insert: original.sliceString(chunk.fromA, Math.min(chunk.toA, original.length)),
      })),
    });
    setReview((current) =>
      current ? { ...current, rejected: current.rejected + chunks.length } : current,
    );
  }

  const reviewing = base === "proposal" && review !== null;
  const nothingKept = reviewing && review.text === value;
  const blocked = acceptBlocked !== null;
  // The way out of a review: close it when nothing was kept; otherwise apply what it holds,
  // as the agent's own proposal when nothing was rejected.
  let finish: { label: string; primary: boolean; run: () => void } | null = null;
  if (reviewing && nothingKept && !review.left) {
    if (onDiscardProposal)
      finish = { label: words.closeProposal, primary: false, run: onDiscardProposal };
  } else if (reviewing) {
    const run =
      review.text === proposal
        ? onAcceptProposal
        : onApplyReviewed && (() => onApplyReviewed(review.text));
    if (run)
      finish = { label: review.left ? words.acceptRest : words.applyReview, primary: true, run };
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h2 className="text-sm font-semibold">{words.label}</h2>
        {/* The status takes what room is left and gives it up first, so the controls stay on
            one row beside the title rather than wrapping under it. */}
        <span
          aria-live="polite"
          title={status ?? undefined}
          className="min-w-0 flex-1 basis-0 truncate text-xs text-gray-500"
        >
          {status}
        </span>
        {base !== "off" && !reviewing && (
          <span aria-live="polite" className="text-xs text-gray-500 tabular-nums">
            {stats.added || stats.removed
              ? words.stats(stats.added, stats.removed)
              : words.noChanges}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={folded}
          title={words.scenesHelp}
          onClick={toggleScenes}
        >
          {words.scenes}
        </Button>
        <span aria-hidden className="text-xs text-gray-500 dark:text-gray-400">
          {words.diff}
        </span>
        <ChipGroup<ScriptDiffBase>
          label={words.diff}
          value={base}
          onChange={setChoice}
          options={[
            { value: "off", label: words.diffOff },
            { value: "saved", label: words.diffSaved },
            // Offered only while there is a proposal to compare with.
            ...(proposal === null
              ? []
              : [{ value: "proposal" as const, label: words.diffProposal }]),
          ]}
        />
        {canSave && (
          // Save stands out only when there is something to save.
          <Button
            size="sm"
            variant={saveDisabled || base === "proposal" ? "secondary" : "primary"}
            onClick={onSave}
            disabled={saveDisabled || base === "proposal"}
          >
            {words.save}
          </Button>
        )}
      </div>
      {reviewing && (
        <div
          role="region"
          aria-label={words.reviewLabel}
          className={`mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs ${
            review.left ? toneStrip.attention : toneStrip.success
          }`}
        >
          <span aria-live="polite" className="inline-flex min-w-0 flex-1 items-center gap-1.5">
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${toneDot[review.left ? "attention" : "success"]}`}
            />
            {reviewSummary(review, nothingKept)}
          </span>
          {blocked && <span className={toneInk.attention}>{acceptBlocked}</span>}
          {review.left > 0 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label={words.previousChange}
                title={words.previousChange}
                onClick={() => step(goToPreviousChunk)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={words.nextChange}
                title={words.nextChange}
                onClick={() => step(goToNextChunk)}
              >
                ↓
              </Button>
            </>
          )}
          {review.left > 0 && (
            <Button size="sm" variant="secondary" onClick={rejectRest}>
              {words.rejectRest}
            </Button>
          )}
          {finish && (
            <Button
              size="sm"
              variant={finish.primary ? "primary" : "secondary"}
              disabled={finish.primary && blocked}
              onClick={finish.run}
            >
              {finish.label}
            </Button>
          )}
        </div>
      )}
      {changed.length > 0 && !reviewing && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 px-4 py-1.5 dark:border-gray-800">
          <span className="text-xs text-gray-500">{words.changedScenes}</span>
          {changed.map((number) => (
            <button
              key={number}
              type="button"
              onClick={() =>
                goTo(shownScenes.find((scene) => scene.number === number)?.heading ?? 0)
              }
              className="rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950"
            >
              {words.scene(number)}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={host} className="script-editor activity-script min-h-0 min-w-0 flex-1" />
        {markers.length > 0 && (
          <div
            role="group"
            aria-label={words.minimap}
            className="relative w-2.5 shrink-0 border-l border-gray-200 dark:border-gray-800"
          >
            {markers.map((marker) => (
              <button
                key={`${marker.line}:${marker.top}`}
                type="button"
                aria-label={words.jump(marker.line)}
                title={words.jump(marker.line)}
                onClick={() => goTo(marker.line)}
                style={{ top: `${marker.top}%`, height: `${marker.height}%` }}
                className="absolute inset-x-0.5 min-h-1 rounded-sm bg-brand-400 hover:bg-brand-600 dark:bg-brand-500"
              />
            ))}
          </div>
        )}
      </div>
      <div
        role="group"
        aria-label={words.status.label}
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-gray-200 bg-gray-50 px-4 py-1 text-xs text-gray-500 tabular-nums dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
      >
        <span>
          {cursorScene
            ? words.status.scene(
                scenes.indexOf(cursorScene) + 1,
                scenes.length,
                cursorScene.title || words.scene(cursorScene.number),
              )
            : words.status.noScene}
        </span>
        <span>{words.status.line(cursorLine)}</span>
        <span>{words.status.words(figures.words)}</span>
        {figures.narrationSeconds > 0 && <span>{narrationText(figures.narrationSeconds)}</span>}
        {media && media.totals.total > 0 && (
          <span className="ml-auto">
            {words.status.clips(media.totals.bound, media.totals.total)}
          </span>
        )}
      </div>
    </div>
  );
}
