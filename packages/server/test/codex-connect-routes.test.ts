import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { CodexConnections, codexServerPath } from "../src/services/codex-connection.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("Codex plug-and-play setup", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  const base = "/api/projects/default_project/agents/default_agent";
  beforeEach(async () => {
    vi.spyOn(CodexConnections.prototype, "connect").mockResolvedValue({
      state: "pending",
      verificationUrl: "https://auth.openai.com/codex/device",
      message: "test code",
    });
    vi.spyOn(CodexConnections.prototype, "status").mockResolvedValue({ state: "connected" });
    vi.spyOn(CodexConnections.prototype, "disconnect").mockResolvedValue({ state: "disconnected" });
    t = await createTestApp();
    owner = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(async () => {
    await t.cleanup();
    vi.restoreAllMocks();
  });

  it("installs the skill and configures the packaged MCP runtime, preserving other entries and subsequent skill edits", async () => {
    const other = { name: "other", config: { command: "node", args: ["other.mjs"] } };
    expect((await owner.put(base + "/config", { config: { mcpServers: [other] } })).status).toBe(
      200,
    );
    expect((await owner.post(base + "/codex", {})).status).toBe(200);
    const view = await t.deps.agentConfigService.getConfig("default_project", "default_agent");
    expect(view.config.mcpServers).toEqual([
      other,
      {
        name: "codex",
        config: {
          command: process.execPath,
          args: [codexServerPath(), "--project-dir", path.join(t.root, "default_project")],
          timeoutMs: 60000,
          maxOutputLength: 180000,
        },
      },
    ]);
    const skill = path.join(view.stateDir, "skills", "codex", "SKILL.md");
    expect(await fs.readFile(skill, "utf8")).toContain("Codex");
    await fs.appendFile(skill, "\nKeep my custom instruction.\n");
    expect((await owner.post(base + "/codex", {})).status).toBe(200);
    expect(
      (await t.deps.agentConfigService.getConfig("default_project", "default_agent")).config
        .mcpServers,
    ).toHaveLength(2);
    expect(await fs.readFile(skill, "utf8")).toContain("Keep my custom instruction.");
  });

  it("refuses to replace a custom Codex server", async () => {
    const custom = [{ name: "codex", config: { command: "custom-codex" } }];
    await owner.put(base + "/config", { config: { mcpServers: custom } });
    const response = await owner.post(base + "/codex", {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "codex_config_conflict" } });
    expect(CodexConnections.prototype.connect).not.toHaveBeenCalled();
    expect(
      (await t.deps.agentConfigService.getConfig("default_project", "default_agent")).config
        .mcpServers,
    ).toEqual(custom);
  });

  it("rejects project members before reading credentials or changing setup", async () => {
    const member = apiClient(t.app, (await provisionUser(t.app, "codex_member")).cookie);
    expect(
      (await owner.post("/api/projects/default_project/members", { userId: "codex_member" }))
        .status,
    ).toBe(201);
    expect((await member.get(base + "/codex")).status).toBe(403);
    expect((await member.post(base + "/codex", {})).status).toBe(403);
    expect((await member.delete(base + "/codex")).status).toBe(403);
    expect(CodexConnections.prototype.status).not.toHaveBeenCalled();
    expect(CodexConnections.prototype.connect).not.toHaveBeenCalled();
    expect(CodexConnections.prototype.disconnect).not.toHaveBeenCalled();
  });
});
