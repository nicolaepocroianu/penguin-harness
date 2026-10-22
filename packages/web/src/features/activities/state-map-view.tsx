/**
 * The behavior map beside or under the player, so what the module does can be read with it:
 * the scene playing, drawn the way waf-loom's viewer draws it (machine-diagram.tsx), with the
 * state the activity reports itself in marked as it plays.
 *
 * The machine is read from the module's own configuration through the sandbox payload,
 * never from the playing page, so the map shows what the module declares rather than what
 * a page chose to say.
 */
import { useEffect, useId, useState } from "react";
import {
  Button,
  Chevron,
  EmptyState,
  ICON_SIZE,
  IconButton,
  InfoPopover,
  SkeletonList,
} from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { machineOf, machineScenes, type StateMachine } from "./state-map";
import { MachineDiagram } from "./machine-diagram";
import { useActivityClient } from "./activity-client";

export function StateMapView({
  revision,
  onEdit,
  language,
  reportedScene,
  reportedPhase,
  startScene,
  open,
  onToggle,
  liveCount = 0,
}: {
  /** The draft's revision: a saved edit of the machine is drawn again. */
  revision?: string;
  /** Opens the state machine's editor; absent when it cannot be opened here. */
  onEdit?: () => void;
  /** Whether the map is shown; the header stays either way, so it can be shown again. */
  open: boolean;
  onToggle: () => void;
  language: string;
  reportedScene: string | null;
  reportedPhase: string | null;
  startScene: string;
  /** How many tap targets the player reports for the state it is in. */
  liveCount?: number;
}) {
  const { api } = useActivityClient();
  const words = S.activities.studioPlayer.map;
  const [read, setRead] = useState<
    | { state: "loading" }
    | { state: "none" }
    | { state: "error"; message: string }
    | { state: "ready"; machine: StateMachine }
  >({ state: "loading" });
  const [choice, setChoice] = useState<string | null>(null);
  const bodyId = useId();
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRead({ state: "loading" });
    const query = language ? `?${new URLSearchParams({ language })}` : "";
    api.sandbox
      .payload(query)
      .then((payload) => {
        if (cancelled) return;
        const machine = machineOf(payload.configuration);
        setRead(machine ? { state: "ready", machine } : { state: "none" });
      })
      .catch((cause) => {
        if (!cancelled) setRead({ state: "error", message: apiErrorText(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [api, language, open, revision]);
  // A scene change in the player takes the map with it; a scene the author picked holds
  // until then.
  useEffect(() => setChoice(null), [reportedScene]);

  const machine = open && read.state === "ready" ? read.machine : null;
  const scenes = machine ? machineScenes(machine) : [];
  const shown =
    choice ??
    (reportedScene && scenes.includes(reportedScene)
      ? reportedScene
      : scenes.includes(startScene)
        ? startScene
        : machine && scenes.includes(machine.initial)
          ? machine.initial
          : (scenes[0] ?? ""));
  const activeState =
    reportedScene && reportedPhase && shown === reportedScene
      ? `${reportedScene}.${reportedPhase}`
      : null;
  return (
    <div className="space-y-2">
      <div className="flex min-h-8 items-center gap-2">
        <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold">
          {words.title}
          <InfoPopover label={words.title}>{words.inspect.hint}</InfoPopover>
        </h3>
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {words.edit}
          </Button>
        )}
        <IconButton
          size="sm"
          variant="ghost"
          label={open ? words.hide : words.show}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <Chevron open={open} size={ICON_SIZE.chevronDense} />
        </IconButton>
      </div>
      <div id={bodyId} hidden={!open}>
        {!open ? null : read.state === "loading" ? (
          <div role="status" aria-label={words.loading}>
            <SkeletonList rows={3} />
          </div>
        ) : read.state === "error" ? (
          <p className={`text-xs ${toneInk.attention}`}>{words.unreadable(read.message)}</p>
        ) : !machine || !scenes.length ? (
          <EmptyState title={words.none} />
        ) : (
          <MachineDiagram
            machine={machine}
            sceneId={shown}
            scenes={scenes}
            onScene={setChoice}
            activeState={activeState}
            liveCount={activeState ? liveCount : 0}
          />
        )}
      </div>
    </div>
  );
}
