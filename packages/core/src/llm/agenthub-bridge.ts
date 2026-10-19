/**
 * The subscription clients (GitHub Copilot, ChatGPT / Codex) on the MMSP gateway.
 *
 * Those two clients live only in AgentHub (with this repository's patch): MMSP has no client
 * for either. AgentHub speaks the first streaming protocol — `start`/`delta`/`stop` events
 * whose items run together and are aggregated by the reader — while everything above this
 * module reads MMSP's: one `.delta` fragment or `.done` item per event, items never
 * interleaved, and one `stop` event that ends a committed stream. `AgentHubBridgeClient`
 * wraps AgentHub's client behind the slice of MMSP's `AutoLLMClient` that `GenerativeModel`
 * and `listEndpointModels` use, translating history both ways and the event stream forward.
 *
 * The aggregation rules are AgentHub's own (`LLMClient.concatUniEventsToUniMessage`), so a
 * `.done` item here is exactly the item AgentHub commits to its history.
 */
import { AutoLLMClient as AgentHubAutoLLMClient } from "@prismshadow/agenthub";
import type {
  ChatGPTCredentialProvider,
  PartialContentItem as V1PartialItem,
  UniEvent as V1Event,
  UniMessage as V1Message,
} from "@prismshadow/agenthub";
import type {
  ContentItem,
  Fidelity,
  UniConfig,
  UniEvent,
  UniMessage,
  UsageMetadata,
  FinishReason,
} from "@prismshadow/mmsp";

/** The client types only AgentHub serves; every other type goes to MMSP. */
export const AGENTHUB_CLIENT_TYPES: ReadonlySet<string> = new Set([
  "github-copilot",
  "chatgpt-codex",
]);

/** Whether a client type is served by AgentHub's subscription clients rather than MMSP. */
export function isAgentHubClientType(clientType: string | null | undefined): boolean {
  return clientType != null && AGENTHUB_CLIENT_TYPES.has(clientType.toLowerCase());
}

