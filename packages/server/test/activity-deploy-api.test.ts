/**
 * The deploy routes: the settings are an admin's (403 for anyone else) and never hand a token
 * back; the connection test is one GET with the stored credentials; the activity's deploy
 * context is a member's to read, and Prepare clones is the owner's. The clones are the WAF
 * workspace's: the managed workspace clones a product's module when its first ref is made (the
 * ref's files live in the module), an existing checkout's clones are its owner's, and a second
 * press of Prepare clones leaves correct clones alone.
 *
 * The clones and Jenkins are fakes: nothing here reaches a network or a real remote.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { JenkinsRequest } from "../src/activities/deploy-service.js";
import type {
  DeployConnectionTestResponse,
  DeployContextResponse,
  DeploySettingsResponse,
} from "../src/activities/deploy-types.js";
import { activitySpec } from "./activity-fixtures.js";
import { FakeClones } from "./fake-clones.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const PROJECT = "deployer-work";
const MODULE_REMOTE = "git@github.com:org/waf-module-words.git";
const DATA_REMOTE = "git@github.com:org/data.git";
const MEDIA_REMOTE = "git@github.com:org/media.git";

/** Clones that answer from memory; a clone made through them is a `.git` folder on disk. */
function fakeClones(options: { failClone?: string } = {}) {
  const clones = new FakeClones();
  if (options.failClone)
    clones.failClone = {
      remote: options.failClone,
      stderr: "Cloning...\nfatal: repository not found",
    };
  return clones;
}

