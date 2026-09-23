/**
 * The studio's conversation: an agent asked about whatever the author has open, answered
 * beside the work instead of in a chat page that has lost the activity.
 *
 * It is the chat page's transcript (`MessageStream` over `useSessionStream`), so tool
 * calls, approvals and reasoning read exactly as they do there, and "Open in chat" is the
 * same Session with the full composer. What this panel adds is the focus: the first
 * message starts an assist run that tells the agent where the author is, and a follow-up
 * says so again when the author has moved.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { ActivityRun, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { apiErrorText } from "../../lib/api-error";
import { approvalKey } from "../../lib/omni/stream-model";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { MessageStream, type StreamRenderContext } from "../chat/message-stream";
import { useSessionStream } from "../chat/use-session-stream";
import { focusLabel, followUpText, latestConversation, type AssistFocus } from "./conversation";
import type { ProposalBase, ProposalChange } from "./proposal";
import { ProposalCard } from "./proposal-card";
import type { ProposalRead } from "./use-assist-proposal";

export function ConversationPanel({
  endpoint,
  runs,
  runner,
  revision,
  focus,
  editable,
  onStarted,
  base,
  dirty,
  onAccept,
  proposal,
  onReplyEnded,
}: {
  /** The activity's API path. */
  endpoint: string;
  runs: readonly ActivityRunSummary[];
  /** Who answers, as the stage routes take it; null when no agent is chosen. */
  runner: Record<string, string> | null;
  revision: string;
  focus: AssistFocus;
  editable: boolean;
  /** A new conversation is a run, and belongs in the activity's history straight away. */
  onStarted: (run: ActivityRun) => void;
  /** The saved draft a proposal is shown against. */
  base: ProposalBase;
  /** The author has unsaved edits of their own. */
  dirty: boolean;
  onAccept: (change: ProposalChange) => Promise<void>;
  /** The newest conversation's proposal, as the page last read it. */
  proposal: ProposalRead | null;
  /** A reply ended, so the agent may have written a new proposal. */
  onReplyEnded: () => void;
}) {
  const latest = latestConversation(runs);
  // Undefined follows the newest conversation; null is a fresh one the next message starts.
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const sessionId = choice === undefined ? (latest?.sessionId ?? null) : choice;
  const run = sessionId ? runs.find((entry) => entry.sessionId === sessionId) : undefined;
  const startedRunning = run?.status === "running" ? "running" : "idle";
  return (
    <Conversation
      // A different Session is a different transcript; nothing of the last one carries over.
      key={sessionId ?? "fresh"}
      sessionId={sessionId}
      base={base}
      dirty={dirty}
      onAccept={onAccept}
      proposal={run && proposal?.runId === run.runId ? proposal : null}
      onReplyEnded={onReplyEnded}
      initialStatus={startedRunning}
      endpoint={endpoint}
      runner={runner}
      revision={revision}
      focus={focus}
      editable={editable}
      onFresh={() => setChoice(null)}
      onSession={(id) => setChoice(id)}
      onStarted={onStarted}
    />
  );
}

