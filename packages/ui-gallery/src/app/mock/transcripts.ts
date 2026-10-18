/**
 * The demo conversations as OmniMessage transcripts, plus the scripted
 * reply a sent message streams. Every message is built by the small builders below, so the
 * envelopes (timestamps, roles, stop reasons) are always well-formed, and the running states
 * the gallery exists to show are set up the way the server produces them:
 *
 * - a tool call with no `tool_call_output` yet is a running tool (the card's timer ticks);
 * - an open `partial_thinking` fragment, carried as the live tail, is running thinking;
 * - an open `partial_text` fragment, carried the same way, is a reply streaming in;
 * - a tool call the stream has escalated with `approval_request` is waiting on a human.
 */
import type { GoalServerEvent } from "@prismshadow/penguin-server/api";
import { IDS } from "./ids";
import type { Lang, OmniMessage, PayloadOf, ToolCallMessage } from "./types";

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();

const model = <T extends PayloadOf<"text" | "thinking" | "tool_call" | "tool_call_output">>(
  ms: number,
  payload: T,
): OmniMessage => ({ timestamp: iso(ms), type: "model_msg", payload });

export const event = (ms: number, payload: OmniMessage["payload"]): OmniMessage => ({
  timestamp: iso(ms),
  type: "event_msg",
  payload,
});

/**
 * A Session's opening record. The docs Agent's, started by a person, unless `who` names another
 * Agent (its system prompt) or another starter (a subagent's parent).
 */
export const meta = (
  ms: number,
  sessionId: string,
  ref: { provider: string; modelId: string; contextWindow: number },
  workspace: string,
  who: { agentId?: string; systemPrompt?: string; source?: "user" | "subagent" | "cli" } = {},
): OmniMessage => ({
  timestamp: iso(ms),
  type: "session_meta",
  payload: {
    session_id: sessionId,
    provider: ref.provider,
    model_id: ref.modelId,
    model_context_window: ref.contextWindow,
    system_prompt: who.systemPrompt ?? "You are Docs Expert. Cite a real file for every claim.",
    agent_state: `/home/demo/.penguin/data/projects/${IDS.project}/agents/${who.agentId ?? IDS.agents.docs}/agent_state`,
    workspace,
    source: who.source ?? "user",
  },
});

/**
 * A user-role text; `sender` names who wrote it when the person did not (absent = the person):
 * the harness, the server, or the parent agent that drives a subagent.
 */
export const userText = (
  ms: number,
  text: string,
  sender?: "harness" | "server" | "parent_agent",
): OmniMessage => model(ms, { type: "text", role: "user", text, ...(sender ? { sender } : {}) });

export const assistantText = (
  ms: number,
  text: string,
  stopReason: "completed" | "aborted" = "completed",
): OmniMessage => model(ms, { type: "text", role: "assistant", text, stop_reason: stopReason });

export const thinking = (ms: number, text: string): OmniMessage =>
  model(ms, { type: "thinking", role: "assistant", thinking: text, stop_reason: "completed" });

export const toolCall = (
  ms: number,
  id: string,
  name: string,
  args: Record<string, unknown>,
): ToolCallMessage => ({
  timestamp: iso(ms),
  type: "model_msg",
  payload: {
    type: "tool_call",
    role: "assistant",
    name,
    arguments: JSON.stringify(args),
    tool_call_id: id,
    stop_reason: "completed",
  },
});

export const toolOutput = (ms: number, id: string, output: string): OmniMessage =>
  model(ms, {
    type: "tool_call_output",
    role: "user",
    output,
    tool_call_id: id,
    stop_reason: "completed",
  });

export const requestBegin = (ms: number): OmniMessage => event(ms, { type: "request_begin" });

export const requestEnd = (ms: number): OmniMessage =>
  event(ms, { type: "request_end", status: "completed" });

export const tokenUsage = (ms: number, sessionTotal: number, requestTotal: number): OmniMessage =>
  event(ms, {
    type: "token_usage",
    session: {
      cache_read: Math.round(sessionTotal * 0.62),
      cache_write: Math.round(sessionTotal * 0.09),
      output: Math.round(sessionTotal * 0.29),
      total: sessionTotal,
    },
    request: {
      cache_read: Math.round(requestTotal * 0.7),
      cache_write: Math.round(requestTotal * 0.05),
      output: Math.round(requestTotal * 0.25),
      total: requestTotal,
    },
  });

