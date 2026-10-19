/**
 * The AgentHub bridge: AgentHub's first-protocol event stream (start/delta/stop events whose
 * items run together) becomes MMSP's (one `.delta` or `.done` item per event, items never
 * interleaved, one `stop` event), cut into items by AgentHub's own aggregation rules, so the
 * subscription clients (GitHub Copilot, ChatGPT / Codex) feed GenerativeModel's translator.
 */
import { describe, expect, it } from "vitest";
import type { UniEvent as V1Event } from "@prismshadow/agenthub";
import type { UniEvent } from "@prismshadow/mmsp";
import { AgentHubEventTranslator, isAgentHubClientType } from "../src/llm/agenthub-bridge.js";
import { translateEvents } from "../src/llm/generative-model.js";

const usage = { cached_tokens: 0, prompt_tokens: 10, thoughts_tokens: 0, response_tokens: 5 };

function v1(items: V1Event["content_items"], last = false): V1Event {
  return {
    role: "assistant",
    event_type: last ? "stop" : "delta",
    content_items: items,
    usage_metadata: last ? usage : null,
    finish_reason: last ? "tool_call" : null,
  };
}

function bridge(events: V1Event[]): UniEvent[] {
  const t = new AgentHubEventTranslator();
  return [...events.flatMap((e) => [...t.push(e)]), ...t.finish()];
}

describe("AgentHubEventTranslator", () => {
  it("cuts thinking, text and a streamed tool call into MMSP items, then one stop event", () => {
    const out = bridge([
      v1([{ type: "thinking", thinking: "Let me " }]),
      v1([{ type: "thinking", thinking: "look." }]),
      v1([{ type: "thinking", thinking: "", fidelity: { signature: "sig" } }]),
      v1([{ type: "text", text: "Reading it." }]),
      v1([{ type: "partial_tool_call", name: "read", arguments: "", tool_call_id: "c1" }]),
      v1([{ type: "partial_tool_call", name: "", arguments: '{"file_path":', tool_call_id: "" }]),
      v1([{ type: "partial_tool_call", name: "", arguments: '"a.txt"}', tool_call_id: "c1" }]),
      v1(
        [
          {
            type: "tool_call",
            name: "read",
            arguments: { file_path: "a.txt" },
            tool_call_id: "c1",
          },
        ],
        true,
      ),
    ]);
    expect(out.map((e) => e.event_type === "stop" || e.content_items.length === 1)).not.toContain(
      false,
    );
    expect(out.map((e) => e.content_items[0]?.type ?? "stop")).toEqual([
      "thinking.delta",
      "thinking.delta",
      "thinking.done",
      "text.delta",
      "text.done",
      "tool_call.delta",
      "tool_call.delta",
      "tool_call.done",
      "stop",
    ]);
    expect(out[2]!.content_items[0]).toEqual({
      type: "thinking.done",
      thinking: "Let me look.",
      fidelity: { signature: "sig" },
    });
    expect(out.at(-1)).toMatchObject({ usage_metadata: usage, finish_reason: "tool_call" });

    const { messages } = translateEvents(out);
    const call = messages.find(
      (m) => "type" in m.payload && m.payload.type === "tool_call" && m.type === "model_msg",
    );
    expect(call?.payload).toMatchObject({
      name: "read",
      tool_call_id: "c1",
      arguments: '{"file_path":"a.txt"}',
      stop_reason: "completed",
    });
  });

  it("emits each Codex call of a parallel batch whole, in the order they complete", () => {
    const out = bridge([
      v1([{ type: "partial_tool_call", name: "read", arguments: "", tool_call_id: "a" }]),
      v1([{ type: "partial_tool_call", name: "read", arguments: "", tool_call_id: "b" }]),
      v1([{ type: "tool_call", name: "read", arguments: { n: "b" }, tool_call_id: "b" }]),
      v1([{ type: "tool_call", name: "read", arguments: { n: "a" }, tool_call_id: "a" }], true),
    ]);
    const done = out
      .map((e) => e.content_items[0])
      .filter((i) => i?.type === "tool_call.done")
      .map((i) => (i as { tool_call_id: string }).tool_call_id);
    expect(done).toEqual(["b", "a"]);
  });

  it("names exactly the subscription client types as AgentHub's", () => {
    expect(isAgentHubClientType("github-copilot")).toBe(true);
    expect(isAgentHubClientType("ChatGPT-Codex")).toBe(true);
    expect(isAgentHubClientType("openai-responses")).toBe(false);
    expect(isAgentHubClientType(undefined)).toBe(false);
  });
});
