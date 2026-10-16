/**
 * How the Activity Script draws over its text: scene headings, media in two hues, and what
 * the media plan knows about each element and scene.
 *
 * An element's tags are markup the author needs only while editing that line. Elsewhere the
 * opening tag shows as a small mark ("Says", "Video") and the closing one is hidden, so the
 * script reads as narration and footage rather than source. The line the cursor is on, and
 * every line of a selection, shows its tags as written. A line tied to a clip (see
 * script-media.ts) ends with that clip's state, which opens it, led by a play button when the
 * clip has a real file; a scene heading ends with how much media the scene asks for and how
 * much still has no file. The line the player is saying, or one an author chose, is lit.
 */
import { Facet, type Range, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { elementText, formatClipLength } from "./script-media";
import type { ScriptClip, ScriptMedia, SceneMedia } from "./script-media";
import {
  mediaElementSpans,
  mediaTagSpans,
  sceneHeadingPrefix,
  sceneRanges,
  type MediaElement,
  type ScriptScene,
} from "./script-model";

/** A document's scenes, worked out once per document rather than once per line asked about. */
const scenesByDoc = new WeakMap<
  Text,
  { list: ScriptScene[]; byHeading: Map<number, ScriptScene> }
>();
export function scenesOf(doc: Text) {
  let entry = scenesByDoc.get(doc);
  if (!entry) {
    const list = sceneRanges(doc.toString());
    entry = { list, byHeading: new Map(list.map((scene) => [scene.heading, scene])) };
    scenesByDoc.set(doc, entry);
  }
  return entry;
}

/** Scene numbers an open proposal changes, marked on their headings. */
export const proposedScenes = Facet.define<number[], ReadonlySet<number>>({
  combine: (values) => new Set(values.flat()),
});

/** What the editor knows about the script's media, how to open one clip and how to play it. */
export interface MediaContext {
  media: ScriptMedia | null;
  open: ((key: string) => void) | null;
  /** Play a clip where it is written, or stop it when it is the one playing. */
  play?: ((clip: ScriptClip, words: string) => void) | null;
  /** The clip playing in place now, by key. */
  playing?: string | null;
  /** The clip whose line is lit: the one the player is saying, or one an author chose. */
  lit?: string | null;
  /** Told the clip of a narration line an author put the cursor on with a click. */
  line?: ((key: string) => void) | null;
}
export const mediaContext = Facet.define<MediaContext, MediaContext>({
  combine: (values) => values[0] ?? { media: null, open: null },
});

class ProposedHint extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: ProposedHint) {
    return other.text === this.text;
  }
  toDOM() {
    const hint = document.createElement("span");
    // A proposal waiting on the author is an attention state; its ink comes from tone.ts.
    hint.className = `cm-proposed-hint ${toneInk.attention}`;
    hint.textContent = this.text;
    return hint;
  }
}

/** An opening tag, drawn as the kind of element it opens. */
class TagMark extends WidgetType {
  constructor(readonly element: MediaElement) {
    super();
  }
  override eq(other: TagMark) {
    return other.element === this.element;
  }
  toDOM() {
    const mark = document.createElement("span");
    mark.className = `cm-media-mark cm-media-mark-${this.element}`;
    mark.textContent = S.activities.studioScript.marks[this.element];
    return mark;
  } /** A click on the mark puts the cursor there, which shows the line's tags as written. */
  override ignoreEvent() {
    return false;
  }
}

/**
 * A clip's length when it has a real file and the plan knows it, else whether it has one. A
 * placeholder says so rather than its length: the blank clip's length says nothing.
 */
function clipLabel({ bound, placeholder, durationMs }: ScriptClip): string {
  const words = S.activities.studioScript;
  if (!bound) return words.clipUnbound;
  if (placeholder) return words.clipPlaceholder;
  return durationMs !== undefined ? formatClipLength(durationMs) : words.clipBound;
}

/** A press the editor must not take as a cursor move: mouse down, and Enter or Space. */
function pressable(button: HTMLElement, act: () => void) {
  // Mouse down, not click: the editor would otherwise take the press as a cursor move.
  // Enter and Space arrive as a click with no pointer behind it (detail 0).
  button.onmousedown = (event) => {
    event.preventDefault();
    act();
  };
  button.onclick = (event) => {
    if (event.detail === 0) act();
  };
}

