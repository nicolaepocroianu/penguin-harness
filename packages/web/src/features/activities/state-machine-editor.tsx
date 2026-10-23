/**
 * State Machine: the ref's `spec/state-machine.json`, edited in place as in Loom, in the JSON
 * editor every module document uses (Diff against the last save). Each problem is listed under
 * the header with where it is: the saved machine's while the text is unchanged, and the
 * server's check of the text as the author types. An edit is kept in the draft and written to
 * the module's file; the preview and every assembly use it until it is discarded.
 *
 * Its other reading is the diagram the Preview's map draws (machine-diagram.tsx, Loom's layout),
 * of the text in the editor, unsaved edits included. Text that does not parse, or that the check
 * finds something new wrong with, is not drawn: the last version that passed stays, and a note
 * says so.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityDraft, StateMachineDocument } from "@waterford/waf-harness-server/api";
import {
  ConfirmModal,
  Button,
  EmptyState,
  InfoPopover,
  Segmented,
  SkeletonList,
} from "@waterford/waf-harness-ui";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { JsonEditor } from "./json-editor";
import { documentText } from "./module-document";
import { MachineDiagram } from "./machine-diagram";
import { machineOf, machineScenes, type StateMachine } from "./state-map";
import {
  checkable,
  drawable,
  machineChanged,
  machineEditorView,
  type MachineCheckState,
  type MachineProblem,
} from "./state-machine-editor-model";
import { useHeldWork } from "./unsaved-work-context";
import { useActivityClient } from "./activity-client";

/** How long typing pauses before the text is checked. */
const CHECK_DELAY_MS = 400;

/** A new problem reads as one, a warning asks for attention, and an inherited one is muted. */
function problemInk(problem: MachineProblem): string {
  if (problem.warning) return toneInk.attention;
  if (problem.inherited) return "text-gray-600 dark:text-gray-400";
  return toneInk.danger;
}

