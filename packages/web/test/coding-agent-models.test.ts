import { describe, expect, it } from "vitest";
import {
  CODING_AGENT_PROVIDER,
  codingAgentLogo,
  parseCodingAgentRef,
} from "../src/features/chat/coding-agent-models";
import { visibleChatModels } from "../src/features/models/model-grouping";

describe("codingAgentLogo", () => {
  it("uses the vendor's logo where Penguin has one, else the agent's own letter tile", () => {
    expect(codingAgentLogo("codex", "Codex CLI")).toBe("openai");
    expect(codingAgentLogo("opencode", "OpenCode")).toBe("OpenCode");
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
