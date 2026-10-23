/**
 * A thinking item of the session's stream, drawn by the shared UI package's `ThinkingBlock`:
 * this binds the item's streaming and stop state to the row's run state and labels.
 */
import { StatusIcon, ThinkingBlock } from "@waterford/waf-harness-ui";
import { S } from "../../lib/strings";
import type { ThinkingItem } from "../../lib/omni/stream-model";

export function SessionThinking({ item }: { item: ThinkingItem }) {
  const failed = item.stopReason !== undefined && item.stopReason !== "completed";
  const state = item.streaming ? "running" : failed ? "failed" : "done";
  return (
    <ThinkingBlock
      state={state}
      stateLabel={item.streaming ? S.chat.workRunning : failed ? item.stopReason : S.chat.workDone}
      label={S.chat.thinking}
      text={item.thinking}
      startedAtMs={item.startedAtMs}
      durationMs={item.durationMs}
      stopReason={failed ? item.stopReason : undefined}
    />
  );
}

/**
 * What a stream with its reasoning hidden shows while the agent is still thinking: one muted
 * line in the row's own metrics, so the run reads as working rather than stalled. The words
 * carry the state; the spinner is decorative beside them.
 */
export function ThinkingHiddenLine() {
  return (
    <div
      data-thinking-hidden
      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-fg-muted"
    >
      <StatusIcon state="running" />
      <span>{S.chat.thinkingHidden}</span>
    </div>
  );
}
