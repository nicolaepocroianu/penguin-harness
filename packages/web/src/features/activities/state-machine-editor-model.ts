/**
 * What the state machine editor shows, kept apart from the view so it can be tested without a
 * DOM: where the machine came from, what stops it being edited, and which problems to list —
 * the saved machine's, or, once the author has changed the text, the server's check of it.
 */
import type { StateMachineCheck, StateMachineDocument } from "@waterford/waf-harness-server/api";
import { S } from "../../lib/strings";
import { documentChanged, documentText } from "./module-document";

/** One problem as the editor lists it. */
export interface MachineProblem {
  /** Where in the file, or the whole file's name for a problem with all of it. */
  where: string;
  message: string;
  /** The saved machine already had it, so it does not stop a save. */
  inherited: boolean;
  /** Only a warning (an implementation the module's code never mentions), which stops nothing. */
  warning: boolean;
}

/** The check of the text on screen: none needed, running, done, or failed. */
export type MachineCheckState =
  | { state: "idle" }
  | { state: "checking"; text: string }
  | { state: "done"; text: string; check: StateMachineCheck }
  | { state: "failed"; text: string; reason: string };

export interface MachineEditorView {
  /** The text the editor opens with: the machine as saved, or nothing when there is none. */
  saved: string;
  /** Lines under the header, in order. */
  origin: string;
  edited: boolean;
  stale: boolean;
  /** Why the text cannot be changed here, or null when it can. */
  readOnly: string | null;
  /** Whether Save shows; Discard shows when this and `edited` are both true. */
  canEdit: boolean;
  /** The problems to list, and whose they are. */
  problems: {
    list: MachineProblem[];
    unsaved: boolean;
    /** A summary line: the count, checking, or why the check failed. */
    summary: string;
    /** Whether the summary is a status rather than a problem count. */
    pending: boolean;
  };
}

/** The line that says where the machine came from. */
export function machineOrigin(document: StateMachineDocument): string {
  const words = S.activities.stateMachineEditor;
  if (document.source === "draft") return words.fromDraft(document.file);
  if (document.source === "product") return words.fromProduct(document.file);
  if (document.source === "ref") return words.fromModule(document.file);
  return words.missing;
}

function problems(
  issues: readonly { path: string; message: string; inherited?: boolean; warning?: boolean }[],
  inheritedByDefault: boolean,
): MachineProblem[] {
  return issues.map((issue) => ({
    where: issue.path || S.activities.stateMachineEditor.wholeFile,
    message: issue.message,
    inherited: !issue.warning && (issue.inherited ?? inheritedByDefault),
    warning: !!issue.warning,
  }));
}

/** The summary of a list: how many problems it has, warnings not counted. */
function count(list: readonly MachineProblem[], unsaved: boolean): string {
  const words = S.activities.stateMachineEditor;
  const found = list.filter((entry) => !entry.warning).length;
  return found ? words.problems(found, unsaved) : words.noProblems;
}

/** Why the machine cannot be edited here, or null when it can. */
function lockedBecause(document: StateMachineDocument): string | null {
  const words = S.activities.stateMachineEditor;
  if (document.locked === "book") return words.book;
  if (document.locked === "shared" && document.canonicalRefNum !== null)
    return words.shared(document.canonicalRefNum);
  return document.editable ? null : words.readOnly;
}

/**
 * The editor's view of `document` with `text` on screen. While the text says what the saved
 * machine says, the saved machine's problems are listed; once it differs, the check of that
 * very text is, so a check of older text is never shown as the current one.
 */
export function machineEditorView(
  document: StateMachineDocument,
  text: string,
  check: MachineCheckState,
  viewerMayEdit: boolean,
): MachineEditorView {
  const words = S.activities.stateMachineEditor;
  const saved = document.definition ? documentText(document.definition) : "";
  const readOnly = lockedBecause(document);
  const canEdit = viewerMayEdit && readOnly === null;
  const unsaved = machineChanged(text, document);
  let list: MachineProblem[];
  let summary: string;
  let pending = false;
  if (!unsaved) {
    // The saved machine's own problems: none of them stops a save.
    list = problems(document.definition ? document.validation.issues : [], true);
    summary = document.definition ? count(list, false) : "";
  } else if (check.state === "done" && check.text === text) {
    list = problems(check.check.issues, false);
    summary = count(list, true);
  } else if (check.state === "failed" && check.text === text) {
    list = [];
    summary = words.checkFailed(check.reason);
    pending = true;
  } else {
    // The text does not parse yet (the editor says why), or its check has not come back.
    list = [];
    summary = check.state === "checking" && check.text === text ? words.checking : "";
    pending = true;
  }
  return {
    saved,
    origin: machineOrigin(document),
    edited: document.edited,
    stale: document.stale,
    readOnly,
    canEdit,
    problems: { list, unsaved, summary, pending },
  };
}

/**
 * Whether `text` says something other than the saved machine, ignoring layout: only then is it
 * worth checking, and only then is it unsaved.
 */
export function machineChanged(text: string, document: StateMachineDocument): boolean {
  return document.definition ? documentChanged(text, document.definition) : !!text.trim();
}

/** The machine `text` holds, when it is a JSON object worth checking; null otherwise. */
export function checkable(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether the diagram may draw `text`: the machine as saved, which is what the module plays and
 * whose own problems are already listed, or an edit that parses and that the check of this very
 * text found nothing new wrong with. Anything else keeps the last drawing that passed.
 */
export function drawable(
  text: string,
  document: StateMachineDocument,
  check: MachineCheckState,
): boolean {
  if (!checkable(text)) return false;
  if (!machineChanged(text, document)) return document.definition !== null;
  return check.state === "done" && check.text === text && check.check.savable;
}