/**
 * The clip a line became: its length when it has a file, a call to make one when not, and a
 * play button before it when there is a real file to play.
 */
class ClipChip extends WidgetType {
  constructor(
    readonly clip: ScriptClip,
    readonly open: ((key: string) => void) | null,
    readonly words: string,
    readonly play: ((clip: ScriptClip, words: string) => void) | null,
    readonly playing: boolean,
  ) {
    super();
  }
  override eq(other: ClipChip) {
    return (
      other.clip.key === this.clip.key &&
      other.clip.bound === this.clip.bound &&
      other.clip.placeholder === this.clip.placeholder &&
      other.clip.durationMs === this.clip.durationMs &&
      other.clip.src === this.clip.src &&
      other.open === this.open &&
      other.words === this.words &&
      other.play === this.play &&
      other.playing === this.playing
    );
  }
  toDOM() {
    const label = this.label();
    const { play, clip, words: said } = this;
    const playable =
      play && clip.src && (clip.type === "audio" || clip.type === "video") ? play : null;
    if (!playable) return label;
    const words = S.activities.studioScript;
    const group = document.createElement("span");
    group.className = "cm-clip-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-clip-play${this.playing ? " cm-clip-playing" : ""}`;
    const name = this.playing ? words.stopClip(said) : words.playClip(said);
    button.setAttribute("aria-label", name);
    button.title = name;
    button.setAttribute("aria-pressed", String(this.playing));
    // The glyph is drawn by CSS: a triangle to play, two bars to stop.
    pressable(button, () => playable(clip, said));
    group.append(button, label);
    return group;
  }
  label() {
    const words = S.activities.studioScript;
    const chip = document.createElement(this.open ? "button" : "span");
    const { bound, placeholder, key } = this.clip;
    // A placeholder still needs a real file, so it reads as the unbound clip does.
    chip.className = `cm-clip ${bound && !placeholder ? "cm-clip-bound" : `cm-clip-unbound ${toneInk.attention}`}`;
    chip.textContent = clipLabel(this.clip);
    chip.title = words.openClip(key);
    if (this.open && chip instanceof HTMLButtonElement) {
      chip.type = "button";
      chip.setAttribute("aria-label", `${chip.textContent}: ${words.openClip(key)}`);
      const open = this.open;
      pressable(chip, () => open(key));
    }
    return chip;
  }
  override ignoreEvent() {
    return true;
  }
}

/** How much media a scene asks for, after its heading. */
class SceneFacts extends WidgetType {
  constructor(readonly media: SceneMedia) {
    super();
  }
  override eq(other: SceneFacts) {
    return (
      other.media.heard === this.media.heard &&
      other.media.seen === this.media.seen &&
      other.media.unbound === this.media.unbound
    );
  }
  toDOM() {
    const words = S.activities.studioScript.sceneFacts;
    const facts = document.createElement("span");
    facts.className = "cm-scene-facts";
    const parts = [
      this.media.heard ? words.heard(this.media.heard) : null,
      this.media.seen ? words.seen(this.media.seen) : null,
    ].filter((part): part is string => part !== null);
    facts.textContent = parts.join(" · ");
    if (this.media.unbound) {
      const unbound = document.createElement("span");
      unbound.className = toneInk.attention;
      unbound.textContent = `${parts.length ? " · " : ""}${words.unbound(this.media.unbound)}`;
      facts.append(unbound);
    }
    return facts;
  }
}

const headingLine = Decoration.line({ class: "cm-scene-heading" });
/** The line being said in the player, or one an author chose there or here. */
const litLine = Decoration.line({ class: "cm-line-lit" });
const headingNumber = Decoration.mark({ class: "cm-scene-number" });
const hiddenTag = Decoration.replace({});
/**
 * What is heard and what is seen keep a hue each, tag and all, so narration and footage read
 * apart in a long scene. The hues are categorical (which element this is), never a status.
 */