/** The stateful client surface `GenerativeModel` drives, met by MMSP's client and the bridge. */
export interface StatefulLLMClient {
  streamingResponseStateful(options: {
    message: UniMessage;
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncIterable<UniEvent>;
  getHistory(): UniMessage[];
  setHistory(history: UniMessage[]): void;
  listModels(): Promise<string[]>;
}

export interface AgentHubBridgeOptions {
  model: string;
  clientType: string;
  apiKey?: string;
  baseUrl?: string | null;
  defaultHeaders?: Record<string, string>;
  chatgptCredentials?: ChatGPTCredentialProvider;
}

/** An MMSP content item as AgentHub spells it (`text.done` → `text`), and back. */
function toV1Message(message: UniMessage): V1Message {
  return {
    ...message,
    content_items: message.content_items.map(
      (item) =>
        ({ ...item, type: item.type.replace(/\.done$/, "") }) as V1Message["content_items"][number],
    ),
  } as V1Message;
}

function toV2Message(message: V1Message): UniMessage {
  return {
    ...message,
    content_items: message.content_items.map(
      (item) => ({ ...item, type: `${item.type}.done` }) as ContentItem,
    ),
  } as UniMessage;
}

function hasFidelity(fidelity: Fidelity | undefined): boolean {
  return fidelity != null && Object.keys(fidelity).length > 0;
}

function fidelityEquals(a: Fidelity | undefined, b: Fidelity | undefined): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function withFidelity<T extends object>(item: T, fidelity: Fidelity | undefined): T {
  return hasFidelity(fidelity) ? { ...item, fidelity } : item;
}

function deltaEvent(item: UniEvent["content_items"][number]): UniEvent {
  return {
    role: "assistant",
    event_type: "delta",
    content_items: [item],
    usage_metadata: null,
    finish_reason: null,
  };
}

interface OpenSegment {
  kind: "text" | "thinking";
  content: string;
  fidelity: Fidelity | undefined;
}

interface ToolState {
  id: string;
  name: string;
  args: string;
  fidelity: Fidelity | undefined;
}

/**
 * Translates AgentHub's event stream into MMSP's, one AgentHub event at a time.
 *
 * Text and thinking are cut into items by AgentHub's own rules (a text item ends at a
 * signature or a new phase, a thinking item at a differing fidelity) and stream as `.delta`
 * fragments. A tool call starts streaming on its first argument fragment, when no other call
 * is streaming; until then it is held, and a held call whose complete item arrives first goes
 * out whole at that moment (the Codex backend sends a parallel batch with no argument
 * fragments at all, each call's arguments only on its complete item, so its calls go out in
 * the order they complete). A call that completes while another streams goes out right after
 * that one closes. MMSP's no-interleaving grammar holds, and no argument is lost.
 */
export class AgentHubEventTranslator {
  private segment: OpenSegment | null = null;
  private tool: ToolState | null = null;
  /** Calls opened but not streaming (no argument yet, or another call streaming), by provider id. */
  private held = new Map<string, ToolState>();
  /** Held calls whose complete item already arrived: they go out once the open call closes. */
  private heldDone: { state: ToolState; args: Record<string, unknown> }[] = [];
  private activeToolId: string | null = null;
  /** Calls closed from their fragments before AgentHub's complete item came (text cut in). */
  private closedEarly = new Set<string>();
  private usage: UsageMetadata | null = null;
  private finishReason: FinishReason | null = null;

  *push(event: V1Event): Generator<UniEvent> {
    if (event.usage_metadata) this.usage = event.usage_metadata as UsageMetadata;
    if (event.finish_reason) this.finishReason = event.finish_reason;
    for (const item of event.content_items) yield* this.item(item);
  }

  /** The end of a stream AgentHub committed: every open item closes, then the `stop` event. */
  *finish(): Generator<UniEvent> {
    yield* this.closeSegment();
    yield* this.closeTool(null);
    for (const state of [...this.held.values()]) {
      yield* this.emitWhole(state, parseArgs(state.args));
    }
    this.held.clear();
    yield {
      role: "assistant",
      event_type: "stop",
      content_items: [],
      usage_metadata: this.usage ?? {
        cached_tokens: null,
        prompt_tokens: null,
        thoughts_tokens: null,
        response_tokens: null,
      },
      finish_reason: this.finishReason ?? "unknown",
    };
  }

  private *item(item: V1PartialItem): Generator<UniEvent> {
    switch (item.type) {
      case "text": {
        const open = this.segment;
        const phase = (item.fidelity as { phase?: unknown } | undefined)?.phase ?? null;
        const continues =
          open?.kind === "text" &&
          (open.fidelity as { signature?: unknown } | undefined)?.signature == null &&
          (phase == null || phase === (open.fidelity as { phase?: unknown } | undefined)?.phase);
        if (!continues) {
          if (!item.text && phase == null) {
            // A bare fidelity marker on a closed segment: AgentHub drops it too.
            break;
          }
          yield* this.closeSegment();
          yield* this.closeTool(null);
          this.segment = { kind: "text", content: "", fidelity: undefined };
        }
        const seg = this.segment!;
        if (hasFidelity(item.fidelity)) seg.fidelity = { ...seg.fidelity, ...item.fidelity };
        if (item.text) {
          seg.content += item.text;
          yield deltaEvent(withFidelity({ type: "text.delta", text: item.text }, item.fidelity));
        }
        break;
      }
      case "thinking": {
        const open = this.segment;
        const continues =
          open?.kind === "thinking" &&
          (!hasFidelity(open.fidelity) || fidelityEquals(open.fidelity, item.fidelity));
        if (!continues) {
          if (!item.thinking && !hasFidelity(item.fidelity)) break;
          yield* this.closeSegment();
          yield* this.closeTool(null);
          this.segment = { kind: "thinking", content: "", fidelity: undefined };
        }
        const seg = this.segment!;
        if (hasFidelity(item.fidelity)) seg.fidelity = item.fidelity;
        if (item.thinking) {
          seg.content += item.thinking;
          yield deltaEvent(
            withFidelity({ type: "thinking.delta", thinking: item.thinking }, item.fidelity),
          );
        }
        break;
      }
      case "partial_tool_call": {
        const id = item.tool_call_id || this.activeToolId;
        if (!id) break;
        if (item.tool_call_id) this.activeToolId = item.tool_call_id;
        yield* this.closeSegment();
        let state = this.tool?.id === id ? this.tool : this.held.get(id);
        if (state === undefined) {
          state = { id, name: item.name, args: "", fidelity: undefined };
          this.held.set(id, state);
        }
        if (item.name) state.name = item.name;
        if (hasFidelity(item.fidelity)) state.fidelity = item.fidelity;
        if (!item.arguments) break;
        state.args += item.arguments;
        if (state === this.tool) {
          yield deltaEvent(
            withFidelity(
              {
                type: "tool_call.delta",
                name: state.name,
                arguments: item.arguments,
                tool_call_id: id,
              },
              item.fidelity,
            ),
          );
        } else if (this.tool === null) {
          // The call's first argument fragment, with nothing else streaming: it starts here,
          // its name and everything it carried so far in one fragment.
          this.held.delete(id);
          this.tool = state;
          yield deltaEvent(
            withFidelity(
              {
                type: "tool_call.delta",
                name: state.name,
                arguments: state.args,
                tool_call_id: id,
              },
              state.fidelity,
            ),
          );
        }
        break;
      }
      case "tool_call": {
        if (!item.tool_call_id) break;
        if (this.closedEarly.delete(item.tool_call_id)) break;
        yield* this.closeSegment();
        const args = (item.arguments ?? {}) as Record<string, unknown>;
        if (this.tool?.id === item.tool_call_id) {
          this.tool.name = item.name;
          if (hasFidelity(item.fidelity)) this.tool.fidelity = item.fidelity;
          yield* this.closeTool(args);
          break;
        }
        const state = this.held.get(item.tool_call_id) ?? {
          id: item.tool_call_id,
          name: item.name,
          args: "",
          fidelity: undefined,
        };
        this.held.delete(item.tool_call_id);
        state.name = item.name;
        if (hasFidelity(item.fidelity)) state.fidelity = item.fidelity;
        // Another call is streaming: this one goes out right after it closes.
        if (this.tool !== null) this.heldDone.push({ state, args });
        else yield* this.emitWhole(state, args);
        break;
      }
      default:
        // Images, inline data, embeddings: complete items, passed through as done items.
        yield deltaEvent({ ...item, type: `${item.type}.done` } as ContentItem);
        break;
    }
  }

  private *closeSegment(): Generator<UniEvent> {
    const seg = this.segment;
    this.segment = null;
    // A text item that only ever carried a phase marker has nothing to show or replay.
    if (!seg || (seg.kind === "text" && !seg.content)) return;
    yield deltaEvent(
      seg.kind === "text"
        ? withFidelity({ type: "text.done", text: seg.content }, seg.fidelity)
        : withFidelity({ type: "thinking.done", thinking: seg.content }, seg.fidelity),
    );
  }

  /** Closes the streaming call (its complete item's `args`, else what streamed), then the held ones. */
  private *closeTool(args: Record<string, unknown> | null): Generator<UniEvent> {
    const tool = this.tool;
    this.tool = null;
    if (tool && args === null) this.closedEarly.add(tool.id);
    if (tool) {
      yield deltaEvent(
        withFidelity(
          {
            type: "tool_call.done",
            name: tool.name,
            arguments: args ?? parseArgs(tool.args),
            tool_call_id: tool.id,
          },
          tool.fidelity,
        ),
      );
    }
    const done = this.heldDone;
    this.heldDone = [];
    for (const { state, args: heldArgs } of done) yield* this.emitWhole(state, heldArgs);
  }

  /** A call that never streamed: its one fragment (so it shows), then its done item. */
  private *emitWhole(state: ToolState, args: Record<string, unknown>): Generator<UniEvent> {
    if (state.name) {
      yield deltaEvent(
        withFidelity(
          { type: "tool_call.delta", name: state.name, arguments: "", tool_call_id: state.id },
          state.fidelity,
        ),
      );
    }
    yield deltaEvent(
      withFidelity(
        { type: "tool_call.done", name: state.name, arguments: args, tool_call_id: state.id },
        state.fidelity,
      ),
    );
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** AgentHub's subscription client behind MMSP's stateful client surface. */
export class AgentHubBridgeClient implements StatefulLLMClient {
  private readonly client: AgentHubAutoLLMClient;

  constructor(options: AgentHubBridgeOptions) {
    this.client = new AgentHubAutoLLMClient({
      model: options.model,
      clientType: options.clientType,
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl != null ? { baseUrl: options.baseUrl } : {}),
      ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
      ...(options.chatgptCredentials ? { chatgptCredentials: options.chatgptCredentials } : {}),
    });
  }

  async *streamingResponseStateful(options: {
    message: UniMessage;
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const translator = new AgentHubEventTranslator();
    const stream = this.client.streamingResponseStateful({
      message: toV1Message(options.message),
      config: options.config as Parameters<
        AgentHubAutoLLMClient["streamingResponseStateful"]
      >[0]["config"],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    for await (const event of stream) yield* translator.push(event);
    // AgentHub validated and committed the turn once its stream returned.
    yield* translator.finish();
  }

  getHistory(): UniMessage[] {
    return this.client.getHistory().map(toV2Message);
  }

  setHistory(history: UniMessage[]): void {
    this.client.setHistory(history.map(toV1Message));
  }

  listModels(): Promise<string[]> {
    return this.client.listModels();
  }
}
