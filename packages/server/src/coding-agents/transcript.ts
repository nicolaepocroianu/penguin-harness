/**
 * Markdown transcript rendering for one coding-agent session. Input is exactly what the
 * session detail route serves — the session info, the authoritative config-option set and
 * the bounded event log — so a downloaded document cannot drift from what the Web App's
 * SessionView shows. The document is an H1, a metadata block, then the conversation in
 * log order: prompts as `## User` sections, streamed text and thinking as `## Agent`
 * sections, tool calls as list items at their first sighting carrying their latest state.
 * Everything else in the event vocabulary (state changes, usage, config/mode bookkeeping,
 * permission plumbing, turn markers) is connection noise here and does not render.
 */
import type { AgentModes, AgentToolCall } from "@prismshadow/penguin-coding-agents";
import type { CodingAgentEvent, CodingAgentSessionDetailResponse } from "../api/types.js";

/** A download-safe filename for one session's transcript (`penguin-coding-agent-<shortid>.md`). */
export function transcriptFilename(sessionId: string): string {
  const short =
    sessionId
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+/, "")
      .slice(0, 40)
      .replace(/[-.]+$/, "") || "session";
  return `penguin-coding-agent-${short}.md`;
}

/** Render one session's detail (info + config options + event log) as a Markdown document. */
export function renderTranscriptMarkdown(input: {
  detail: CodingAgentSessionDetailResponse;
  /** The session's user-set title, when one is set (wins over the agent's name). */
  sessionTitle?: string;
  /** The agent definition's display title, when the definition carries one. */
  agentTitle?: string;
}): string {
  const { detail } = input;
  const lines: string[] = [];

  lines.push(`# ${input.sessionTitle ?? input.agentTitle ?? detail.agentId}`, "");
  lines.push(`- Agent: ${input.agentTitle ?? detail.agentId}`);
  lines.push(`- Session: ${detail.sessionId}`);
  lines.push(`- Created: ${new Date(detail.createdAt).toISOString()}`);
  lines.push(`- Workspace: ${detail.workspaceDir}`);
  // The model rides the authoritative config set (the log may have evicted its
  // config_options event); the mode comes from the last modes event in the log.
  const model = detail.configOptions.find((option) => option.category === "model");
  if (model !== undefined) {
    const named = model.options.find((value) => value.value === model.currentValue);
    lines.push(`- Model: ${named?.name ?? String(model.currentValue)}`);
  }
  const modes = lastModes(detail.events);
  if (modes !== null && modes.currentModeId !== null) {
    const current = modes.modes.find((m) => m.id === modes.currentModeId);
    if (current !== undefined) lines.push(`- Mode: ${current.name}`);
  }

  const tools = new Map<string, { call: AgentToolCall; lineIndex: number }>();
  let section: "user" | "agent" | null = null;
  let runKind: "assistant" | "thinking" | null = null;
  let run = "";

  const pushBlank = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  };

  const flushRun = () => {
    if (run === "") {
      runKind = null;
      return;
    }
    pushBlank();
    if (runKind === "thinking") {
      for (const line of run.split("\n")) lines.push(`> ${line}`);
    } else {
      lines.push(run);
    }
    run = "";
    runKind = null;
    pushBlank();
  };

  const toolLine = (call: AgentToolCall): string => `- ${call.title} — ${call.status}`;

  for (const event of detail.events) {
    if (event.type === "user_message") {
      flushRun();
      pushBlank();
      lines.push("## User", "", event.text, "");
      section = "user";
      continue;
    }
    if (event.type === "message_chunk" || event.type === "thought_chunk") {
      if (section !== "agent") {
        flushRun();
        pushBlank();
        lines.push("## Agent", "");
        section = "agent";
      }
      const nextKind = event.type === "message_chunk" ? "assistant" : "thinking";
      if (runKind !== nextKind) flushRun();
      runKind = nextKind;
      run += event.delta;
      continue;
    }
    if (event.type === "tool_call" || event.type === "tool_call_update") {
      flushRun();
      const existing = tools.get(event.call.toolCallId);
      if (existing === undefined) {
        pushBlank();
        const lineIndex = lines.length;
        lines.push(toolLine(event.call));
        tools.set(event.call.toolCallId, { call: event.call, lineIndex });
      } else {
        // Same merge the SessionView does: a snapshot, complete each time it is sent.
        existing.call = { ...existing.call, ...event.call };
        lines[existing.lineIndex] = toolLine(existing.call);
      }
      continue;
    }
    if (event.type === "notice") {
      flushRun();
      pushBlank();
      lines.push(`*Notice: ${event.message}*`);
      pushBlank();
      continue;
    }
    // state, usage, modes, config_options, permission_*, turn_end: not conversation.
  }
  flushRun();

  return `${lines.join("\n")}\n`;
}

/** The last `modes` event in the log, or null (the session never advertised modes). */
function lastModes(events: CodingAgentEvent[]): AgentModes | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "modes") return event.modes;
  }
  return null;
}
