/**
 * The WAF workspace: an admin reads and changes its settings (403 for anyone else), Prepare
 * clones the shared repositories under PENGUIN_HOME/waf and installs the framework's and
 * navbar's dependencies, media arrives partial and sparse, and a product module is cloned on
 * first use — or started empty with origin set when its repository does not exist yet.
 *
 * The clones and npm are fakes: nothing here reaches a network or a real remote. What git does
 * with a clone is `activity-clone.test.ts`'s.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeWafWorkspaceSettings,
  type WafWorkspace,
  type WafWorkspaceSettings,
  defaultWafWorkspaceSettings,
  type WafWorkspaceStatus,
} from "../src/activities/waf-workspace.js";
import { FakeClones } from "./fake-clones.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

describe("WAF workspace", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(
    existing?: ReadonlySet<string>,
    options: { autoPrepare?: boolean; diverged?: Set<string> } = {},
  ) {
    vi.stubEnv("WAF_ROOT_DIR", "");
    const clones = new FakeClones();
    clones.existingRemotes = new Set(existing ?? []);
    if (options.diverged) clones.cloned = { diverged: [...options.diverged] };
    const installs: string[] = [];
    const t = await createTestApp({
      wafCheckout: false,
      wafWorkspacePorts: {
        ...(options.autoPrepare ? { autoPrepare: true } : {}),
        clones,
        runProcess: async (_command, _args, options) => {
          installs.push(options.cwd);
          await fs.mkdir(path.join(options.cwd, "node_modules"), { recursive: true });
          return { code: 0, tail: "" };
        },
      },
    });
    cleanups.push(t.cleanup);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const workspace = t.deps.tree.api<WafWorkspace>("ActivitiesModule", "WafWorkspace");
    return { t, clones, installs, admin, workspace };
  }

  async function prepared(s: Awaited<ReturnType<typeof setup>>) {
    expect((await s.admin.post("/api/admin/waf-workspace/prepare", {})).status).toBe(200);
    for (;;) {
      const { status } = (await (await s.admin.get("/api/admin/waf-workspace")).json()) as {
        status: WafWorkspaceStatus;
      };
      if (!status.preparing) return status;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it("is an admin's to read and change", async () => {
    const s = await setup();
    const member = apiClient(s.t.app, (await provisionUser(s.t.app, "member")).cookie);
    expect((await member.get("/api/admin/waf-workspace")).status).toBe(403);
    expect((await member.post("/api/admin/waf-workspace/prepare", {})).status).toBe(403);
    const saved = await s.admin.put("/api/admin/waf-workspace/settings", {
      repos: { framework: { branch: "v3" } },
    });
    expect(saved.status).toBe(200);
    const read = (await (await s.admin.get("/api/admin/waf-workspace/settings")).json()) as {
      settings: WafWorkspaceSettings;
    };
    expect(read.settings.repos.framework).toEqual({
      remote: "git@github.com:waterfordresearchinstitute/waf-framework.git",
      branch: "v3",
    });
    const bad = await s.admin.put("/api/admin/waf-workspace/settings", {
      moduleRemote: "git@github.com:org/fixed.git",
    });
    expect(bad.status).toBe(400);
  });

  it("prepares itself in the background when the server starts and it is not ready", async () => {
    const s = await setup(undefined, { autoPrepare: true });
    let status: WafWorkspaceStatus;
    for (;;) {
      status = (
        (await (await s.admin.get("/api/admin/waf-workspace")).json()) as {
          status: WafWorkspaceStatus;
        }
      ).status;
      if (!status.preparing && status.ready) break;
      if (!status.preparing && status.lastError) throw new Error(status.lastError);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(s.clones.ops().filter((op) => op === "cloneFrom")).toHaveLength(4);
    expect(await s.workspace.root()).toBe(status.root);
  });

  it("says it is not prepared, and why the last try failed, when there is no root", async () => {
    const s = await setup();
    await expect(s.workspace.requireRoot()).rejects.toMatchObject({
      status: 409,
      code: "waf_workspace_not_ready",
    });
    await s.clones.onDisk(path.join(s.t.root, "waf", "framework"), {
      origin: "git@github.com:someone/else.git",
    });
    await prepared(s);
    await expect(s.workspace.requireRoot()).rejects.toThrow(/someone\/else/);
  });

  it("is not ready, and has no root, until it is prepared", async () => {
    const s = await setup();
    expect(await s.workspace.root()).toBeNull();
    const status = await prepared(s);
    expect(status.ready).toBe(true);
    expect(status.lastError).toBeNull();
    expect(status.root).toBe(path.join(s.t.root, "waf"));
    expect(await s.workspace.root()).toBe(status.root);
  });

  it("clones the four shared repositories, media sparse without LFS, and installs two", async () => {
    const s = await setup();
    await prepared(s);
    const clones = s.clones.calls.filter((call) => call.op === "cloneFrom");
    expect(clones.map((call) => call.dir.replace(s.t.root, "~"))).toEqual([
      path.join("~", "waf", "framework"),
      path.join("~", "waf", "modules", "navbar"),
      path.join("~", "waf", "media"),
      path.join("~", "waf", "waf-activity-data"),
    ]);
    // One branch each, the framework's v2; only media is partial and sparse.
    expect(clones.map((call) => call.args[1])).toEqual([
      { branch: "v2", partial: false },
      { branch: "main", partial: false },
      { branch: "main", partial: true },
      { branch: "main", partial: false },
    ]);
    expect(s.installs.map((dir) => path.relative(s.t.root, dir))).toEqual([
      path.join("waf", "framework"),
      path.join("waf", "modules", "navbar"),
    ]);
  });

  it("leaves correct clones alone when prepared again", async () => {
    const s = await setup();
    await prepared(s);
    const before = s.clones.calls.length;
    await prepared(s);
    expect(s.clones.calls.slice(before).some((call) => call.op === "cloneFrom")).toBe(false);
  });

  it("refuses to reuse a clone of another remote", async () => {
    const s = await setup();
    await s.clones.onDisk(path.join(s.t.root, "waf", "framework"), {
      origin: "git@github.com:someone/else.git",
    });
    const status = await prepared(s);
    expect(status.ready).toBe(false);
    expect(status.lastError).toMatch(/someone\/else/);
  });

  it("counts the activity data, and switches a clone to a branch changed in Settings", async () => {
    const s = await setup();
    expect((await prepared(s)).ready).toBe(true);
    await fs.rm(path.join(s.t.root, "waf", "waf-activity-data", ".git"), { recursive: true });
    expect((await s.workspace.status()).ready).toBe(false);
    expect(await s.workspace.root()).toBeNull();
    expect((await prepared(s)).ready).toBe(true);

    const { settings } = (await (
      await s.admin.get("/api/admin/waf-workspace/settings")
    ).json()) as {
      settings: { repos: Record<string, { remote: string; branch: string }> };
    };
    const framework = { ...settings.repos.framework!, branch: "v3" };
    const saved = await s.admin.put("/api/admin/waf-workspace/settings", {
      repos: { ...settings.repos, framework },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const before = await s.workspace.status();
    expect(before.ready).toBe(false);
    expect(before.repos.find((repo) => repo.id === "framework")).toMatchObject({
      branch: "v2",
      branchMatches: false,
    });
    const installs = s.installs.length;
    const after = await prepared(s);
    expect(after.ready).toBe(true);
    expect(after.repos.find((repo) => repo.id === "framework")!.branch).toBe("v3");
    // Switched as origin has it, never reset: a clone with work of its own is refused first.
    const frameworkDir = path.join(s.t.root, "waf", "framework");
    expect(
      s.clones.calls
        .filter((call) => call.dir === frameworkDir && call.op === "onBranchFromOrigin")
        .map((call) => call.args),
    ).toEqual([["v3", { work: "clean" }]]);
    expect(s.installs.length).toBe(installs + 1);
  });

  it("goes back to the clone's branch, not ready, when the new one has diverged from origin", async () => {
    const s = await setup(undefined, { diverged: new Set(["v3"]) });
    expect((await prepared(s)).ready).toBe(true);
    const { settings } = (await (
      await s.admin.get("/api/admin/waf-workspace/settings")
    ).json()) as {
      settings: { repos: Record<string, { remote: string; branch: string }> };
    };
    const framework = { ...settings.repos.framework!, branch: "v3" };
    await s.admin.put("/api/admin/waf-workspace/settings", {
      repos: { ...settings.repos, framework },
    });
    const after = await prepared(s);
    expect(after.ready).toBe(false);
    expect(after.lastError).toMatch(/framework's v3/);
    expect(after.repos.find((repo) => repo.id === "framework")).toMatchObject({
      branch: "v2",
      branchMatches: false,
    });
  });

  it("adds a product's media folder to the sparse checkout once", async () => {
    const s = await setup();
    await prepared(s);
    await s.workspace.ensureMedia(["loom/words"]);
    await s.workspace.ensureMedia(["loom/words"]);
    expect(s.clones.repo(path.join(s.t.root, "waf", "media"))?.sparse).toEqual(["loom/words"]);
    await expect(s.workspace.ensureMedia(["../escape"])).rejects.toThrow(/media folder/);
  });

  it("clones a product's module when its repository exists, else starts one", async () => {
    const remote = "git@github.com:waterfordresearchinstitute/waf-module-old.git";
    const s = await setup(new Set([remote]));
    await prepared(s);
    const old = await s.workspace.ensureModule("waf-module-old");
    expect(s.clones.repo(old)?.origin).toBe(remote);
    const fresh = await s.workspace.ensureModule("waf-module-new");
    expect(s.clones.repo(fresh)?.origin).toBe(
      "git@github.com:waterfordresearchinstitute/waf-module-new.git",
    );
    expect(s.clones.ops(fresh)).toEqual(["create"]);
    await expect(s.workspace.ensureModule("../x")).rejects.toThrow(/module folder/);
  });

  it("uses an existing checkout as it is, and never clones into it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-waf-external-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "modules"), { recursive: true });
    await fs.mkdir(path.join(root, "media"), { recursive: true });
    const s = await setup();
    expect(
      (await s.admin.put("/api/admin/waf-workspace/settings", { externalRoot: root })).status,
    ).toBe(200);
    const status = await prepared(s);
    expect(status.managed).toBe(false);
    expect(status.ready).toBe(true);
    expect(await s.workspace.root()).toBe(await fs.realpath(root));
    expect(s.clones.ops()).not.toContain("cloneFrom");
  });
});

describe("WAF workspace settings", () => {
  it("rejects a relative checkout, a bad branch, and a password in a remote", () => {
    const base = defaultWafWorkspaceSettings();
    expect(() => normalizeWafWorkspaceSettings(base, { externalRoot: "waf" })).toThrow();
    expect(() =>
      normalizeWafWorkspaceSettings(base, { repos: { media: { branch: "a..b" } } }),
    ).toThrow();
    expect(() =>
      normalizeWafWorkspaceSettings(base, {
        repos: { media: { remote: "https://me:secret@github.com/org/media.git" } },
      }),
    ).toThrow();
    expect(normalizeWafWorkspaceSettings(base, {})).toEqual(base);
  });
});