function ProblemList({ problems }: { problems: readonly MachineProblem[] }) {
  const words = S.activities.stateMachineEditor;
  return (
    <ul aria-label={words.problemsLabel} className="max-h-40 space-y-1 overflow-y-auto">
      {problems.map((problem, index) => (
        <li key={`${problem.where}:${index}`} className="flex gap-2">
          <code className="shrink-0 font-mono text-gray-500">{problem.where}</code>
          <span className={problemInk(problem)}>
            {problem.message}
            {problem.inherited && <span className="text-gray-500"> {words.inherited}</span>}
            {problem.warning && <span className="text-gray-500"> {words.warning}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StateMachineEditor({
  revision,
  editable,
  onSaved,
}: {
  /** The draft revision: a save sends it, and a new one can mean a new assembly, so read again. */
  revision: string;
  /** Whether this viewer may change the activity at all (a project owner, with it open). */
  editable: boolean;
  /** A save or a discard changed the draft; `text` is what to announce. */
  onSaved: (draft: ActivityDraft, text: string) => void;
}) {
  const { api } = useActivityClient();
  const words = S.activities.stateMachineEditor;
  const [document, setDocument] = useState<StateMachineDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [check, setCheck] = useState<MachineCheckState>({ state: "idle" });
  // The text the editor last loaded; while the author has not changed it, a fresh read
  // replaces it, and once they have, their words stay.
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.stateMachine
      .read()
      .then((value) => {
        if (cancelled) return;
        setDocument(value);
        setError(null);
        const next = value.definition ? documentText(value.definition) : "";
        const previous = loaded.current;
        setText((current) => (previous === null || current === previous ? next : current));
        loaded.current = next;
      })
      .catch((cause) => {
        if (!cancelled) setError(apiErrorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, revision]);

  const saved = document?.definition ? documentText(document.definition) : "";
  // The server checks the text once typing pauses; only a check of the text on screen counts.
  useEffect(() => {
    // Text laid out differently but saying what is saved needs no check.
    const definition = document && machineChanged(text, document) ? checkable(text) : null;
    if (!definition) {
      setCheck({ state: "idle" });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setCheck({ state: "checking", text });
      api.stateMachine
        .check(definition)
        .then((result) => {
          if (!cancelled) setCheck({ state: "done", text, check: result });
        })
        .catch((cause) => {
          if (!cancelled) setCheck({ state: "failed", text, reason: apiErrorText(cause) });
        });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, document, text]);

  const view = document ? machineEditorView(document, text, check, editable) : null;

  // The diagram's machine: the text on screen when it may be drawn, else the last that could.
  const [reading, setReading] = useState<"diagram" | "json">("diagram");
  const [drawn, setDrawn] = useState<{ text: string; machine: StateMachine } | null>(null);
  const current = document && drawable(text, document, check) ? text : null;
  useEffect(() => {
    if (current === null) return;
    const machine = machineOf({ stateMachine: checkable(current) });
    if (machine) setDrawn((last) => (last?.text === current ? last : { text: current, machine }));
  }, [current]);
  const scenes = useMemo(() => (drawn ? machineScenes(drawn.machine) : []), [drawn]);
  const [scene, setScene] = useState<string | null>(null);
  const shownScene =
    scene && scenes.includes(scene)
      ? scene
      : drawn && scenes.includes(drawn.machine.initial)
        ? drawn.machine.initial
        : (scenes[0] ?? "");
  // The text is this editor's own, so closing its section throws it away: leaving asks first.
  useHeldWork(
    { label: "module document", section: "stateMachine" },
    !!view?.canEdit && view.problems.unsaved,
  );

  const pad = "p-4";
  if (error) return <p className={`text-sm ${pad} ${toneInk.danger}`}>{words.unreadable(error)}</p>;
  if (!document || !view)
    return (
      <div role="status" aria-label={words.loading} className={pad}>
        <SkeletonList rows={3} />
      </div>
    );

  async function save() {
    const definition = checkable(text);
    if (!definition) return;
    setProblem(null);
    setBusy(true);
    try {
      const draft = await api.stateMachine.save(definition, revision);
      // The next read shows the machine as saved, in place of the text that was saved, but
      // never over anything typed since.
      loaded.current = text;
      onSaved(draft, words.saved);
    } catch (cause) {
      setProblem(apiErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setProblem(null);
    setBusy(true);
    try {
      const draft = await api.stateMachine.discard(revision);
      // The module's own machine comes back on the next read; show it in place of the edit,
      // but never over anything typed since.
      loaded.current = text;
      onSaved(draft, words.discarded);
    } catch (cause) {
      setProblem(apiErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const { problems } = view;
  const notices = (
    <>
      <p className="text-gray-500">{view.origin}</p>
      {view.edited && <p className="text-gray-700 dark:text-gray-300">{words.edited}</p>}
      {view.stale && (
        <p role="status" className={`rounded-md border p-3 ${toneStrip.attention}`}>
          {words.stale}
        </p>
      )}
      {view.readOnly && <p className="text-gray-500">{view.readOnly}</p>}
      {problems.summary && (
        <p
          role="status"
          aria-live="polite"
          className={
            problems.list.some((entry) => !entry.inherited && !entry.warning)
              ? toneInk.danger
              : "text-gray-600 dark:text-gray-400"
          }
        >
          {problems.summary}
        </p>
      )}
      {problems.list.length > 0 && <ProblemList problems={problems.list} />}
    </>
  );

  return (
    <>
      <JsonEditor
        title={words.title}
        leading={
          <div role="group" aria-label={words.view}>
            <Segmented
              cols={2}
              value={reading}
              onChange={setReading}
              options={[
                { value: "diagram", label: words.diagram },
                { value: "json", label: words.json },
              ]}
            />
          </div>
        }
        alternate={{
          shown: reading === "diagram",
          leave: () => setReading("json"),
          node: (
            <div className="flex h-full min-h-0 flex-col gap-2 p-4 text-xs">
              {drawn && drawn.text !== text && (
                <p role="status" className={`rounded-md border p-3 ${toneStrip.attention}`}>
                  {words.lastValid}
                </p>
              )}
              {!drawn || !scenes.length ? (
                <EmptyState title={drawn ? S.activities.studioPlayer.map.none : words.noDrawing} />
              ) : (
                <MachineDiagram
                  machine={drawn.machine}
                  sceneId={shownScene}
                  scenes={scenes}
                  onScene={setScene}
                  fill
                />
              )}
            </div>
          ),
        }}
        editorLabel={words.field}
        savedLabel={words.savedSide}
        saveLabel={words.saveLabel}
        value={text}
        saved={saved}
        editable={view.canEdit}
        readOnly={!view.canEdit}
        busy={busy}
        error={problem}
        about={<p>{words.about}</p>}
        actions={
          view.canEdit &&
          view.edited && (
            <Button size="sm" disabled={busy} onClick={() => setDiscarding(true)}>
              {words.discard}
            </Button>
          )
        }
        notices={notices}
        onChange={(value) => {
          setText(value);
          setProblem(null);
        }}
        onSave={() => void save()}
      />
      {discarding && (
        <ConfirmModal
          cancelLabel={S.common.cancel}
          open
          title={words.discard}
          confirmLabel={words.discard}
          onClose={() => setDiscarding(false)}
          onConfirm={() => {
            setDiscarding(false);
            void discard();
          }}
        >
          <p>{words.discardConfirm}</p>
        </ConfirmModal>
      )}
    </>
  );
}
