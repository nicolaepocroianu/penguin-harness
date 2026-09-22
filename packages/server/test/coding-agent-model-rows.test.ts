import { describe, expect, it } from "vitest";
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
} from "../src/api/types.js";
import { codingAgentModelRows } from "../src/coding-agents/model-rows.js";
import { CODING_AGENT_PROVIDER } from "../src/coding-agents/session-runtime.js";

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
