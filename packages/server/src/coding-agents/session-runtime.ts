/**
 * A coding agent (Claude Code, Codex, OpenCode, ...) as an ordinary Penguin Session. The
 * session manager drives any `RuntimeSession`; this one drives an ACP session and yields the
 * same OmniMessages a core Session does, so the sidebar, the chat view, approvals and the
 * Trace all work unchanged:
 *
 * - each turn is one request: `request_begin`, the agent's text, thinking and tool calls,
 *   then `request_end` (or an abort);
 * - the agent's permission asks go through the Session's approval function, so the
 *   Session's approval mode applies and asks appear as ordinary approval cards; the
 *   decision is yielded as `approval_decision`, which core's engine would otherwise do;
 * - everything complete is written to the Session's Trace with core's own Writer, in the
 *   same place and format as any other Session's (the manager never writes Traces itself).
 *
 * - each turn's tokens, as the agent reported them, become the turn's `token_usage`, carrying
 *   the cost the agent itself charged for it when it prices its own work — so these Sessions
 *   count in usage and cost like any other.
 *
 * What an ACP agent does not report, this cannot invent: an agent that reports no usage
 * records none, and no title model runs, so the title stays the first message's fallback.
 */
import {
  Writer,
  abortEvent,
  addTokenCounts,
  emptyTokenCounts,
  approvalDecision,
  partialText,
  partialThinking,
  requestBegin,
  requestEnd,
  sessionMeta,
  textMessage,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  type ApproveFn,
  type ApprovalDecision,
  type OmniMessage,
  type TokenCounts,
  type ToolCallPayload,
} from "@prismshadow/penguin-core";
import type {
  AgentPermissionOutcome,
  AgentPermissionRequest,
  AgentSessionEvent,
  AgentStopReason,
  AgentToolCall,
  AgentTurnUsage,
  CodingAgentManager,
} from "@prismshadow/penguin-coding-agents";
import type { RuntimeSession } from "../runtime/session-manager.js";

/** The provider group every coding-agent model row and Session carries. */
export const CODING_AGENT_PROVIDER = "coding-agent";

/** Separates agent id, config option id and value inside a coding-agent `modelId`. */
const MODEL_SEP = "::";

/** A coding-agent `modelId`: the agent, and optionally one of its advertised models. */
export function parseCodingAgentModel(modelId: string): {
  agentId: string;
  model: { configId: string; value: string } | null;
} {
  const [agentId = "", configId, ...value] = modelId.split(MODEL_SEP);
  if (configId === undefined || value.length === 0) return { agentId, model: null };
  return { agentId, model: { configId, value: value.join(MODEL_SEP) } };
}

export function codingAgentModelId(agentId: string, configId: string, value: string): string {
  return [agentId, configId, value].join(MODEL_SEP);
}

/** ACP tool kinds that only look: the read-only approval mode lets these through. */
const READ_KINDS = new Set(["read", "search", "think", "fetch"]);

const STOP_ERRORS: Partial<Record<AgentStopReason, string>> = {
  failed: "The coding agent's connection failed during the turn.",
  refusal: "The coding agent refused the task.",
  max_tokens: "The coding agent ran out of output before finishing.",
  max_turn_requests: "The coding agent hit its request limit before finishing.",
  cancelled: "The coding agent stopped before finishing.",
};

/** How a turn that ended with `reason` is recorded; `aborted` when the Session stopped it. */
export function turnEndMessages(reason: AgentStopReason, aborted: boolean): OmniMessage[] {
  if (reason === "end_turn") return [requestEnd("completed")];
  if (aborted) return [requestEnd("aborted"), abortEvent()];
  return [
    requestEnd("fatal", {
      errorMessage: STOP_ERRORS[reason] ?? "The coding agent did not finish.",
    }),
  ];
}

/**
 * One turn's ACP events as OmniMessages. Streamed text and thinking become `partial_*`
 * start/delta/stop runs closed by one complete message (what the Trace keeps); a tool call is
 * emitted once, when first seen, and its output once, when it completes or fails. Kinds are
 * remembered by title for `toolPermission`, which the manager asks by tool name.
 */