const tagMarks = Object.fromEntries(
  (["audio", "video", "image", "animation"] as const).map((element) => [
    element,
    Decoration.mark({ class: `cm-media-tag cm-media-${element}` }),
  ]),
) as Record<MediaElement, Decoration>;
const spanMarks = Object.fromEntries(
  (["audio", "video", "image", "animation"] as const).map((element) => [
    element,
    Decoration.mark({ class: `cm-media-span cm-media-span-${element}` }),
  ]),
) as Record<MediaElement, Decoration>;

/** Lines a selection touches, where tags show as written; none while the editor is not in use. */
function revealedLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  const { doc, selection } = view.state;
  for (const range of selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) lines.add(line);
  }
  return lines;
}

function decorate(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { doc } = view.state;
  const scenes = scenesOf(doc).byHeading;
  const proposed = view.state.facet(proposedScenes);
  const { media, open, play = null, playing = null, lit = null } = view.state.facet(mediaContext);
  const revealed = revealedLines(view);
  let done = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      // Two visible ranges can share a line either side of a fold.
      if (line.number <= done) continue;
      done = line.number;
      const at = line.from;
      const scene = scenes.get(line.number);
      if (scene) {
        ranges.push(headingLine.range(at));
        const prefix = sceneHeadingPrefix(line.text);
        if (prefix) ranges.push(headingNumber.range(at, at + prefix));
      }
      const tags = mediaTagSpans(line.text);
      const spans = mediaElementSpans(line.text);
      if (revealed.has(line.number)) {
        for (const span of spans)
          ranges.push(spanMarks[span.element].range(at + span.from, at + span.to));
        for (const tag of tags)
          ranges.push(tagMarks[tag.element].range(at + tag.from, at + tag.to));
      } else {
        for (const tag of tags) {
          const closing = /^<\s*\//.test(line.text.slice(tag.from, tag.to));
          ranges.push(
            (closing ? hiddenTag : Decoration.replace({ widget: new TagMark(tag.element) })).range(
              at + tag.from,
              at + tag.to,
            ),
          );
        }
        // The words alone carry the hue, so no mark overlaps a hidden tag.
        for (const span of spans) {
          const opening = tags.find((tag) => tag.from === span.from);
          const closing = tags.find((tag) => tag.to === span.to);
          const inner = { from: opening?.to ?? span.from, to: closing?.from ?? span.to };
          if (inner.to > inner.from)
            ranges.push(spanMarks[span.element].range(at + inner.from, at + inner.to));
        }
      }
      if (media) {
        let lighted = false;
        for (const span of spans) {
          const raw = line.text.slice(span.from, span.to);
          const said = elementText(raw);
          const clip = media.clipFor(span.element, said);
          if (!clip) continue;
          if (lit && clip.key === lit && !lighted) {
            ranges.push(litLine.range(at));
            lighted = true;
          }
          ranges.push(
            Decoration.widget({
              widget: new ClipChip(clip, open, said.trim(), play, playing === clip.key),
              side: 1,
            }).range(at + span.to),
          );
        }
      }
      if (scene) {
        const facts = media?.scene(scene.number);
        if (facts && (facts.heard || facts.seen))
          ranges.push(Decoration.widget({ widget: new SceneFacts(facts), side: 1 }).range(line.to));
        if (proposed.has(scene.number))
          ranges.push(
            Decoration.widget({
              widget: new ProposedHint(S.activities.studioScript.proposed),
              side: 2,
            }).range(line.to),
          );
      }
    }
  }
  return Decoration.set(ranges, true);
}

export const scriptDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        update.startState.facet(proposedScenes) !== update.state.facet(proposedScenes) ||
        update.startState.facet(mediaContext) !== update.state.facet(mediaContext)
      )
        this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** A scene folds from the end of its heading to the end of its last line. */
export function sceneFold(state: { doc: Text }, lineStart: number) {
  const line = state.doc.lineAt(lineStart);
  const scene = scenesOf(state.doc).byHeading.get(line.number);
  if (!scene || scene.last <= scene.heading) return null;
  return { from: line.to, to: state.doc.line(scene.last).to };
}
