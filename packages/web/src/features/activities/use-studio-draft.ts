/** The studio draft (studio-draft.ts) held for one open activity, re-rendering as it moves. */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { StudioDraft, type DraftContext, type DraftPorts } from "./studio-draft";
import { useHeldWork } from "./unsaved-work-context";

/**
 * The page's draft. `ports` may change from render to render; the draft always calls the
 * latest. The editor is keyed by activity, so one draft lives as long as the page shows it.
 */
export function useStudioDraft(ports: DraftPorts, context: DraftContext): StudioDraft {
  const latest = useRef(ports);
  latest.current = ports;
  const [draft] = useState(
    () =>
      new StudioDraft(
        {
          get api() {
            return latest.current.api;
          },
          saved: () => latest.current.saved(),
          toast: (text) => latest.current.toast(text),
        },
        context,
      ),
  );
  useSyncExternalStore(draft.subscribe, draft.getState);
  // The draft's texts are the page's: they survive a section switch, not leaving the activity.
  useHeldWork({ label: "draft" }, draft.state.dirty);
  draft.observe(context);
  useEffect(() => {
    draft.attach();
    return () => draft.detach();
  }, [draft]);
  const { editable, available, running, stages, hasAgent } = context;
  useEffect(() => {
    draft.setContext({ editable, available, running, stages, hasAgent });
  }, [draft, editable, available, running, stages, hasAgent]);
  return draft;
}