export class AcpTurnTranslator {
  private open: { kind: "text" | "thinking"; buffer: string } | null = null;
  private readonly calls = new Map<
    string,
    { message: OmniMessage<ToolCallPayload>; outputDone: boolean }
  >();
  private readonly kinds = new Map<string, string | undefined>();

  translate(event: AgentSessionEvent): OmniMessage[] {
    switch (event.type) {
      case "message_chunk":
        return this.chunk("text", event.delta);
      case "thought_chunk":
        return this.chunk("thinking", event.delta);
      case "tool_call":
      case "tool_call_update":
        return [...this.close(), ...this.tool(event.call)];
      case "notice":
        return [...this.close(), textMessage("assistant", `> ${event.message}`)];
      default:
        return [];
    }
  }

  /** The complete tool-call message for a call, emitting it first if it is new. */
  callFor(call: AgentToolCall): { emitted: OmniMessage[]; message: OmniMessage<ToolCallPayload> } {
    const known = this.calls.get(call.toolCallId);
    if (known) return { emitted: [], message: known.message };
    const emitted = [...this.close(), ...this.tool(call)];
    return { emitted, message: this.calls.get(call.toolCallId)!.message };
  }

  /** Whatever is still streaming, closed; called at the turn's end. */
  finish(): OmniMessage[] {
    return this.close();
  }

  permissionOf(toolName: string): "r" | "rw" | undefined {
    if (!this.kinds.has(toolName)) return undefined;
    const kind = this.kinds.get(toolName);
    return kind !== undefined && READ_KINDS.has(kind) ? "r" : "rw";
  }

  private chunk(kind: "text" | "thinking", delta: string): OmniMessage[] {
    const out: OmniMessage[] = [];
    if (this.open?.kind !== kind) {
      out.push(...this.close());
      this.open = { kind, buffer: "" };
      out.push(kind === "text" ? partialText("start") : partialThinking("start"));
    }
    this.open.buffer += delta;
    out.push(kind === "text" ? partialText("delta", delta) : partialThinking("delta", delta));
    return out;
  }

  private close(): OmniMessage[] {
    if (this.open === null) return [];
    const { kind, buffer } = this.open;
    this.open = null;
    return kind === "text"
      ? [partialText("stop"), textMessage("assistant", buffer)]
      : [partialThinking("stop"), thinkingMessage(buffer)];
  }

  private tool(call: AgentToolCall): OmniMessage[] {
    const out: OmniMessage[] = [];
    let record = this.calls.get(call.toolCallId);
    if (record === undefined) {
      record = {
        message: toolCall({
          name: call.title,
          arguments: JSON.stringify(call.rawInput ?? {}),
          toolCallId: call.toolCallId,
        }),
        outputDone: false,
      };
      this.calls.set(call.toolCallId, record);
      this.kinds.set(call.title, call.kind);
      out.push(record.message);
    }
    if (!record.outputDone && (call.status === "completed" || call.status === "failed")) {
      record.outputDone = true;
      out.push(
        toolCallOutput({
          output: call.output ?? (call.status === "failed" ? "The tool failed." : ""),
          toolCallId: call.toolCallId,
        }),
      );
    }
    return out;
  }
}

/** The ACP permission option a Penguin decision picks; cancelled when none fits. */
export function permissionOutcome(
  request: AgentPermissionRequest,
  decision: ApprovalDecision,
): AgentPermissionOutcome {
  const kinds =
    decision === "allow" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const kind of kinds) {
    const option = request.options.find((o) => o.kind === kind);
    if (option) return { outcome: "selected", optionId: option.optionId };
  }
  return { outcome: "cancelled" };
}

type Money = { amount: number; currency: string };

/**
 * Turns what an agent reports about usage into `token_usage`. Tokens come per turn (the
 * prompt response) and add up to the Session's total. Cost comes as the agent's running total
 * for its own session, so a turn is charged what that total grew by since the last charge; a
 * reopened Session starts from what its Trace already charged, when the agent resumed the same
 * session and its total therefore carried on.
 */
