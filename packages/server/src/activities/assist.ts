/**
 * Assist: an agent session in an activity's context, started from the studio's
 * conversation panel with whatever the author is looking at.
 *
 * The other run kinds each produce one artifact the server collects and checks. An assist
 * run produces a conversation. It is still a run, not a bare Session, so that "an agent
 * worked on this activity" has one answer: the activity's runs list, which already links
 * every run to its Session and Trace. The run finishes when the agent's first reply does,
 * so it holds the activity's one-run-at-a-time slot only while that reply is being written.
 * Follow-up turns are ordinary Session traffic, traced in that Session.
 *
 * The session works in a copy of the draft, as every run does, so nothing it writes there
 * changes the activity. Changing the activity stays with the author and the stage runs,
 * where every change is reviewed.
 */
import { HttpError } from "../http/errors.js";

/** The workspace sections a focus can name; the studio's tree rows map onto these. */
export const ASSIST_SECTIONS = [
  "description",
  "specification",
  "module",
  "speech",
  "scenes",
  "library",
  "history",
] as const;

export type AssistSection = (typeof ASSIST_SECTIONS)[number];

/** What the author had open when they asked. Recorded on the run, so a trace says. */
export interface AssistFocus {
  section: AssistSection;
  sceneId?: string;
  assetKey?: string;
  language?: string;
}

/** Long enough for a pasted paragraph of feedback; the Session holds anything longer. */
export const ASSIST_MESSAGE_MAX = 20_000;
const FOCUS_TEXT_MAX = 200;

function focusText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > FOCUS_TEXT_MAX)
    throw new HttpError(400, "assist_invalid", `focus.${key} must be a short string.`);
  return value;
}

/** The focus a request names, or null when it names none. Anything malformed is refused. */
export function parseAssistFocus(value: unknown): AssistFocus | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "assist_invalid", "focus must be an object.");
  const record = value as Record<string, unknown>;
  if (!ASSIST_SECTIONS.includes(record.section as AssistSection))
    throw new HttpError(400, "assist_invalid", "focus.section is not a workspace section.");
  const sceneId = focusText(record, "sceneId");
  const assetKey = focusText(record, "assetKey");
  const language = focusText(record, "language");
  return {
    section: record.section as AssistSection,
    ...(sceneId !== undefined ? { sceneId } : {}),
    ...(assetKey !== undefined ? { assetKey } : {}),
    ...(language !== undefined ? { language } : {}),
  };
}

const SECTION_WORDS: Record<AssistSection, string> = {
  description: "the activity script (description.md)",
  specification: "the activity specification (draft.spec in input.json)",
  module: "the assembled WAF module",
  speech: "the activity's speech coverage (audio assets in draft.mediaPlan)",
  scenes: "the scenes and their media",
  library: "the activity's media library",
  history: "the activity's generation history",
};

/** Where the author is, in words the agent can find in input.json. */
export function describeFocus(focus: AssistFocus | null): string {
  if (!focus) return "the activity as a whole";
  if (focus.assetKey)
    return `the media asset ${JSON.stringify(focus.assetKey)}${
      focus.sceneId ? ` in scene ${JSON.stringify(focus.sceneId)}` : " (in no scene)"
    }${focus.language ? `, language ${JSON.stringify(focus.language)}` : ""}`;
  if (focus.sceneId) return `scene ${JSON.stringify(focus.sceneId)}`;
  return SECTION_WORDS[focus.section];
}

/**
 * The first turn: the author's words first, as they wrote them, then the context. The
 * context comes second so the conversation reads as the author's question, not as a
 * system brief with a question at the bottom.
 */
export function assistPrompt(message: string, focus: AssistFocus | null): string {
  return `${message}

---
Context from the activity studio: the author is looking at ${describeFocus(focus)}.
This workspace holds a copy of the activity: input.json (the whole draft, including the specification and media plan) and description.md (the activity script). Read them before answering.
Files you write here do not change the activity; the author applies changes in the studio. When you suggest a change, say exactly what to change and where.
Answer the author directly. Do not delegate.`;
}
