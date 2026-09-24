import { describe, expect, it } from "vitest";
import { upgradeAdapterPackage } from "../src/coding-agents/service.js";

const saved = (command: string, args: string[]) => ({ id: "claude", command, args, env: {} });

describe("upgradeAdapterPackage", () => {
  it("points a saved npx launch of the unscoped Claude adapter at the published package", () => {
    const upgraded = upgradeAdapterPackage(
      saved("c:\\program files\\nodejs\\npx.CMD", ["-y", "claude-agent-acp"]),
    );
    expect(upgraded.args).toEqual(["-y", "@agentclientprotocol/claude-agent-acp"]);
  });

  it("moves Codex's adapter to its current scope", () => {
    const upgraded = upgradeAdapterPackage(
      saved("/usr/bin/npx", ["-y", "@zed-industries/codex-acp"]),
    );
    expect(upgraded.args).toEqual(["-y", "@agentclientprotocol/codex-acp"]);
  });

  it("leaves a directly installed adapter and unrelated npx launches alone", () => {
    const direct = saved("C:\\bin\\claude-agent-acp.cmd", []);
    expect(upgradeAdapterPackage(direct)).toBe(direct);
    const other = saved("npx", ["-y", "some-agent", "constructor"]);
    expect(upgradeAdapterPackage(other)).toBe(other);
  });
});
