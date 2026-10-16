/**
 * Deploy to QA through the routes: all ten stages from a fresh state, the edited configuration
 * exported (an archived ref left out), the activity deploy started with exactly its parameter
 * set, the QA address recorded, and a media file found nowhere failing the media stage by name.
 *
 * git, npm, Jenkins and the clock are fakes behind the deploy ports: nothing here reaches a
 * network, a real remote or a real program. The clones are the WAF checkout's: its
 * activity-data, media and module repositories are there already (its owner cloned the module,
 * and Penguin writes the product's files into it).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { JenkinsFetch } from "../src/activities/deploy-jenkins.js";
import type { DeployRunResponse, DeployStateResponse } from "../src/activities/deploy-types.js";
import { activitySpec } from "./activity-fixtures.js";
import { FakeClones } from "./fake-clones.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const PROJECT = "shipper-work";
const QA_TOKEN = "qa-secret-token";
const DATA_REMOTE = "git@github.com:org/data.git";
const MEDIA_REMOTE = "git@github.com:org/media.git";
const MODULE_REMOTE = "git@github.com:org/waf-module-words.git";

/**
 * The checkout's clones, answering from memory: the module's tags gain a newer release after
 * its first fetch, and the media repository holds `tracked`.
 */
function moduleRepos(clones: FakeClones, root: string, tracked: string[] = []) {
  clones.repo(path.join(root, "modules", "waf-module-words"))!.tags = [
    ["1.4.0"],
    ["1.4.0", "1.5.0"],
  ];
  clones.repo(path.join(root, "media"))!.inHead = tracked;
  for (const dir of ["modules/waf-module-words", "waf-activity-data", "media"])
    clones.repo(path.join(root, dir))!.head = "c0ffee"; // The module's commit holds the package.json the release writes its name and version into.
  clones.repo(path.join(root, "modules", "waf-module-words"))!.files = {
    c0ffee: { "package.json": JSON.stringify({ name: "waf-module-words", version: "1.0.0" }) },
  };
}

/** Jenkins: each job has no build until it is started, then one that succeeded. */
function fakeJenkins() {
  const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
  const started = new Map<string, URLSearchParams>();
  const respond = (status: number, body: unknown = "") => ({
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const jobOf = (url: string) => decodeURIComponent(/\/job\/([^/]+)\//.exec(url)?.[1] ?? "");
  const request: JenkinsFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      ...(init.body ? { body: init.body } : {}),
      ...(init.headers.Authorization ? { auth: init.headers.Authorization } : {}),
    });
    if (url.endsWith("/buildWithParameters")) {
      started.set(jobOf(url), new URLSearchParams(init.body ?? ""));
      return respond(201);
    }
    if (url.includes("/queue/api/json")) return respond(200, { items: [] });
    const job = jobOf(url);
    const params = started.get(job);
    return respond(200, {
      builds: params
        ? [
            {
              number: 9,
              url: `job/${encodeURIComponent(job)}/9/`,
              building: false,
              result: "SUCCESS",
              actions: [{ parameters: [...params].map(([name, value]) => ({ name, value })) }],
            },
          ]
        : [],
    });
  };
  return { calls, request };
}

