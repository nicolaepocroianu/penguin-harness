/**
 * The translation from an ACP turn's events to the OmniMessages every Penguin Session emits:
 * streamed text and thinking as partials closed by a complete message, tool calls once with
 * their output once, and a turn's end as the request's end.
 */
import { describe, expect, it } from "vitest";
import type { AgentSessionEvent, AgentToolCall } from "@prismshadow/penguin-coding-agents";
import { AcpTurnTranslator, turnEndMessages } from "../src/coding-agents/session-runtime.js";

const S = "acp-1";
const call = (over: Partial<AgentToolCall>): AgentToolCall => ({
  toolCallId: "t1",
  title: "Read package.json",
  kind: "read",
  status: "pending",
  locations: [],
  ...over,
});
/** Every payload these tests see carries a `type`; session_meta, which does not, never appears. */
type Typed = { type: string } & Record<string, unknown>;
const typed = (m: { payload: unknown }) => m.payload as Typed;
const payloads = (t: AcpTurnTranslator, events: AgentSessionEvent[]) =>
  events.flatMap((e) => t.translate(e)).map(typed);

describe("AcpTurnTranslator", () => {
  it("streams text as partials and closes it with one complete message", () => {
    const t = new AcpTurnTranslator();
    const out = payloads(t, [
      { type: "message_chunk", sessionId: S, delta: "Hel" },
      { type: "message_chunk", sessionId: S, delta: "lo" },
    ]).concat(t.finish().map(typed));
    expect(out).toEqual([
      expect.objectContaining({ type: "partial_text", event_type: "start" }),
      expect.objectContaining({ type: "partial_text", event_type: "delta", text: "Hel" }),
      expect.objectContaining({ type: "partial_text", event_type: "delta", text: "lo" }),
      expect.objectContaining({ type: "partial_text", event_type: "stop" }),
      expect.objectContaining({ type: "text", role: "assistant", text: "Hello" }),
    ]);
  });

  it("closes thinking before text starts, keeping each as its own message", () => {
    const t = new AcpTurnTranslator();
    const out = payloads(t, [
      { type: "thought_chunk", sessionId: S, delta: "hmm" },
      { type: "message_chunk", sessionId: S, delta: "Done" },
    ]).concat(t.finish().map(typed));
    expect(out.filter((p) => p.type === "thinking" || p.type === "text")).toEqual([
      expect.objectContaining({ type: "thinking", thinking: "hmm" }),
      expect.objectContaining({ type: "text", text: "Done" }),
    ]);
  });

  it("emits a tool call once and its output once, when it completes", () => {
    const t = new AcpTurnTranslator();
    const out = payloads(t, [
      { type: "tool_call", sessionId: S, call: call({ rawInput: { path: "package.json" } }) },
      { type: "tool_call_update", sessionId: S, call: call({ status: "in_progress" }) },
      { type: "tool_call_update", sessionId: S, call: call({ status: "completed", output: "{}" }) },
      { type: "tool_call_update", sessionId: S, call: call({ status: "completed", output: "{}" }) },
    ]);
    expect(out).toEqual([
      expect.objectContaining({
        type: "tool_call",
        name: "Read package.json",
        arguments: JSON.stringify({ path: "package.json" }),
        tool_call_id: "t1",
      }),
      expect.objectContaining({ type: "tool_call_output", output: "{}", tool_call_id: "t1" }),
    ]);
  });

  it("closes open text before a tool call, so the transcript keeps its order", () => {
    const t = new AcpTurnTranslator();
    const out = payloads(t, [
      { type: "message_chunk", sessionId: S, delta: "Let me look." },
      { type: "tool_call", sessionId: S, call: call({}) },
    ]);
    expect(out.map((p) => p.type)).toEqual([
      "partial_text",
      "partial_text",
      "partial_text",
      "text",
      "tool_call",
    ]);
  });

  it("knows which tools only read, for the read-only approval mode", () => {
    const t = new AcpTurnTranslator();
    payloads(t, [
      { type: "tool_call", sessionId: S, call: call({}) },
      {
        type: "tool_call",
        sessionId: S,
        call: call({ toolCallId: "t2", title: "Edit a.ts", kind: "edit" }),
      },
      {
        type: "tool_call",
        sessionId: S,
        call: call({ toolCallId: "t3", title: "Mystery", kind: undefined }),
      },
    ]);
    expect(t.permissionOf("Read package.json")).toBe("r");
    expect(t.permissionOf("Edit a.ts")).toBe("rw");
    expect(t.permissionOf("Mystery")).toBe("rw");
    expect(t.permissionOf("never seen")).toBeUndefined();
  });

  it("introduces a tool call a permission ask names before it was reported", () => {
    const t = new AcpTurnTranslator();
    const first = t.callFor(call({ toolCallId: "t9", title: "Run tests", kind: "execute" }));
    expect(first.emitted.map((m) => typed(m).type)).toEqual(["tool_call"]);
    expect(first.message.payload.tool_call_id).toBe("t9");
    expect(t.callFor(call({ toolCallId: "t9" })).emitted).toEqual([]);
  });

  it("shows the agent's notices in the transcript", () => {
    const t = new AcpTurnTranslator();
    expect(payloads(t, [{ type: "notice", sessionId: S, message: "Sign in first" }])).toEqual([
      expect.objectContaining({ type: "text", role: "assistant", text: "> Sign in first" }),
    ]);
  });
});

describe("turnEndMessages", () => {
  it("ends a finished turn as a completed request", () => {
    expect(turnEndMessages("end_turn", false).map(typed)).toEqual([
      expect.objectContaining({ type: "request_end", status: "completed" }),
    ]);
  });

  it("ends a stopped turn as an abort", () => {
    expect(turnEndMessages("cancelled", true).map((m) => typed(m).type)).toEqual([
      "request_end",
      "abort",
    ]);
  });

  it("ends any other stop as a failed request that says why", () => {
    const [end] = turnEndMessages("refusal", false);
    expect(end!.payload).toMatchObject({
      type: "request_end",
      status: "fatal",
      error_message: "The coding agent refused the task.",
    });
  });
});