export const approvalDecision = (ms: number, id: string, decision: "allow" | "deny"): OmniMessage =>
  event(ms, { type: "approval_decision", decision, tool_call_id: id });

export const abortEvent = (ms: number): OmniMessage =>
  event(ms, { type: "abort", error_code: "user_abort" });

/** A streaming fragment; `event_type` says whether it opens, extends or closes the fragment. */
export const partial = (
  ms: number,
  payload:
    | PayloadOf<"partial_text">
    | PayloadOf<"partial_thinking">
    | PayloadOf<"partial_tool_call">
    | PayloadOf<"partial_tool_call_output">,
): OmniMessage => ({ timestamp: iso(ms), type: "model_msg", payload });

// ---------------------------------------------------------------------------------------------
// The content
// ---------------------------------------------------------------------------------------------

const RAG_EXCERPT = `export function buildIndex(root: string): Index {
  const files = walk(root).filter((f) => f.endsWith(".md"));
  const docs = files.map((f) => ({ source: f, text: fs.readFileSync(f, "utf8") }));
  return bm25(docs, { k1: 1.2, b: 0.75 });
}

export function rank(question: string, index: Index): Hit[] {
  return index.query(question).slice(0, 6);
}`;

const RAG_OLD = `  const files = walk(root).filter((f) => f.endsWith(".md"));`;
const RAG_NEW = `  const files = walk(root)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => fs.existsSync(f)); // a citation must open a real file`;

const TEST_OUTPUT = ` RUN  v3.2.6 /home/demo/projects/docs-expert

 ✓ test/rag.test.ts (6 tests) 412ms
   ✓ indexes every markdown file under corpus/
   ✓ ranks hooks.md first for a hooks question
   ✓ never cites a file that does not exist

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  14:02:11
   Duration  1.08s`;

interface Copy {
  done: { prompt: string; thinking: string; answer: string; title: string };
  runningTool: { prompt: string; thinking: string; readOutput: string; title: string };
  thinking: { prompt: string; sentences: string[]; title: string };
  approval: { prompt: string; thinking: string; title: string; allowed: string; denied: string };
  /** The streaming Session's turn; the library's streaming board plays its answer too. */
  streaming: { prompt: string; thinking: string; title: string; answer: string };
  reply: { thinking: string; text: string[]; title: string };
  older: Record<string, { prompt: string; answer: string }>;
}