export class UsageLedger {
  private session: TokenCounts;
  private charged: Money | null;
  private latest: Money | null;

  constructor(start: { session?: TokenCounts; cost?: Money } = {}) {
    this.session = start.session ?? emptyTokenCounts();
    this.charged = start.cost ?? null;
    this.latest = this.charged;
  }

  observeCost(cost: Money): void {
    this.latest = cost;
  }

  /** The turn's `token_usage`, or null when the agent said nothing about what it used. */
  turn(usage: AgentTurnUsage | undefined): OmniMessage | null {
    if (usage === undefined) return null;
    const request: TokenCounts = {
      cache_read: usage.cachedReadTokens,
      cache_write: usage.cachedWriteTokens,
      // Thinking is output the model produced, as a core Session's usage counts it.
      output: usage.outputTokens + usage.thoughtTokens,
      total: usage.totalTokens,
    };
    this.session = addTokenCounts(this.session, request);
    let cost: Money | undefined;
    const latest = this.latest;
    if (latest !== null && (this.charged === null || this.charged.currency === latest.currency)) {
      const amount = latest.amount - (this.charged?.amount ?? 0);
      // A total that went down is an agent restarting its count, not a refund.
      if (amount >= 0) cost = { amount, currency: latest.currency };
      this.charged = latest;
    }
    return tokenUsage(this.session, request, cost);
  }
}

/**
 * Where a reopened Session's usage left off, read from its Trace: the last running token
 * total, and — only when the agent resumed the same session, whose own cost total therefore
 * carried on — the sum of what earlier turns were charged. A cost reported in more than one
 * currency is not summed.
 */
export function usageSoFar(
  trace: OmniMessage[],
  sameAgentSession: boolean,
): { session?: TokenCounts; cost?: Money } {
  let session: TokenCounts | undefined;
  let cost: Money | undefined;
  let mixed = false;
  for (const message of trace) {
    const payload = message.payload;
    if (!("type" in payload) || payload.type !== "token_usage") continue;
    session = payload.session;
    const charged = payload.reported_cost;
    if (charged === undefined) continue;
    if (cost === undefined) cost = { ...charged };
    else if (cost.currency === charged.currency) cost.amount += charged.amount;
    else mixed = true;
  }
  return {
    ...(session !== undefined ? { session } : {}),
    ...(sameAgentSession && cost !== undefined && !mixed ? { cost } : {}),
  };
}

/** A queue a subscriber pushes into and the turn loop awaits. */
class EventQueue {
  private readonly items: AgentSessionEvent[] = [];
  private waiting: ((event: AgentSessionEvent) => void) | null = null;
  push(event: AgentSessionEvent): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(event);
    } else this.items.push(event);
  }
  next(): Promise<AgentSessionEvent> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
}

export interface AcpRuntimeOptions {
  manager: CodingAgentManager;
  /** The Penguin Session id (what the sidebar, routes and Trace are keyed by). */
  sessionId: string;
  /** The agent's own id for the same conversation. */
  acpSessionId: string;
  provider: string;
  modelId: string;
  workspace: string;
  /** The owning Penguin Agent's state directory, recorded in session_meta like any Session. */
  agentState: string;
  writer: Writer;
  /** The Trace already has its session_meta (a reopened Session). */
  metaWritten: boolean;
  /** Said once, before the next turn: how this Session was reopened, when that matters. */
  notice?: string;
  /** Where a reopened Session's usage left off (see UsageLedger). */
  usageStart?: { session?: TokenCounts; cost?: Money };
}

export class AcpRuntimeSession implements RuntimeSession {
  readonly sessionId: string;
  /**
   * One for the Session's life: tool kinds seen in earlier turns still answer the read-only
   * approval mode, and a turn always ends with `finish()`, so nothing streams across turns.
   */
  private readonly translator = new AcpTurnTranslator();
  private metaWritten: boolean;
  private notice: string | undefined;
  private readonly usage: UsageLedger;

