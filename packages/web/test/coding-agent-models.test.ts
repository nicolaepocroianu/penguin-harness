import { describe, expect, it } from "vitest";
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
} from "@prismshadow/penguin-server/api";
import {
  CODING_AGENT_PROVIDER,
  codingAgentModelRows,
  parseCodingAgentRef,
} from "../src/features/chat/coding-agent-models";
import { visibleChatModels } from "../src/features/models/model-grouping";

const modelOption: CodingAgentConfigOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "fast",
  options: [
    { value: "fast", name: "Fast" },
    { value: "deep", name: "Deep" },
  ],
};

function discovery(
  candidates: Partial<CodingAgentDiscoveryResponse["candidates"][number]>[],
  agentModels: CodingAgentDiscoveryResponse["agentModels"] = {},
): CodingAgentDiscoveryResponse {
  return {
    agentModels,
    candidates: candidates.map((c) => ({
      recipeId: "x",
      title: "X",
      homepageUrl: "https://example.com",
      detected: true,
      launch: { command: "x", args: [] },
      authHint: "",
      setupHint: null,
      alreadyAdded: false,
      rememberedModel: null,
      ...c,
    })),
  };
}

describe("codingAgentModelRows", () => {
  it("offers each saved or runnable agent, and each model it advertised", () => {
    const saved: CodingAgentServerInfo[] = [
      { id: "cline", title: "Cline", command: "cline", args: [] },
    ];
    const rows = codingAgentModelRows(
      saved,
      discovery(
        [
          { recipeId: "codex", title: "Codex CLI", models: [modelOption] },
          { recipeId: "cline", title: "Cline" },
          // Installed, but nothing runnable: it could not start a session.
          { recipeId: "claude", title: "Claude Code", launch: null },
          { recipeId: "gemini", title: "Gemini CLI", detected: false, launch: null },
        ],
        { cline: [modelOption] },
      ),
    );
    expect(rows.map((r) => [r.modelId, r.displayName])).toEqual([
      ["cline", "Cline"],
      ["cline::model::fast", "Cline · Fast"],
      ["cline::model::deep", "Cline · Deep"],
      ["codex", "Codex CLI"],
      ["codex::model::fast", "Codex CLI · Fast"],
      ["codex::model::deep", "Codex CLI · Deep"],
    ]);
    expect(new Set(rows.map((r) => r.provider))).toEqual(new Set([CODING_AGENT_PROVIDER]));
  });
});

describe("parseCodingAgentRef", () => {
  it("reads back the agent, and the model when one was picked", () => {
    expect(parseCodingAgentRef({ provider: CODING_AGENT_PROVIDER, modelId: "codex" })).toEqual({
      agentId: "codex",
      model: null,
    });
    expect(
      parseCodingAgentRef({ provider: CODING_AGENT_PROVIDER, modelId: "codex::model::gpt-5::x" }),
    ).toEqual({ agentId: "codex", model: { configId: "model", value: "gpt-5::x" } });
  });

  it("leaves ordinary models alone", () => {
    expect(parseCodingAgentRef({ provider: "openai", modelId: "gpt-5" })).toBeNull();
    expect(parseCodingAgentRef(null)).toBeNull();
  });
});

describe("the model dropdown's key filter", () => {
  it("never hides a coding agent, which signs in on its own", () => {
    const rows = [
      { provider: "openai", modelId: "gpt-5", credential: { apiKeyMasked: "sk-…1234" } },
      { provider: "openai", modelId: "gpt-4o" },
      { provider: CODING_AGENT_PROVIDER, modelId: "codex", displayName: "Codex CLI" },
    ];
    const visible = visibleChatModels(rows, { showAll: false, query: "", selected: null });
    expect(visible.map((r) => r.modelId)).toEqual(["gpt-5", "codex"]);
  });
});
