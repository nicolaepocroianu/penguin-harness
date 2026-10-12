/**
 * The React side of the unsaved-work guard (unsaved-work.ts): the activities host owns one
 * guard and its one dialog, editors say what they hold with `useHeldWork`, and whatever would
 * throw work away asks `confirm` first, through the app's own ConfirmModal rather than the
 * browser's dialog.
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { S } from "../../lib/strings";
import { UnsavedWork, type HeldWork, type Leave } from "./unsaved-work";

export interface UnsavedWorkGuard {
  work: UnsavedWork;
  /**
   * Run `then` once the author agrees to lose what `leave` would throw away: at once when it
   * throws nothing away. Declining runs `onCancel`.
   */
  confirm: (leave: Leave, then: () => void, onCancel?: () => void) => void;
}

const UnsavedWorkContext = createContext<UnsavedWorkGuard | null>(null);

export const UnsavedWorkProvider = UnsavedWorkContext.Provider;

/** The guard and the dialog it asks through; the activities host renders `modal`. */
export function useUnsavedWorkGuard(): { guard: UnsavedWorkGuard; modal: ReactNode } {
  const [work] = useState(() => new UnsavedWork());
  const [asking, setAsking] = useState<Leave | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const confirm = useCallback(
    (leave: Leave, then: () => void, onCancel?: () => void) => {
      const lost = work.lost(leave);
      if (!lost.length) return then();
      // One dialog at a time: a second ask while it is already open would clobber the first
      // request's `pending`/`cancel` (its own Cancel or Discard would then run whichever
      // request happened to be overwritten last, silently dropping the other — e.g. the
      // route blocker's `blocker.reset()` never firing because a Project-switch guard asked
      // in the meantime). Refuse the new request instead: treat it the same as the author
      // declining it.
      if (pending.current !== null) return onCancel?.();
      pending.current = () => {
        work.discard(lost);
        then();
      };
      cancel.current = onCancel ?? null;
      setAsking(leave);
    },
    [work],
  );
  const [guard] = useState<UnsavedWorkGuard>(() => ({ work, confirm }));
  const close = () => {
    setAsking(null);
    cancel.current?.();
    pending.current = cancel.current = null;
  };
  const proceed = () => {
    setAsking(null);
    const then = pending.current;
    pending.current = cancel.current = null;
    then?.();
  };
  const modal = (
    <ConfirmModal
      open={asking !== null}
      title={S.activities.discardTitle}
      confirmLabel={S.activities.discardConfirm}
      onClose={close}
      onConfirm={proceed}
    >
      <p className="text-sm">
        {asking?.kind === "section" ? S.activities.discardSection : S.activities.discard}
      </p>
    </ConfirmModal>
  );
  return { guard, modal };
}

/** The guard, re-rendering whenever what is held changes. */
export function useUnsavedWork(): UnsavedWorkGuard {
  const guard = useContext(UnsavedWorkContext);
  if (!guard) throw new Error("useUnsavedWork outside the activities host");
  useSyncExternalStore(guard.work.subscribe, guard.work.getVersion);
  return guard;
}

/**
 * Say that this editor holds `work` while `held`. Said again on every render, so work the
 * author discarded counts again as soon as the editor still holds it; an editor that goes
 * holds nothing.
 */
export function useHeldWork(work: HeldWork, held: boolean): void {
  const guard = useContext(UnsavedWorkContext);
  if (!guard) throw new Error("useHeldWork outside the activities host");
  const [id] = useState(() => guard.work.holder());
  useLayoutEffect(() => guard.work.set(id, held ? work : null));
  useLayoutEffect(() => () => guard.work.set(id, null), [guard, id]);
}
