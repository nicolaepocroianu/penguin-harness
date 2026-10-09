/**
 * The conversation panel's model: which conversation it shows, what the author is
 * pointing at, and how that is said to the agent.
 *
 * A conversation is an assist run (see the server's `assist.ts`): the first message starts
 * a run whose Session carries the rest. So the panel needs no store of its own. The newest
 * assist run with a Session is the conversation to resume, and "New conversation" just
 * stops following it until the next message starts another.
 */
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { SceneAssetSelection } from "./scene-asset-tree";
import type { WorkspaceSection } from "./workspace-model";

/** What the author has open, in the shape the assist route takes. */
export interface AssistFocus {
  section: WorkspaceSection;
  sceneId?: string;
  assetKey?: string;
  language?: string;
}

/** Every conversation about this activity that can be resumed, newest first. */
export function conversationThreads(runs: readonly ActivityRunSummary[]): ActivityRunSummary[] {
  return runs
    .filter((run) => run.kind === "assist" && !!run.sessionId)
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
}

/** The newest conversation about this activity that can be resumed, if there is one. */
export function latestConversation(runs: readonly ActivityRunSummary[]): ActivityRunSummary | null {
  let newest: ActivityRunSummary | null = null;
  for (const run of runs)
    if (run.kind === "assist" && run.sessionId && (!newest || run.createdAt > newest.createdAt))
      newest = run;
  return newest;
}

/**
 * The focus for what the main panel shows. An asset counts only while the scenes section is
 * showing it, the same rule the tree uses to mark the current row.
 */
export function focusFor(
  section: WorkspaceSection,
  selection: SceneAssetSelection | null,
  language: string,
): AssistFocus {
  // Making a new ref reviews this ref's media; the agent knows that part as the scenes.
  if (section === "newRef") return { section: "scenes" };
  // Deploying ships the module; the agent knows that part as the module.
  if (section === "deploy") return { section: "module" };
  if (section === "scenes" && selection)
    return {
      section,
      ...(selection.sceneId ? { sceneId: selection.sceneId } : {}),
      assetKey: selection.key,
      language,
    };
  return { section };
}

/** The focus in the author's words, for the chip above the composer. */
export function focusLabel(focus: AssistFocus | null): string {
  const words = S.activities.studioConversation;
  if (!focus) return words.wholeActivity;
  if (focus.assetKey) return words.asset(focus.assetKey, focus.sceneId ?? null);
  if (focus.sceneId) return words.scene(focus.sceneId);
  return S.activities.sectionNames[focus.section];
}

/** Two focuses are the same place. */
export function sameFocus(left: AssistFocus | null, right: AssistFocus | null): boolean {
  return (
    left?.section === right?.section &&
    left?.sceneId === right?.sceneId &&
    left?.assetKey === right?.assetKey &&
    left?.language === right?.language
  );
}

/**
 * A follow-up's text. The first message tells the agent where the author is; a follow-up
 * does so again only after the author has moved, so a conversation that stays on one asset
 * reads as a conversation.
 */
export function followUpText(
  message: string,
  focus: AssistFocus | null,
  lastSent: AssistFocus | null,
): string {
  return sameFocus(focus, lastSent)
    ? message
    : `${message}\n\n${S.activities.studioConversation.movedTo(focusLabel(focus))}`;
}

/**
 * The brief the server appends to an assist run's first message (`assistPrompt` in the
 * server's `assist.ts`): a rule, then the studio context and the proposal instructions. The
 * author never typed it, so the panel folds it under their question.
 */
const BRIEF_RULE = "\n\n---\n";
const BRIEF_OPENING = "Context from the activity studio";
/** The brief's first sentence names what the author had open, in the server's words. */
const BRIEF_VIEWING = /^Context from the activity studio: the author is looking at (.+?)\.(?:\n|$)/;

export function splitStudioBrief(
  text: string,
): { body: string; context: string; viewing?: string } | null {
  const at = text.lastIndexOf(BRIEF_RULE);
  if (at < 0) return null;
  const context = text.slice(at + BRIEF_RULE.length);
  if (!context.startsWith(BRIEF_OPENING)) return null;
  const viewing = BRIEF_VIEWING.exec(context)?.[1];
  return { body: text.slice(0, at).trimEnd(), context, ...(viewing ? { viewing } : {}) };
}

/**
 * The line `followUpText` appends when the author has moved, read back off a stored
 * message. It has to agree with `movedTo` in the strings, which a test holds it to.
 */
const MOVED_TO = /\n\n\(I am now looking at (.+)\.\)$/;

export function splitMovedTo(text: string): { body: string; viewing: string } | null {
  const match = MOVED_TO.exec(text);
  if (!match) return null;
  return { body: text.slice(0, match.index).trimEnd(), viewing: match[1]! };
}

/**
 * What a user message in the studio's conversation carries beyond the author's words: the
 * server's brief on the first message, or the moved-to line on a follow-up. Either names
 * what the author was viewing, which the transcript shows as a chip rather than as text.
 */
export function splitStudioContext(
  text: string,
): { body: string; context?: string; viewing?: string } | null {
  return splitStudioBrief(text) ?? splitMovedTo(text);
}

/** When a conversation started, to the minute: "Today 23:58", or the date and time. */
export function threadTime(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  const time = when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (when.toDateString() === now.toDateString())
    return S.activities.studioConversation.today(time);
  return `${when.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

/**
 * Questions an author often starts with, for where they are; one fills the composer for
 * editing, never sends itself.
 */
export function suggestionsFor(focus: AssistFocus): readonly string[] {
  const words = S.activities.studioConversation.suggestions;
  if (focus.assetKey) return words.asset;
  if (focus.section === "description") return words.script;
  if (focus.section === "specification") return words.spec;
  return [];
}