const COPY: Record<Lang, Copy> = {
  en: {
    done: {
      title: "Index the hooks docs",
      prompt:
        "Add corpus/claude-code-docs/hooks.md to the BM25 index and make sure every citation points at a real file.",
      thinking:
        "The index is built in src/rag.ts from a recursive walk of corpus/. hooks.md is already under that directory, so the question is why it never surfaces: the walk probably filters on the extension before the file exists on disk in the test fixture. I should read the file first, then guard the citation path rather than the ranking.",
      answer: `Done — \`hooks.md\` is indexed and citations are guarded.

| Change | File | Effect |
| --- | --- | --- |
| Filter the walk on \`fs.existsSync\` | \`src/rag.ts\` | A citation can only name a file that opens |
| Re-ran the retrieval tests | \`test/rag.test.ts\` | 6 passed, 412 ms |

The hooks question now ranks the right file first:

\`\`\`ts
rank("How do I configure hooks?", index)[0].source;
// => "corpus/claude-code-docs/hooks.md"
\`\`\`

Nothing else in the corpus changed, so the index rebuild took 12.4 ms [1].

[1] corpus/claude-code-docs/hooks.md`,
    },
    runningTool: {
      title: "Check every link in the docs",
      prompt: "Check every link in corpus/ and list the ones that 404.",
      thinking:
        "There is a link checker in scripts/check-links.mjs. Let me confirm what it covers before running it over the whole corpus, since a full run takes a while.",
      readOutput: `#!/usr/bin/env node
// Walks every .md under corpus/, extracts links, HEADs each URL with a 10s timeout.
// --all also follows relative links to files in the repository.`,
    },
    thinking: {
      title: "Plan the 0.3 release notes",
      prompt: "Read CHANGELOG.md and draft the structure of the 0.3 release notes.",
      sentences: [
        "The changelog has forty-one unreleased entries. ",
        "Grouping them by the surface they touch reads better than by type: the chat, the Agents page, the Evaluation Center, machines. ",
        "Three entries carry a Breaking marker, so the notes need a compatibility section up front. ",
        "The migration entries reference each other; I should name the one a reader has to act on and fold the rest under it. ",
        "The highlight is remote machines — every other entry is a refinement. ",
        "Let me outline: one paragraph of lead, Highlights with three items, then Notable by surface, then Requirements. ",
      ],
    },
    approval: {
      title: "Publish the docs package",
      prompt: "The tests pass. Publish the docs package to npm.",
      thinking:
        "Publishing is irreversible and touches a registry outside the workspace, so this call goes through approval even though the session allows most commands.",
      allowed:
        "Published `@penguinharness/docs-expert@2026.9.14.1`. The registry lists the new version and the tarball is 48.2 KB.",
      denied:
        "Not published. The package is built and ready in `dist/`; run the publish yourself when you want it out.",
    },
    streaming: {
      title: "Explain the citation guard",
      prompt: "Walk me through how the retriever decides what it may cite.",
      thinking:
        "I read src/rag.ts earlier in this session, so I can answer from it: the ranking, then the existence check that guards every citation.",
      answer: `The retriever answers in two passes: it ranks the corpus with BM25, then drops every hit whose source file no longer exists, so a citation always opens a real file.

- **Walk**: \`buildIndex\` reads every Markdown file under \`corpus/\`.
- **Rank**: \`rank\` keeps the six best matches for the question.
- **Guard**: a hit is cited only if \`fs.existsSync\` finds its file.

\`\`\`ts
const hits = rank("How do I configure hooks?", index);
const cited = hits.filter((hit) => fs.existsSync(hit.source));
\`\`\`

To change what comes first, tune \`k1\` and \`b\` in \`src/rag.ts\`; the guard stays as it is.`,
    },
    reply: {
      title: "A question about the corpus",
      thinking:
        "The answer is in the corpus. Let me open the retrieval module to quote the exact rule rather than paraphrase it.",
      text: [
        "Here is what the corpus says.\n\n",
        "The retrieval module ranks the six best matches and keeps only the ones whose source file exists, ",
        "so every citation in an answer opens a real file — that is the rule `src/rag.ts` enforces on line 4.\n\n",
        "If you want the ranking itself changed, the BM25 parameters (`k1`, `b`) are the place to start.",
      ],
    },
    older: {
      [IDS.sessions.older[0]]: {
        prompt: "Sync the corpus from the docs repository.",
        answer: "Synced 214 Markdown files; 3 changed since last time.",
      },
      [IDS.sessions.older[1]]: {
        prompt: "Write an onboarding note for the docs expert.",
        answer: "Drafted docs/onboarding.md with the three questions people ask first.",
      },
      [IDS.sessions.older[2]]: {
        prompt: "Which benchmark cases fail most often?",
        answer: "CASE-003 (hooks configuration) fails in 2 of 3 runs; the rest pass.",
      },
      [IDS.sessions.older[3]]: {
        prompt: "Connect the filesystem MCP server.",
        answer: "Connected `filesystem` (3 tools). The session now reads corpus/ through it.",
      },
      [IDS.sessions.archived]: {
        prompt: "Migrate the old index format.",
        answer: "Migrated; the legacy loader is removed.",
      },
      [IDS.sessions.schedule]: {
        prompt: "[scheduled] Nightly corpus sync.",
        answer: "Nothing changed upstream tonight.",
      },
      [IDS.sessions.subagent]: {
        prompt: "Check the links in hooks.md.",
        answer: "All 14 links answer 200.",
      },
      [IDS.sessions.benchmark]: {
        prompt: "CASE-001: how are hooks configured?",
        answer:
          "Hooks are configured in hooks.json under the Agent State, one entry per hook point [1].",
      },
      [IDS.sessions.kept]: {
        prompt: "Rebuild the search index for every corpus.",
        answer: "Rebuilt 3 indexes; the largest took 41 s.",
      },
      [IDS.sessions.notes[0]]: {
        prompt: "Draft the release notes for 0.2.13.",
        answer: "Drafted; see changelog/0.2.13/RELEASE.md.",
      },
      [IDS.sessions.notes[1]]: {
        prompt: "List the breaking changes since 0.2.10.",
        answer: "Three: the plugin version spelling, the trace window and the goal state file.",
      },
    },
  },
};

export const copyFor = (lang: Lang): Copy => COPY[lang];

// ---------------------------------------------------------------------------------------------
// The transcripts
// ---------------------------------------------------------------------------------------------

export interface ModelRef {
  provider: string;
  modelId: string;
  contextWindow: number;
}

