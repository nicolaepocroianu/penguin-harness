/**
 * The transcript renderer's own unit tests: document shape and ordering over a synthetic
 * event log (the HTTP surface is covered by coding-agents.test.ts against a real spawned
 * agent; these pin the folding rules that log alone cannot reach — multi-turn order,
 * thinking runs, notices, in-place tool-status updates, filename sanitization).
 */
import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@prismshadow/penguin-coding-agents";
import type { CodingAgentSessionDetailResponse } from "../src/api/types.js";
import { renderTranscriptMarkdown, transcriptFilename } from "../src/coding-agents/transcript.js";

function detail(events: AgentSessionEvent[]): CodingAgentSessionDetailResponse {
  return {
    sessionId: "sess-1",
    agentId: "fake",
    workspaceDir: "/tmp/ws",
    busy: false,
    createdAt: 1758500000000,
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "fast",
        options: [
          { value: "balanced", name: "Balanced" },
          { value: "fast", name: "Fast" },
        ],
      },
    ],
    events,
  };
}

describe("renderTranscriptMarkdown", () => {
  it("renders two turns in order: prompt, agent text, prompt, agent text", () => {
    const doc = renderTranscriptMarkdown({
      detail: detail([
        { type: "config_options", sessionId: "sess-1", options: [] },
        { type: "user_message", sessionId: "sess-1", text: "first" },
        { type: "message_chunk", sessionId: "sess-1", delta: "answer " },
        { type: "message_chunk", sessionId: "sess-1", delta: "one" },
        { type: "turn_end", sessionId: "sess-1", stopReason: "end_turn" },
        { type: "user_message", sessionId: "sess-1", text: "second" },
        { type: "message_chunk", sessionId: "sess-1", delta: "answer two" },
        { type: "turn_end", sessionId: "sess-1", stopReason: "end_turn" },
      ]),
    });
    const firstUser = doc.indexOf("## User\n\nfirst");
    const firstAgent = doc.indexOf("## Agent\n\nanswer one");
    const secondUser = doc.indexOf("## User\n\nsecond");
    const secondAgent = doc.indexOf("## Agent\n\nanswer two");
    expect(firstUser).toBeGreaterThan(0);
    expect(firstAgent).toBeGreaterThan(firstUser);
    expect(secondUser).toBeGreaterThan(firstAgent);
    expect(secondAgent).toBeGreaterThan(secondUser);
  });

  it("renders thinking runs as blockquotes and notices as italic lines", () => {
    const doc = renderTranscriptMarkdown({
      detail: detail([
        { type: "user_message", sessionId: "sess-1", text: "go" },
        { type: "thought_chunk", sessionId: "sess-1", delta: "hmm\nlet me think" },
        { type: "message_chunk", sessionId: "sess-1", delta: "done" },
        { type: "notice", sessionId: "sess-1", message: "needs input" },
      ]),
    });
    expect(doc).toContain("## Agent\n\n> hmm\n> let me think\n\ndone");
    expect(doc).toContain("*Notice: needs input*");
  });

  it("updates a tool call's line in place, keeping its first-sighting position", () => {
    const doc = renderTranscriptMarkdown({
      detail: detail([
        { type: "user_message", sessionId: "sess-1", text: "go" },
        {
          type: "tool_call",
          sessionId: "sess-1",
          call: {
            toolCallId: "t1",
            title: "Read a.ts",
            kind: "read",
            status: "in_progress",
            locations: [],
          },
        },
        { type: "message_chunk", sessionId: "sess-1", delta: "reading" },
        {
          type: "tool_call_update",
          sessionId: "sess-1",
          call: { toolCallId: "t1", title: "Read a.ts", status: "completed", locations: [] },
        },
      ]),
    });
    const toolAt = doc.indexOf("- Read a.ts — completed");
    const textAt = doc.indexOf("reading");
    expect(toolAt).toBeGreaterThan(0);
    expect(textAt).toBeGreaterThan(toolAt);
    expect(doc).not.toContain("in_progress");
    expect(doc.match(/Read a\.ts/g)).toHaveLength(1);
  });

  it("names the model's display value and skips mode bookkeeping when no modes exist", () => {
    const doc = renderTranscriptMarkdown({ detail: detail([]) });
    expect(doc).toContain("- Model: Fast");
    expect(doc).not.toContain("- Mode:");
  });

  it("names the current mode from the last modes event", () => {
    const doc = renderTranscriptMarkdown({
      detail: detail([
        {
          type: "modes",
          sessionId: "sess-1",
          modes: {
            currentModeId: "auto",
            modes: [
              { id: "ask", name: "Ask" },
              { id: "auto", name: "Auto" },
            ],
          },
        },
      ]),
    });
    expect(doc).toContain("- Mode: Auto");
  });
});

describe("transcriptFilename", () => {
  it("sanitizes hostile session ids into one safe path segment", () => {
    expect(transcriptFilename("sess-1727000000000")).toBe(
      "penguin-coding-agent-sess-1727000000000.md",
    );
    expect(transcriptFilename("../../etc passwd")).toBe("penguin-coding-agent-etc-passwd.md");
    expect(transcriptFilename("!!!")).toBe("penguin-coding-agent-session.md");
  });
});