describe("activity deploy to QA", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(tracked: string[]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-qa-waf-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "modules"), { recursive: true });
    const clones = new FakeClones();
    // The checkout's shared clones; its media's sparse set has this product's folder.
    for (const [folder, remote] of [
      ["waf-activity-data", DATA_REMOTE],
      ["media", MEDIA_REMOTE],
      ["modules/waf-module-words", MODULE_REMOTE],
    ] as const)
      await clones.onDisk(path.join(root, folder), {
        origin: remote,
        ...(folder === "media" ? { sparse: ["loom/words"] } : {}),
      });
    await fs.writeFile(
      path.join(root, "modules", "waf-module-words", "package.json"),
      JSON.stringify({ name: "waf-module-words", version: "1.0.0" }),
    );
    vi.stubEnv("WAF_ROOT_DIR", root);

    moduleRepos(clones, root, tracked);
    const git = clones;
    const jenkins = fakeJenkins();
    const t = await createTestApp({
      deployPorts: {
        clones,
        jenkinsFetch: jenkins.request,
        runProcess: async () => ({ code: 0, tail: "" }),
        now: () => Date.UTC(2026, 8, 28, 9, 0, 0),
        sleep: async () => {},
      },
      wafWorkspacePorts: { clones },
    });
    cleanups.push(async () => {
      await t.cleanup();
    });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const owner = await provisionUser(t.app, "shipper");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const create = async (refNum: number) =>
      (await (
        await client.post(base, { productCode: "words", refNum, title: `Words ${refNum}` })
      ).json()) as ActivityDetail;
    const activity = await create(1);
    const applied = await client.post(`${base}/${activity.id}/apply-generated-spec`, {
      expectedRevision: activity.draft.contentRevision,
      spec: { ...activitySpec, title: "Words", moduleFolder: "waf-module-words" },
    });
    expect(applied.status).toBe(200);
    const { contentRevision } = (await applied.json()) as { contentRevision: string };
    // An author's edit of the configuration: what the export must write.
    const edited = await client.put(`${base}/${activity.id}/module-documents/configuration`, {
      value: { words: { "en-US": { greeting: "{{MEDIA}}/loom/words/hello.mp3", edited: true } } },
      expectedRevision: contentRevision,
    });
    expect(edited.status).toBe(200);
    // A second ref, archived: it is not deployed.
    const archived = await create(2);
    expect((await client.delete(`${base}/${archived.id}`)).status).toBe(204);
    expect(
      (
        await admin.put("/api/admin/activity-deploy/settings", {
          qa: {
            jenkinsUrl: "https://jenkins.example.org",
            username: "robot",
            token: QA_TOKEN,
            frameworkVersion: "4.2.1",
            activityBaseUrl: "https://qa.example.org/play",
          },
          git: { userName: "Deploy", userEmail: "deploy@example.org" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.put("/api/admin/waf-workspace/settings", {
          repos: { activityData: { remote: DATA_REMOTE }, media: { remote: MEDIA_REMOTE } },
          moduleRemote: "git@github.com:org/{module}.git",
        })
      ).status,
    ).toBe(200);
    const endpoint = `${base}/${activity.id}`;
    expect((await client.post(`${endpoint}/deploy/clones`)).status).toBe(200);
    const state = async () => {
      const res = await client.get(`${endpoint}/deploy`);
      expect(res.status).toBe(200);
      return (await res.json()) as DeployStateResponse;
    };
    return { t, root, git, jenkins, client, endpoint, state };
  }

  it("deploys to QA from a fresh state: ten stages, the edited data, the deploy job and the QA address", async () => {
    const { root, git, jenkins, client, endpoint, state } = await setup(["loom/words/hello.mp3"]);
    const res = await client.post(`${endpoint}/deploy`, { stage: "qa" });
    expect(res.status).toBe(202);
    const { run } = (await res.json()) as DeployRunResponse;
    expect(run.selection).toBe("qa");
    expect(run.stages).toHaveLength(10);
    await vi.waitFor(async () => expect((await state()).run?.status).not.toBe("running"));
    const found = await state();
    expect(found.run?.stages.filter((stage) => stage.error)).toEqual([]);
    expect(found.run?.status).toBe("succeeded");
    expect(found.stages.map((stage) => stage.status)).toEqual(Array(10).fill("done"));
    expect(found.run!.metadata).toMatchObject({
      resolvedModuleVersion: "1.5.0",
      deployedRefNums: [1],
      qaActivityUrl:
        "https://qa.example.org/play?productCode=words&refNum=1&frameworkVersion=4.2.1",
      qaDeployedAt: "2026-09-28T09:00:00.000Z",
      activityDeployUrl: "https://jenkins.example.org/job/WAF%20Activity%20Deploy/9/",
    });
    expect(found.run!.metadata.contentRevision).toBeTruthy();

    const data = path.join(root, "waf-activity-data");
    const configuration = JSON.parse(
      await fs.readFile(path.join(data, "data/configurations/loom/words-1.json"), "utf8"),
    );
    expect(configuration).toEqual({
      words: { "en-US": { greeting: "{{MEDIA}}/loom/words/hello.mp3", edited: true } },
    });
    await expect(
      fs.stat(path.join(data, "data/configurations/loom/words-2.json")),
    ).rejects.toThrow();
    const template = JSON.parse(
      await fs.readFile(path.join(data, "data/templates/loom/words.json"), "utf8"),
    );
    expect(template.sources).toEqual([
      { description: "Ref 1", configurations: ["loom/words-1.json"], refNums: [1] },
    ]);
    expect(template.layout.compartments).toEqual({
      main: { module: "words@^1.5.0", theme: "park" },
      navBar: { module: "navbar@^3.0.0", theme: "park" },
    });
    expect(await fs.readFile(path.join(data, "deployLists/loom-words.txt"), "utf8")).toBe(
      "data/templates/loom/words.json\n",
    );

    const deploy = jenkins.calls.find(
      (call) => call.url.endsWith("/buildWithParameters") && call.url.includes("Activity"),
    )!;
    expect(Object.fromEntries(new URLSearchParams(deploy.body))).toEqual({
      branch: "loom/words-activity-data",
      framework_version: "4.2.1",
      tier: "qa",
      deploy_environment: "loom",
      add_activities_to_catalog: "false",
      template_names: "words",
    });
    const pushes = git.calls.filter((call) => call.op === "push").map((call) => call.args);
    expect(pushes).toContainEqual(["loom/words-activity-data", { track: true }]);
    // The module's stages ran in the checkout's clone of it, which nothing cloned again.
    const module = path.join(root, "modules", "waf-module-words");
    expect(git.ops()).not.toContain("cloneFrom");
    expect(git.ops(module)).toContain("push");
  });

  it("fails the media stage naming a file found nowhere, and runs nothing after it", async () => {
    const { client, endpoint, state, jenkins } = await setup([]);
    expect((await client.post(`${endpoint}/deploy`, { stage: "qa" })).status).toBe(202);
    await vi.waitFor(async () => expect((await state()).run?.status).toBe("failed"));
    const found = await state();
    const media = found.run!.stages.find((stage) => stage.stage === "verify_media_assets")!;
    expect(media).toMatchObject({
      status: "failed",
      error: { code: "media_missing", paths: ["media/loom/words/hello.mp3"], count: 1 },
    });
    expect(found.stages.find((stage) => stage.stage === "publish_activity_data")).toMatchObject({
      status: "pending",
      blocker: { code: "previous_stage", stage: "verify_media_assets" },
    });
    expect(
      jenkins.calls.some(
        (call) => call.url.endsWith("/buildWithParameters") && call.url.includes("Activity"),
      ),
    ).toBe(false);
  });
});