/** The tool call ids the stream events name, so the store can decide them. */
export const TOOL_CALL_IDS = {
  runningCommand: "call_running_links",
  pendingPublish: "call_publish",
} as const;

export interface Transcript {
  history: OmniMessage[];
  /** An open thinking fragment the live tail carries (running thinking). */
  openThinking?: { startedAt: number; text: string };
  /** An open text fragment the live tail carries (a reply streaming in). */
  openText?: { startedAt: number; text: string };
  /** A tool call awaiting a human decision. */
  pendingApproval?: ToolCallMessage;
  /** Goal-mode events a fresh subscription is told after the run state (the goal banner's). */
  goalEvents?: GoalServerEvent[];
  running: boolean;
}

/** The finished Task: a minute and a bit of work, ended a while ago. */
export function doneTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].done;
  const t0 = now - 42 * 60_000;
  const s = (sec: number) => t0 + sec * 1000;
  return {
    running: false,
    history: [
      meta(s(0), IDS.sessions.done, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.4)),
      thinking(s(6), c.thinking),
      toolCall(s(7), "call_read_rag", "read_file", { path: "src/rag.ts" }),
      requestEnd(s(7.1)),
      toolOutput(s(7.5), "call_read_rag", RAG_EXCERPT),
      requestBegin(s(7.8)),
      toolCall(s(14), "call_edit_rag", "edit_file", {
        path: "src/rag.ts",
        old_string: RAG_OLD,
        new_string: RAG_NEW,
      }),
      requestEnd(s(14.1)),
      toolOutput(s(14.6), "call_edit_rag", "Edited src/rag.ts (+3 -1)."),
      requestBegin(s(15)),
      toolCall(s(18), "call_test", "exec_command", {
        cmd: "pnpm vitest run test/rag.test.ts",
        description: "Run the retrieval tests",
      }),
      requestEnd(s(18.1)),
      toolOutput(s(20.2), "call_test", TEST_OUTPUT),
      requestBegin(s(20.5)),
      assistantText(s(31), c.answer),
      tokenUsage(s(31.2), 43_800, 12_400),
      requestEnd(s(31.2)),
    ],
  };
}

/** A Task mid-run: a command executing, its output still to come. */
export function runningToolTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].runningTool;
  const t0 = now - 95_000;
  const s = (sec: number) => t0 + sec * 1000;
  return {
    running: true,
    history: [
      meta(s(0), IDS.sessions.runningTool, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      thinking(s(4), c.thinking),
      toolCall(s(5), "call_read_checker", "read_file", { path: "scripts/check-links.mjs" }),
      requestEnd(s(5.1)),
      toolOutput(s(5.4), "call_read_checker", c.readOutput),
      requestBegin(s(5.7)),
      toolCall(s(9), TOOL_CALL_IDS.runningCommand, "exec_command", {
        cmd: "node scripts/check-links.mjs --all",
        description: "Check every link",
      }),
      requestEnd(s(9.1)),
    ],
  };
}

/** A Task mid-run: the model thinking; the fragment is open and keeps growing. */
export function thinkingTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].thinking;
  const t0 = now - 50_000;
  const s = (sec: number) => t0 + sec * 1000;
  return {
    running: true,
    openThinking: { startedAt: s(8), text: c.sentences.slice(0, 2).join("") },
    history: [
      meta(s(0), IDS.sessions.thinking, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      toolCall(s(3), "call_read_changelog", "read_file", { path: "CHANGELOG.md" }),
      requestEnd(s(3.1)),
      toolOutput(
        s(3.5),
        "call_read_changelog",
        "# Changelog\n\n## Unreleased\n\n41 entries in changelog/unreleased/ …",
      ),
      requestBegin(s(4)),
    ],
  };
}

/**
 * A Task mid-run whose reply is streaming: the prompt and the settled thinking are history; the
 * answer itself is played by the store, in a loop, while the Session is watched.
 */
export function streamingTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].streaming;
  const t0 = now - 20_000;
  const s = (sec: number) => t0 + sec * 1000;
  return {
    running: true,
    history: [
      meta(s(0), IDS.sessions.streaming, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      thinking(s(5), c.thinking),
    ],
  };
}

/** A Task waiting on a human: the publish command awaits approval. */
export function approvalTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].approval;
  const t0 = now - 30_000;
  const s = (sec: number) => t0 + sec * 1000;
  const call = toolCall(s(6), TOOL_CALL_IDS.pendingPublish, "exec_command", {
    cmd: "pnpm publish --access public",
    description: "Publish to npm",
  });
  return {
    running: true,
    pendingApproval: call,
    history: [
      meta(s(0), IDS.sessions.approval, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      thinking(s(5), c.thinking),
      call,
    ],
  };
}

