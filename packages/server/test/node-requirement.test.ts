/**
 * The Node a WAF module asks for, against the one the server builds it with. Only the ranges
 * WAF writes are judged; anything else is left alone rather than guessed at.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeRequirementNote, satisfiesNodeRange } from "../src/activities/node-requirement.js";

describe("a Node range", () => {
  it.each([
    ["v24.19.0", ">=24.19.0 <25", true],
    ["v24.18.2", ">=24.19.0 <25", false],
    ["v25.0.0", ">=24.19.0 <25", false],
    ["v24.19.0", "24.19.0", true],
    ["v24.19.1", "24.19.0", false],
    ["v24.3.0", "24", true],
    ["v24.3.0", "24.x", true],
    ["v22.1.0", "^24", false],
    ["v24.9.0", "~24.8", false],
    ["v24.8.5", "~24.8", true],
    ["v18.0.0", "16 || >= 18", true],
    ["v24.0.0", "*", true],
    ["v24.0.0", "lts/*", null],
    ["v24.0.0", "node", null],
  ])("judges %s against %s", (version, range, expected) => {
    expect(satisfiesNodeRange(version, range)).toBe(expected);
  });
});

describe("a module's Node requirement", () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    for (const dir of cleanups.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  async function module(files: Record<string, string>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-node-requirement-"));
    cleanups.push(root);
    for (const [name, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await fs.writeFile(path.join(root, name), text);
    }
    return path.join(root, "modules", "m");
  }

  const workspace = {
    "package.json": JSON.stringify({ workspaces: ["modules/*"] }),
    ".nvmrc": "24.19.0\n",
    "modules/m/package.json": JSON.stringify({ engines: { node: ">=24.19.0 <25" } }),
  };

  it("says nothing when the module asks for the Node that runs", async () => {
    expect(nodeRequirementNote(await module(workspace), "v24.19.0")).toBeNull();
  });

  it("names the .nvmrc and the engines a different Node breaks, and the Node used", async () => {
    const note = nodeRequirementNote(await module(workspace), "v22.11.0");
    expect(note).toContain(`24.19.0 (${path.join("..", "..", ".nvmrc")})`);
    expect(note).toContain(">=24.19.0 <25 (engines in package.json)");
    expect(note).toContain("v22.11.0");
  });

  it("stops looking for .nvmrc at the workspace root", async () => {
    const dir = await module({
      ".nvmrc": "4\n",
      "modules/package.json": JSON.stringify({ workspaces: ["m"] }),
      "modules/m/package.json": "{}",
    });
    expect(nodeRequirementNote(dir, "v24.19.0")).toBeNull();
  });

  it("reads no .nvmrc above a module that is not in a workspace", async () => {
    const dir = await module({ ".nvmrc": "4\n", "modules/m/package.json": "{}" });
    expect(nodeRequirementNote(dir, "v24.19.0")).toBeNull();
  });

  it("leaves an nvm alias alone", async () => {
    expect(
      nodeRequirementNote(await module({ "modules/m/.nvmrc": "lts/*\n" }), "v24.19.0"),
    ).toBeNull();
  });
});
