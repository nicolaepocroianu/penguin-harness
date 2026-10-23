/**
 * A module release's checks against real git: a bare origin in a temp folder, the module clone
 * cloned from it by file URL, and the deploy's own clones. The checks are a stand-in program
 * that looks for a repository above where it runs, then does what code that runs unconfined
 * could: plants hooks, a hooks path and a file-system monitor in the clone's `.git`. The deploy's
 * git after it (prepare_deploy's branch, commit and status, a push, the clone's state) runs none
 * of them. `activity-run-build-confined.test.ts` shows the sandbox refusing the clone itself.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { gitClones } from "../src/activities/clone.js";
import { BASE_BRANCH, deployBranchName } from "../src/activities/deploy-git.js";
import type { DeployProcess } from "../src/activities/deploy-process.js";
import { defaultDeploySettings } from "../src/activities/deploy-settings.js";
import {
  DEPLOY_STAGE_DEFINITIONS,
  realClock,
  type DeployStageContext,
} from "../src/activities/deploy-stages.js";

const WHO = { name: "Deploy Bot", email: "deploy@example.org" };
const roots: string[] = [];

// Newer git starts background maintenance after a commit, which can still be writing into a
// test's repository while the test removes it. Every git here reads this environment.
beforeAll(() => {
  vi.stubEnv("GIT_CONFIG_COUNT", "1");
  vi.stubEnv("GIT_CONFIG_KEY_0", "maintenance.auto");
  vi.stubEnv("GIT_CONFIG_VALUE_0", "false");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
});

/** Runs git as a person would, hooks and all; throws when it fails. */
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", `user.name=${WHO.name}`, "-c", `user.email=${WHO.email}`, ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** The hooks a planted `.git` could run on what a deploy does: checkout, commit, push. */
const HOOKS = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "post-checkout",
  "reference-transaction",
  "pre-push",
  "post-index-change",
];

/**
 * What a check running unconfined could leave in the clone's `.git`: every hook, in `.git/hooks`
 * and in a hooks path of its own, and a file-system monitor, each noting in `marker` that it ran.
 */
async function plant(clone: string, marker: string) {
  const note = (who: string) => `#!/bin/sh\necho ${who} >> '${marker.split(path.sep).join("/")}'\n`;
  const own = path.join(clone, ".git", "own-hooks");
  await fs.mkdir(own, { recursive: true });
  for (const hook of HOOKS)
    for (const folder of [path.join(clone, ".git", "hooks"), own]) {
      await fs.writeFile(path.join(folder, hook), note(hook));
      await fs.chmod(path.join(folder, hook), 0o755);
    }
  const monitor = path.join(clone, ".git", "monitor");
  await fs.writeFile(monitor, note("fsmonitor"));
  await fs.chmod(monitor, 0o755);
  git(clone, "config", "core.hooksPath", own.split(path.sep).join("/"));
  git(clone, "config", "core.fsmonitor", monitor.split(path.sep).join("/"));
}

it("runs the checks where no repository is, and none of what they planted in the clone's .git", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wafh-deploy-checks-"));
  roots.push(root);
  const bare = path.join(root, "origin.git");
  git(root, "init", "--bare", "--initial-branch=main", bare);
  const url = pathToFileURL(bare).href;
  const seed = path.join(root, "seed");
  git(root, "clone", url, seed);
  git(seed, "checkout", "-B", "main");
  await fs.writeFile(
    path.join(seed, "package.json"),
    JSON.stringify({ name: "waf-module-words", version: "1.0.0" }),
  );
  git(seed, "add", "--all");
  git(seed, "commit", "-m", "seed");
  git(seed, "push", "-u", "origin", "main");
  const dir = path.join(root, "waf", "waf-module-words");
  git(root, "clone", url, dir);
  await fs.writeFile(path.join(dir, "authored.js"), "export {};");
  const marker = path.join(root, "hooks-ran.txt");

  const checks: Array<{ cwd: string; repositories: string[] }> = [];
  const process: DeployProcess = {
    async run(_command, args, options) {
      const cwd = options.cwd!;
      // Every folder from where the check runs up to the root of the disk that holds a `.git`.
      const repositories: string[] = [];
      for (let at = cwd; ; at = path.dirname(at)) {
        if (existsSync(path.join(at, ".git"))) repositories.push(at);
        if (path.dirname(at) === at) break;
      }
      checks.push({ cwd, repositories });
      if (args[0] === "ci") await plant(dir, marker);
      return { code: 0, tail: "" };
    },
  };
  const settings = defaultDeploySettings();
  settings.git = { userName: WHO.name, userEmail: WHO.email };
  const clones = gitClones();
  const ctx: DeployStageContext = {
    clones,
    serial: (_repo, work) => work(),
    jenkins: {
      trigger: async () => ({ queueUrl: null }),
      status: async () => ({ state: "unknown" }),
    },
    process,
    styles: async () => ({ code: 1, tail: "No stylesheet is compiled here." }),
    confinement: () => null,
    clock: realClock,
    settings,
    productCode: "words",
    module: {
      folder: "waf-module-words",
      dir,
      checkDir: path.join(root, "home", "activity-deploy", "checks", "waf-module-words"),
      source: null,
    },
    moduleVersion: "1.0.1",
    metadata: {},
    earlier: {},
    log: () => {},
    signal: new AbortController().signal,
  };

  await DEPLOY_STAGE_DEFINITIONS.verify_module.run(ctx);
  // The checks ran in the check folder, with no repository there or above it.
  expect(checks).toHaveLength(4);
  for (const check of checks) {
    expect(check.cwd).toBe(checks[0]!.cwd);
    expect(path.dirname(check.cwd)).toBe(ctx.module.checkDir);
    expect(check.repositories).toEqual([]);
  }
  expect(await fs.readdir(ctx.module.checkDir)).toEqual([]);

  await DEPLOY_STAGE_DEFINITIONS.prepare_deploy.run(ctx);
  const clone = clones.open(dir);
  const branch = deployBranchName("waf-module-words");
  await clone.push(BASE_BRANCH, { track: true });
  await clone.push(branch, { track: true });
  expect(await clone.state()).toMatchObject({ branch, clean: true });
  expect(await clone.changes()).toEqual([]);
  // Committed and pushed, and not one planted program ran.
  expect(ctx.metadata.commit).toBe(git(bare, "rev-parse", `refs/heads/${branch}`));
  expect(JSON.parse(git(dir, "show", `${branch}:package.json`))).toMatchObject({
    version: "1.0.1",
  });
  expect(existsSync(marker)).toBe(false);

  // What was planted is real: git run as a person runs it, it runs.
  git(dir, "commit", "--allow-empty", "-m", "by hand");
  expect(await fs.readFile(marker, "utf8")).toContain("pre-commit");
}, 60_000);