describe("activity deploy routes", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /**
   * An existing WAF checkout, the workspace's root. Its activity-data and media repositories
   * are clones of the remotes the workspace names (unless `shared` is false), and so is the
   * product's module (unless `module` is false): its owner cloned it, and WAF Harness writes the
   * product's files into it.
   */
  async function checkout(
    clones: FakeClones,
    options: { shared?: boolean; module?: boolean } = {},
  ) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "wafh-deploy-waf-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "media"), { recursive: true });
    await fs.mkdir(path.join(root, "modules"), { recursive: true });
    const repos: Array<[string, string]> = [];
    if (options.shared !== false)
      repos.push(["waf-activity-data", DATA_REMOTE], ["media", MEDIA_REMOTE]);
    if (options.module !== false) repos.push(["modules/waf-module-words", MODULE_REMOTE]);
    for (const [folder, remote] of repos)
      await clones.onDisk(path.join(root, folder), { origin: remote });
    vi.stubEnv("WAF_ROOT_DIR", root);
    return root;
  }

  /**
   * The managed workspace under the test's root, as preparing it leaves it: the shared
   * repositories cloned, media sparse with no product's folder yet. A product's module is
   * cloned into it when the product's first ref is made.
   */
  async function managedWorkspace(clones: FakeClones, root: string) {
    const waf = path.join(root, "waf");
    for (const [folder, remote] of [
      ["framework", "git@github.com:org/waf-framework.git"],
      ["modules/navbar", "git@github.com:org/navbar.git"],
      ["media", MEDIA_REMOTE],
      ["waf-activity-data", DATA_REMOTE],
    ] as const)
      await clones.onDisk(path.join(waf, folder), {
        origin: remote,
        ...(folder === "media" ? { sparse: [] } : {}),
      });
    await fs.mkdir(path.join(waf, "framework", "node_modules"), { recursive: true });
    await fs.mkdir(path.join(waf, "modules", "navbar", "node_modules"), { recursive: true });
  }

  /**
   * An app, an owner, and ref 1 of `words` with a specification. The WAF root is an existing
   * checkout (made first, since the ref's files are written into its module) or, with
   * `managed`, the managed workspace, which clones the module as the ref is made.
   */
  async function setup(
    options: {
      failClone?: string;
      checkout?: { shared?: boolean; module?: boolean };
      managed?: boolean;
    } = {},
  ) {
    const git = fakeClones(options);
    const waf = options.managed ? null : await checkout(git, options.checkout);
    const jenkins: JenkinsRequest[] = [];
    const t = await createTestApp({
      ...(options.managed
        ? { wafCheckout: false, beforeSeed: (root: string) => managedWorkspace(git, root) }
        : {}),
      deployPorts: {
        clones: git,
        getJenkins: async (request) => {
          jenkins.push(request);
          return { status: 200 };
        },
      },
      wafWorkspacePorts: { clones: git },
    });
    cleanups.push(t.cleanup);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    // The remotes are the WAF workspace's; a managed workspace clones the module from them.
    const workspace = await admin.put("/api/admin/waf-workspace/settings", {
      repos: { activityData: { remote: DATA_REMOTE }, media: { remote: MEDIA_REMOTE } },
      moduleRemote: "git@github.com:org/{module}.git",
    });
    expect(workspace.status).toBe(200);
    const owner = await provisionUser(t.app, "deployer");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const context = async (endpoint: string, query = "") => {
      const res = await client.get(`${endpoint}/deploy/context${query}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as DeployContextResponse).context;
    };
    return { t, git, jenkins, admin, client, owner, base, waf, context };
  }

  /** Ref 1 of `words`, with a specification. */
  async function createWords(client: ReturnType<typeof apiClient>, base: string) {
    const created = await client.post(base, { productCode: "words", refNum: 1, title: "Words" });
    expect(created.status).toBe(201);
    const activity = (await created.json()) as ActivityDetail;
    const applied = await client.post(`${base}/${activity.id}/apply-generated-spec`, {
      expectedRevision: activity.draft.contentRevision,
      spec: { ...activitySpec, moduleFolder: "waf-module-words" },
    });
    expect(applied.status).toBe(200);
    return activity;
  }

  async function setupWords(options: Parameters<typeof setup>[0] = {}) {
    const found = await setup(options);
    const activity = await createWords(found.client, found.base);
    const endpoint = `${found.base}/${activity.id}`;
    return {
      ...found,
      activity,
      endpoint,
      context: (query = "") => found.context(endpoint, query),
    };
  }

  async function fillSettings(admin: ReturnType<typeof apiClient>) {
    const res = await admin.put("/api/admin/activity-deploy/settings", {
      qa: {
        jenkinsUrl: "https://jenkins.example.org",
        username: "robot",
        token: "qa-secret-token",
        frameworkVersion: "4.2.1",
        activityBaseUrl: "https://qa.example.org",
      },
      prod: { jenkinsUrl: "https://jenkins-prod.example.org", username: "robot" },
      git: { userName: "Deploy", userEmail: "deploy@example.org" },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as DeploySettingsResponse).settings;
  }

  it("keeps the settings to admins", async () => {
    const { client } = await setup();
    for (const res of [
      await client.get("/api/admin/activity-deploy/settings"),
      await client.put("/api/admin/activity-deploy/settings", { qa: { username: "x" } }),
      await client.post("/api/admin/activity-deploy/settings/test/qa"),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "admin_required" } });
    }
  });

  it("masks tokens, keeps one left empty, and clears one set to null", async () => {
    const { admin, t } = await setup();
    const saved = await fillSettings(admin);
    expect(saved.qa.token).toEqual({ set: true });
    expect(saved.prod.token).toEqual({ set: false });
    const read = await admin.get("/api/admin/activity-deploy/settings");
    const text = await read.text();
    expect(text).not.toContain("qa-secret-token");
    // Saving another field with the token field empty keeps it.
    const kept = await admin.put("/api/admin/activity-deploy/settings", {
      qa: { token: "", tier: "qa2" },
    });
    expect(((await kept.json()) as DeploySettingsResponse).settings.qa).toMatchObject({
      tier: "qa2",
      token: { set: true },
    });
    const cleared = await admin.put("/api/admin/activity-deploy/settings", { qa: { token: null } });
    expect(((await cleared.json()) as DeploySettingsResponse).settings.qa.token).toEqual({
      set: false,
    });
    // A refused field is named and nothing is written.
    const refused = await admin.put("/api/admin/activity-deploy/settings", {
      qa: { tier: "qa3", jenkinsUrl: "http://jenkins.example.org" },
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "invalid_deploy_setting",
        details: { field: "qa.jenkinsUrl", reason: "https_required" },
      },
    });
    const after = (await (
      await admin.get("/api/admin/activity-deploy/settings")
    ).json()) as DeploySettingsResponse;
    expect(after.settings.qa.tier).toBe("qa2");
    expect(await fs.readdir(t.root)).toContain("secrets");
  });

  it("tests a connection with the stored credentials and reports only the status", async () => {
    const { admin, jenkins } = await setup();
    await admin.put("/api/admin/activity-deploy/settings", { qa: { jenkinsUrl: "" } });
    const missing = await admin.post("/api/admin/activity-deploy/settings/test/qa");
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: { code: "deploy_settings_missing", details: { field: "qa.jenkinsUrl" } },
    });
    await fillSettings(admin);
    const res = await admin.post("/api/admin/activity-deploy/settings/test/qa");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text) as DeployConnectionTestResponse).toEqual({
      test: { ok: true, status: 200 },
    });
    expect(text).not.toContain("qa-secret-token");
    expect(jenkins).toHaveLength(1);
    expect(jenkins[0]!.url).toBe("https://jenkins.example.org/api/json");
    expect(jenkins[0]!.headers.Authorization).toBe(
      `Basic ${Buffer.from("robot:qa-secret-token").toString("base64")}`,
    );
    // PROD has a URL but no token: the GET goes without credentials.
    await admin.post("/api/admin/activity-deploy/settings/test/prod");
    expect(jenkins[1]!.headers.Authorization).toBeUndefined();
    expect((await admin.post("/api/admin/activity-deploy/settings/test/dev")).status).toBe(404);
  });

  it("lists what a deploy still needs, in codes", async () => {
    // A checkout with no shared clones and no module: WAF Harness starts the new product's module
    // as a repository with origin set, as Loom did, so only the shared clones are missing.
    const { context } = await setupWords({ checkout: { shared: false, module: false } });
    const found = await context();
    expect(found.ready).toBe(false);
    expect(found.problems).not.toContainEqual({ code: "workspace_not_ready" });
    expect(found.problems).toEqual(
      expect.arrayContaining([
        { code: "settings_missing", field: "qa.username" },
        { code: "settings_missing", field: "qa.token" },
        { code: "clone_missing", repo: "activityData" },
        { code: "clone_missing", repo: "media" },
      ]),
    );
    expect(found.problems).not.toContainEqual({ code: "clone_missing", repo: "module" });
    expect(found.module.clone.present).toBe(true);
    expect(found.module.clone.remoteUrlMatches).toBe(true);
  });

  it("refuses a ref that is not the canonical one", async () => {
    const { client, base, admin } = await setupWords();
    await fillSettings(admin);
    const second = (await (
      await client.post(base, { productCode: "words", refNum: 2, title: "Words 2" })
    ).json()) as ActivityDetail;
    const res = await client.get(`${base}/${second.id}/deploy/context`);
    const context = ((await res.json()) as DeployContextResponse).context;
    expect(context.problems).toContainEqual({ code: "not_canonical" });
    const prepare = await client.post(`${base}/${second.id}/deploy/clones`);
    expect(prepare.status).toBe(409);
    expect(await prepare.json()).toMatchObject({ error: { code: "deploy_not_canonical" } });
  });

  it("clones a new product's module into the managed workspace as its first ref is made, and a second press changes nothing", async () => {
    const { t, git, admin, client, base, context } = await setup({ managed: true });
    await fillSettings(admin);
    const activity = await createWords(client, base);
    const endpoint = `${base}/${activity.id}`;
    // The module is cloned from the workspace's template, where a WAF checkout keeps it, and
    // the ref's files are written into the clone.
    const module = path.join(t.root, "waf", "modules", "waf-module-words");
    const clones = git.calls.filter((call) => call.op === "cloneFrom");
    expect(clones.map((call) => [call.dir, call.args[0]])).toEqual([[module, MODULE_REMOTE]]);
    await fs.stat(
      path.join(module, "generated", "words", "refs", "words-1", "spec", "activity_spec.json"),
    );
    // Prepare clones adds only the product's media folder to the sparse set.
    const prepared = await client.post(`${endpoint}/deploy/clones`);
    expect(prepared.status).toBe(200);
    const after = ((await prepared.json()) as DeployContextResponse).context;
    expect(after.problems).toEqual([]);
    expect(after.ready).toBe(true);
    expect(git.ops().filter((op) => op === "cloneFrom")).toHaveLength(1);
    const media = path.join(t.root, "waf", "media");
    expect(git.repo(media)?.sparse).toEqual(["loom/words"]);
    const asksOrigin = (call: { op: string }) => call.op === "remoteHasBranch";

    const before = git.calls.length;
    const again = await client.post(`${endpoint}/deploy/clones`);
    expect(again.status).toBe(200);
    const second = git.calls.slice(before);
    expect(
      second.some((call) => ["cloneFrom", "remoteExists", "remoteHasBranch"].includes(call.op)),
    ).toBe(false);
    expect(git.repo(media)?.sparse).toEqual(["loom/words"]);
    expect((await context(endpoint)).ready).toBe(true);
    expect(git.calls.some(asksOrigin)).toBe(false);
    // Check remote asks the remote, and only the owner may.
    const checked = await context(endpoint, "?checkRemote=1");
    expect(checked.remoteChecked).toBe(true);
    expect(git.calls.some(asksOrigin)).toBe(true);
  });

  it("names a media clone whose sparse set lacks this product's folder, and leaves a checkout's media to its owner", async () => {
    const { git, admin, client, endpoint, context, waf } = await setupWords();
    await fillSettings(admin);
    expect((await client.post(`${endpoint}/deploy/clones`)).status).toBe(200);
    // The checkout's clones are its owner's: Prepare clones clones nothing into it.
    expect(git.ops()).not.toContain("cloneFrom");
    // The checkout's media was made sparse for another product's folder only.
    const media = git.repo(path.join(waf!, "media"))!;
    media.sparse = ["loom/other"];
    const found = await context();
    expect(found.ready).toBe(false);
    expect(found.problems).toEqual([{ code: "media_path_missing", path: "loom/words" }]);
    // Prepare clones never changes an existing checkout's sparse set.
    const again = await client.post(`${endpoint}/deploy/clones`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as DeployContextResponse).context.ready).toBe(false);
    expect(media.sparse).toEqual(["loom/other"]);
    // A parent folder in the sparse set brings the product's folder with it.
    media.sparse = ["loom/other", "loom"];
    expect((await context()).ready).toBe(true);
  });

  it("refuses a module remote no clone may be made from", async () => {
    const { git, admin, client, base, context } = await setup({ managed: true });
    const res = await admin.put("/api/admin/waf-workspace/settings", {
      moduleRemote: "file:///srv/modules/{module}.git",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { details: { field: "moduleRemote" } } });
    expect(git.ops()).not.toContain("cloneFrom");
    const activity = await createWords(client, base);
    expect((await context(`${base}/${activity.id}`)).module.remote).toBe(MODULE_REMOTE);
    expect(git.calls.find((call) => call.op === "cloneFrom")?.args[0]).toBe(MODULE_REMOTE);
  });

  it("refuses a new product's ref when its module will not clone, with git's own output", async () => {
    const { t, client, base } = await setup({ managed: true, failClone: MODULE_REMOTE });
    const res = await client.post(base, { productCode: "words", refNum: 1, title: "Words" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: {
        code: "module_clone_failed",
        message: expect.stringContaining("fatal: repository not found"),
      },
    });
    expect(await fs.readdir(path.join(t.root, "waf", "modules"))).toEqual(["navbar"]);
  });

  it("leaves a module folder that exists and is not a clone alone", async () => {
    const { t, client, base, git } = await setup({ managed: true });
    const taken = path.join(t.root, "waf", "modules", "waf-module-words");
    await fs.mkdir(taken, { recursive: true });
    await fs.writeFile(path.join(taken, "notes.txt"), "mine");
    const res = await client.post(base, { productCode: "words", refNum: 1, title: "Words" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "module_not_a_clone" } });
    expect(await fs.readdir(taken)).toEqual(["notes.txt"]);
    expect(await fs.readFile(path.join(taken, "notes.txt"), "utf8")).toBe("mine");
    expect(git.ops()).not.toContain("cloneFrom");
  });

  it("refuses to deploy a module in a monorepo modules folder, and runs no git there", async () => {
    const monorepo = await fs.mkdtemp(path.join(os.tmpdir(), "wafh-deploy-monorepo-"));
    cleanups.push(() => fs.rm(monorepo, { recursive: true, force: true }));
    const modules = path.join(monorepo, "modules");
    await fs.mkdir(path.join(modules, "waf-module-words"), { recursive: true });
    vi.stubEnv("WAF_MODULES_DIR", modules);
    const { client, endpoint, git, admin } = await setupWords({ checkout: { module: false } });
    await fillSettings(admin);
    // The product's files went into the monorepo's module, which was not made a repository.
    expect(await fs.readdir(path.join(modules, "waf-module-words"))).toContain("generated");
    const prepare = await client.post(`${endpoint}/deploy/clones`);
    expect(prepare.status).toBe(409);
    expect(await prepare.json()).toMatchObject({ error: { code: "deploy_monorepo_module" } });
    expect(git.calls.filter((call) => call.dir.startsWith(monorepo))).toEqual([]);
  });

  it("lets a project member read the context but not ask the remote or prepare clones", async () => {
    const { t, client, endpoint } = await setupWords();
    const member = await provisionUser(t.app, "deploy_reader");
    expect(
      (await client.post(`/api/projects/${PROJECT}/members`, { userId: "deploy_reader" })).status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    expect((await reader.get(`${endpoint}/deploy/context`)).status).toBe(200);
    expect((await reader.get(`${endpoint}/deploy/context?checkRemote=1`)).status).toBe(403);
    expect((await reader.post(`${endpoint}/deploy/clones`)).status).toBe(403);
  });
});