function Conversation({
  sessionId,
  base,
  dirty,
  onAccept,
  proposal: read,
  onReplyEnded,
  initialStatus,
  endpoint,
  runner,
  revision,
  focus,
  editable,
  onFresh,
  onSession,
  onStarted,
}: {
  sessionId: string | null;
  base: ProposalBase;
  dirty: boolean;
  onAccept: (change: ProposalChange) => Promise<void>;
  proposal: ProposalRead | null;
  onReplyEnded: () => void;
  initialStatus: "idle" | "running";
  endpoint: string;
  runner: Record<string, string> | null;
  revision: string;
  focus: AssistFocus;
  editable: boolean;
  onFresh: () => void;
  onSession: (sessionId: string) => void;
  onStarted: (run: ActivityRun) => void;
}) {
  const words = S.activities.studioConversation;
  const stream = useSessionStream(sessionId, initialStatus);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where the author was when they last spoke: the first message's focus, then each
  // follow-up's. Null on a resumed conversation, whose first message this page never saw.
  const lastSent = useRef<AssistFocus | null>(null);
  const running = stream.taskState === "running";
  const proposal = read?.proposal ?? null;
  const proposalError = read?.error ?? null;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) onReplyEnded();
    wasRunning.current = running;
  }, [running, onReplyEnded]);

  const onApprove = useCallback(
    async (toolCallId: string, decision: "allow" | "deny", origin: string[]) => {
      if (!sessionId) return;
      stream.markLocalDecision(toolCallId);
      const key = approvalKey(origin, toolCallId);
      try {
        await api.postApproval(sessionId, toolCallId, { decision });
        stream.resolveApproval(key);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) stream.resolveApproval(key);
        else setError(apiErrorText(cause));
      }
    },
    [sessionId, stream],
  );
  const ctx: StreamRenderContext = useMemo(
    () => ({
      pendingApprovals: stream.pendingApprovals,
      onApprove,
      origin: [],
      taskRunning: running,
    }),
    [stream.pendingApprovals, onApprove, running],
  );
  const items = useMemo(
    () =>
      stream.prefixItems.length
        ? [...stream.prefixItems, ...stream.model.items]
        : stream.model.items,
    // The model mutates in place; its version is the repaint signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version],
  );

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !runner || sending) return;
    setSending(true);
    setError(null);
    try {
      if (!sessionId) {
        const run = await apiFetch<ActivityRun>(`${endpoint}/assist`, {
          method: "POST",
          body: { ...runner, expectedRevision: revision, message, focus },
        });
        if (run.status !== "running" || !run.sessionId)
          throw new Error(run.error ?? S.activities.status[run.status]);
        onStarted(run);
        lastSent.current = focus;
        setDraft("");
        onSession(run.sessionId);
        return;
      }
      // A reply still being written takes the message next, rather than refusing it.
      const result = await api.postTask(sessionId, {
        input: [{ type: "text", text: followUpText(message, focus, lastSent.current) }],
        queueIfBusy: true,
      });
      lastSent.current = focus;
      setDraft("");
      if (result.sessionId !== sessionId) onSession(result.sessionId);
    } catch (cause) {
      setError(apiErrorText(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {sessionId && (
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2 text-sm dark:border-gray-800">
          <Link
            to={`/chat/${encodeURIComponent(sessionId)}`}
            className="text-brand-600 hover:text-brand-700 dark:text-brand-300"
          >
            {words.openInChat}
          </Link>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onFresh} disabled={sending}>
            {words.fresh}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {sessionId ? (
          <MessageStream
            items={items}
            version={stream.version}
            ctx={ctx}
            older={{
              hasMore: stream.older.hasMore,
              loading: stream.older.loading,
              error: stream.older.error,
              prependedCount: stream.prefixItems.length,
              onLoad: stream.loadOlder,
            }}
            // The excerpt's text is already the Markdown quote a message should carry.
            onAddExcerpt={(excerpt) =>
              setDraft((text) => `${text}${text ? "\n" : ""}${excerpt.text}\n`)
            }
          />
        ) : (
          <p className="p-4 text-sm text-gray-500">{editable ? words.empty : words.readOnly}</p>
        )}
      </div>
      {(proposal || proposalError) && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-gray-200 p-3 dark:border-gray-800">
          {proposal ? (
            <ProposalCard
              proposal={proposal}
              base={base}
              dirty={dirty}
              onAccept={editable ? onAccept : undefined}
            />
          ) : (
            <p role="status" className={`text-xs ${toneInk.attention}`}>
              {S.activities.studioProposal.unreadable(proposalError!)}
            </p>
          )}
        </div>
      )}
      {editable && (
        <form
          onSubmit={(event) => void send(event)}
          className="space-y-2 border-t border-gray-200 p-3 dark:border-gray-800"
        >
          <p className="truncate text-xs text-gray-500">{words.about(focusLabel(focus))}</p>
          <Textarea
            aria-label={words.placeholder}
            placeholder={words.placeholder}
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {(error || stream.error || !runner) && (
            <p role="alert" className={`text-xs ${toneInk.danger}`}>
              {error ?? stream.error ?? words.noAgent}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {running && sessionId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void api.postAbort(sessionId).catch(() => {})}
              >
                {words.stop}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={!draft.trim() || !runner || sending}
            >
              {words.send}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