  constructor(private readonly options: AcpRuntimeOptions) {
    this.sessionId = options.sessionId;
    this.metaWritten = options.metaWritten;
    this.notice = options.notice;
    this.usage = new UsageLedger(options.usageStart);
  }

  async *run(
    newMessages: OmniMessage[],
    opts: { approve: ApproveFn; signal: AbortSignal },
  ): AsyncGenerator<OmniMessage> {
    const { manager, acpSessionId, writer } = this.options;
    await this.ensureMeta();
    for (const message of newMessages) await writer.write(message);
    const text = newMessages
      .flatMap((m) => {
        const payload = m.payload;
        return "type" in payload && payload.type === "text" && payload.role === "user"
          ? [payload.text]
          : [];
      })
      .join("\n");
    const queue = new EventQueue();
    const unsubscribe = manager.subscribe(acpSessionId, (event) => queue.push(event));
    const translator = this.translator;
    try {
      yield* this.emit([requestBegin()]);
      if (this.notice !== undefined) {
        yield* this.emit([textMessage("assistant", `> ${this.notice}`)]);
        this.notice = undefined;
      }
      // prompt() logs its own turn_end on every path but one: a signal that fired before
      // the turn began. That one is synthesized so the loop below always ends.
      const turn = manager.prompt(acpSessionId, text, { signal: opts.signal }).catch(() =>
        queue.push({
          type: "turn_end",
          sessionId: acpSessionId,
          stopReason: opts.signal.aborted ? "cancelled" : "failed",
        }),
      );
      for (;;) {
        const event = await queue.next();
        if (event.type === "permission_request") {
          const { emitted, message } = translator.callFor(event.request.toolCall);
          yield* this.emit(emitted);
          const decision = await opts.approve(message);
          manager.respondPermission(
            event.request.requestId,
            permissionOutcome(event.request, decision),
          );
          yield* this.emit([approvalDecision(decision, event.request.toolCall.toolCallId)]);
          continue;
        }
        if (event.type === "turn_end") {
          const used = this.usage.turn(event.usage);
          yield* this.emit([
            ...translator.finish(),
            ...(used !== null ? [used] : []),
            ...turnEndMessages(event.stopReason, opts.signal.aborted),
          ]);
          break;
        }
        if (event.type === "usage" && event.cost !== undefined) this.usage.observeCost(event.cost);
        yield* this.emit(translator.translate(event));
      }
      await turn;
    } finally {
      unsubscribe();
    }
  }

  async *compact(): AsyncGenerator<OmniMessage> {
    // The agent manages its own context; there is nothing here to compact.
  }
  compactability() {
    return "unsupported" as const;
  }
  steer(): boolean {
    return false;
  }
  skipReconnectWait(): boolean {
    return false;
  }
  toolPermission(name: string): "r" | "rw" | undefined {
    return this.translator.permissionOf(name);
  }
  async generateTitle() {
    return { title: null, usage: null };
  }
  dispose(): void {
    // Leave the conversation on the agent: the Session reopens it when it is next used.
    void this.options.manager
      .disposeSession(this.options.acpSessionId, { keepOnAgent: true })
      .catch(() => undefined);
  }

  private async ensureMeta(): Promise<void> {
    if (this.metaWritten) return;
    const { sessionId, provider, modelId, workspace, agentState, writer } = this.options;
    await writer.write(
      sessionMeta({
        session_id: sessionId,
        provider,
        model_id: modelId,
        // The agent owns its context and does not say how large it is.
        model_context_window: "unknown",
        system_prompt: "",
        agent_state: agentState,
        workspace,
      }),
    );
    this.metaWritten = true;
  }

  private async *emit(messages: OmniMessage[]): AsyncGenerator<OmniMessage> {
    for (const message of messages) {
      // The Writer keeps only complete messages; partials stream and are not recorded.
      await this.options.writer.write(message);
      yield message;
    }
  }
}
