import { describe, expect, it } from "vitest";
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
} from "@prismshadow/penguin-server/api";
import {
  buildAgentCards,
  currentModel,
  effortOptionOf,
} from "../src/features/coding-agents/agent-cards";

const model: CodingAgentConfigOption = {
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
const effort: CodingAgentConfigOption = {
  id: "effort",
  name: "Effort",
  category: "thought_level",
  type: "select",
  currentValue: "medium",
  options: [{ value: "medium", name: "Medium" }],
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

describe("buildAgentCards", () => {
  it("splits installed from available and names who makes each agent", () => {
    const { installed, available } = buildAgentCards(
      [],
      discovery([
        { recipeId: "codex", title: "Codex CLI", version: "codex-cli 0.146.0", authStatus: "ok" },
        { recipeId: "cline", title: "Cline", detected: false, launch: null, setupHint: null },
      ]),
      "Setup required",
    );
    expect(installed).toEqual([
      expect.objectContaining({
        agentId: "codex",
        vendor: "OpenAI official CLI",
        version: "codex-cli 0.146.0",
        authStatus: "ok",
        startable: true,
      }),
    ]);
    expect(available).toEqual([
      expect.objectContaining({ agentId: "cline", startable: false, setupHint: "Setup required" }),
    ]);
  });

  it("lets a saved command override the recipe's, and lists custom agents too", () => {
    const { installed } = buildAgentCards(
      [
        { id: "codex", command: "my-codex", args: ["--acp"] },
        { id: "custom", title: "Custom", command: "agent", args: [] },
      ],
      discovery([{ recipeId: "codex", title: "Codex CLI", detected: false, launch: null }]),
      "",
    );
    expect(installed.map((c) => [c.agentId, c.commandLine, c.startable])).toEqual([
      ["codex", "my-codex --acp", true],
      ["custom", "agent", true],
    ]);
  });

  it("prefers a saved definition's own probe over the recipe's", () => {
    const { installed } = buildAgentCards(
      [{ id: "codex", command: "codex-acp", args: [] }],
      discovery([{ recipeId: "codex", models: [effort] }], { codex: [model] }),
      "",
    );
    expect(installed[0]!.options).toEqual([model]);
  });
});

describe("currentModel and effortOptionOf", () => {
  const base = {
    key: "k",
    agentId: "codex",
    title: "Codex",
    commandLine: "codex-acp",
    saved: true,
    startable: true,
  };

  it("shows the remembered model when it belongs to the advertised option", () => {
    expect(
      currentModel({
        ...base,
        options: [model],
        rememberedModel: { configId: "model", value: "deep" },
      }),
    ).toEqual({ value: "deep", name: "Deep" });
    expect(currentModel({ ...base, options: [model], rememberedModel: null })).toEqual({
      value: "fast",
      name: "Fast",
    });
  });

  it("still names a remembered model before any probe has run", () => {
    expect(
      currentModel({
        ...base,
        rememberedModel: { configId: "model", value: "gpt-5", name: "GPT-5" },
      }),
    ).toEqual({ value: "gpt-5", name: "GPT-5" });
    expect(currentModel(base)).toBeNull();
  });

  it("finds the reasoning effort only when the agent advertises one", () => {
    expect(effortOptionOf([model, effort])).toBe(effort);
    expect(effortOptionOf([model])).toBeUndefined();
  });
});

describe("built-in and env on cards", () => {
  it("leaves built-in definitions off Local CLI and carries env onto cards", () => {
    const { installed } = buildAgentCards(
      [
        {
          id: "mine",
          command: "x",
          args: [],
          env: [{ key: "K", valueMasked: "***" }],
          envPending: true,
        },
        { id: "copilot-builtin", command: "y", args: [], builtin: "copilot" },
      ],
      null,
      "setup",
    );
    expect(installed.map((c) => c.agentId)).toEqual(["mine"]);
    expect(installed[0]!.env).toEqual([{ key: "K", valueMasked: "***" }]);
    expect(installed[0]!.envPending).toBe(true);
  });
});