/** A short finished exchange for the rows that only fill the list. */
export function shortTranscript(
  lang: Lang,
  sessionId: string,
  startedAt: number,
  ref: ModelRef,
): Transcript {
  const c = COPY[lang].older[sessionId] ?? { prompt: sessionId, answer: "Done." };
  const s = (sec: number) => startedAt + sec * 1000;
  return {
    running: false,
    history: [
      meta(s(0), sessionId, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      assistantText(s(6), c.answer),
      tokenUsage(s(6.1), 8_200, 8_200),
      requestEnd(s(6.1)),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// The scripted reply
// ---------------------------------------------------------------------------------------------

/** One step of a script: what to publish, `at` ms after the script starts. */
export interface ScriptStep {
  at: number;
  msg: OmniMessage;
}

/** Splits text into word-sized chunks so a stream reads as one. */
function chunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

/**
 * The reply a sent message streams: thinking, one tool call with its output, then the answer,
 * each arriving as the server streams it (fragments first, the complete message closing each),
 * ending with the usage and the request's end. Timestamps are stamped when the step runs.
 */
export function scriptedReply(lang: Lang, callId: string): ScriptStep[] {
  const c = COPY[lang].reply;
  const steps: ScriptStep[] = [];
  let at = 250;
  const push = (msg: OmniMessage) => steps.push({ at, msg });
  const p = (ms: number, payload: Parameters<typeof partial>[1]) => partial(ms, payload);

  push(requestBegin(0));
  at += 300;
  push(p(0, { type: "partial_thinking", role: "assistant", event_type: "start", thinking: "" }));
  for (const chunk of chunks(c.thinking)) {
    at += 70;
    push(
      p(0, { type: "partial_thinking", role: "assistant", event_type: "delta", thinking: chunk }),
    );
  }
  at += 120;
  push(p(0, { type: "partial_thinking", role: "assistant", event_type: "stop", thinking: "" }));
  push(thinking(0, c.thinking));

  at += 400;
  const args = JSON.stringify({ path: "src/rag.ts" });
  push(
    p(0, {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "start",
      name: "read_file",
      arguments: "",
      tool_call_id: callId,
    }),
  );
  at += 200;
  push(
    p(0, {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "delta",
      name: "read_file",
      arguments: args,
      tool_call_id: callId,
    }),
  );
  at += 100;
  push(
    p(0, {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "stop",
      name: "read_file",
      arguments: "",
      tool_call_id: callId,
    }),
  );
  push(toolCall(0, callId, "read_file", { path: "src/rag.ts" }));
  push(requestEnd(0));
  at += 1400;
  push(toolOutput(0, callId, RAG_EXCERPT));
  at += 300;
  push(requestBegin(0));

  at += 500;
  push(p(0, { type: "partial_text", role: "assistant", event_type: "start", text: "" }));
  for (const part of c.text) {
    for (const chunk of chunks(part)) {
      at += 45;
      push(p(0, { type: "partial_text", role: "assistant", event_type: "delta", text: chunk }));
    }
  }
  at += 150;
  push(p(0, { type: "partial_text", role: "assistant", event_type: "stop", text: "" }));
  push(assistantText(0, c.text.join("")));
  push(tokenUsage(0, 51_300, 7_500));
  push(requestEnd(0));
  return steps;
}

/** The title the model gives a conversation after its first turn. */
export const replyTitle = (lang: Lang): string => COPY[lang].reply.title;

/** What the approval session's command says once decided. */
export function approvalOutcome(
  lang: Lang,
  decision: "allow" | "deny",
): {
  output: string;
  text: string;
} {
  const c = COPY[lang].approval;
  return decision === "allow"
    ? {
        output:
          "npm notice publishing @penguinharness/docs-expert@2026.9.14.1\nnpm notice 48.2 KB dist/index.js\n+ @penguinharness/docs-expert@2026.9.14.1",
        text: c.allowed,
      }
    : { output: "Tool call denied by user.", text: c.denied };
}

/** The Markdown answer the streaming Session streams, and the library's streaming board plays. */
export const streamingAnswer = (lang: Lang): string => COPY[lang].streaming.answer;

/** The sentences the thinking session keeps adding, one per beat, cycling. */
export const thinkingBeats = (lang: Lang): readonly string[] => COPY[lang].thinking.sentences;
