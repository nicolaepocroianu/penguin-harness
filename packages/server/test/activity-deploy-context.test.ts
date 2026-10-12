/**
 * Whether a deploy could start, built over fake clones and a fake disk: the ref must be the
 * canonical one, the layout mainOnly, the settings complete and the module's repository
 * known; each clone must be there, clean, pushed and pointing at the right remote, with main
 * in it. The deploy branches are reported, not required. The remote is asked only on request.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDeployContext, type DeployContextInput } from "../src/activities/deploy-context.js";
import {
  activityDataBranchName,
  deployBranchName,
  remoteKey,
  sameRemote,
} from "../src/activities/deploy-git.js";
import {
  defaultDeploySettings,
  normalizeDeploySettings,
} from "../src/activities/deploy-settings.js";
import { WafLayout } from "../src/activities/waf-layout.js";
import { FakeClones, type FakeRepo } from "./fake-clones.js";

const HOME = path.resolve("/penguin-home");
const WAF = path.join(HOME, "waf");
const MODULE_REMOTE = "git@github.com:org/waf-module-words.git";
const DATA_REMOTE = "git@github.com:org/data.git";
const MEDIA_REMOTE = "git@github.com:org/media.git";

/** Clones that answer from a table of repositories by directory, recording every call. */
function fakeClones(
  repos: Record<string, FakeRepo & { noUpstream?: boolean }>,
  options: { missing?: boolean } = {},
) {
  const clones = new FakeClones();
  clones.gitMissing = options.missing === true;
  for (const [dir, repo] of Object.entries(repos))
    clones.add(dir, { ...repo, ...(repo.noUpstream ? { ahead: null } : {}) });
  return clones;
}

const CHECKOUT = new WafLayout(WAF);
const PATHS = {
  module: CHECKOUT.module("waf-module-words").root,
  activityData: CHECKOUT.repo("activityData"),
  media: CHECKOUT.repo("media"),
};
const REMOTES = { module: MODULE_REMOTE, activityData: DATA_REMOTE, media: MEDIA_REMOTE };

function completeSettings() {
  return normalizeDeploySettings(
    {
      qa: {
        jenkinsUrl: "https://jenkins.example.org",
        username: "robot",
        frameworkVersion: "4.2.1",
        activityBaseUrl: "https://qa.example.org",
      },
      git: { userName: "Deploy", userEmail: "deploy@example.org" },
    },
    defaultDeploySettings(),
  ).settings;
}

function input(overrides: Partial<DeployContextInput> = {}): DeployContextInput {
  return {
    home: HOME,
    wafRoot: WAF,
    remotes: REMOTES,
    productCode: "words",
    moduleFolder: "waf-module-words",
    canonical: true,
    layout: "mainOnly",
    settings: completeSettings(),
    secrets: { qaToken: "t" },
    checkRemote: false,
    ...overrides,
  };
}

/** All three clones on disk and healthy. */
function healthyRepos(): Record<string, FakeRepo & { noUpstream?: boolean }> {
  return {
    [PATHS.module]: { origin: MODULE_REMOTE, branches: ["main"] },
    [PATHS.activityData]: { origin: DATA_REMOTE, branches: ["main", "loom/words-activity-data"] },
    [PATHS.media]: { origin: MEDIA_REMOTE, sparse: ["loom/words"] },
  };
}

function disk(repos: Record<string, FakeRepo>) {
  return async (file: string) => Object.keys(repos).some((dir) => file === path.join(dir, ".git"));
}

describe("deploy context", () => {
  it("is ready when every check passes, and names Loom's branches", async () => {
    const repos = healthyRepos();
    const clones = fakeClones(repos);
    const context = await buildDeployContext(input(), { clones, exists: disk(repos) });
    expect(context.problems).toEqual([]);
    expect(context.ready).toBe(true);
    expect(context.branches).toEqual({
      deploy: "loom/words-deploy",
      activityData: "loom/words-activity-data",
    });
    expect(context.module).toMatchObject({ folder: "waf-module-words", remote: MODULE_REMOTE });
    expect(context.module.clone).toEqual({
      present: true,
      branch: "main",
      clean: true,
      ahead: 0,
      remoteUrlMatches: true,
    });
    // The deploy branch is not made yet: reported, not a problem.
    expect(context.branchState).toEqual({
      deploy: { local: false, remote: null },
      activityData: { local: true, remote: null },
    });
    // Without Check remote, nothing reaches the remote.
    expect(clones.ops()).not.toContain("remoteHasBranch");
    expect(context.remoteChecked).toBe(false);
  });

  it("refuses a ref that is not the canonical one", async () => {
    const repos = healthyRepos();
    const context = await buildDeployContext(input({ canonical: false }), {
      clones: fakeClones(repos),
      exists: disk(repos),
    });
    expect(context.ready).toBe(false);
    expect(context.problems).toEqual([{ code: "not_canonical" }]);
  });

  it("names an activity with no product, and a layout other than mainOnly", async () => {
    const context = await buildDeployContext(
      input({
        moduleFolder: null,
        remotes: { ...REMOTES, module: null },
        layout: "mainAndSide",
      }),
      { clones: fakeClones({}), exists: async () => false },
    );
    expect(context.problems).toEqual(
      expect.arrayContaining([
        { code: "no_module" },
        { code: "layout_unsupported", layout: "mainAndSide" },
      ]),
    );
    // No module, so no module clone is expected either.
    expect(context.problems).not.toContainEqual({ code: "clone_missing", repo: "module" });
    const none = await buildDeployContext(input({ layout: null }), {
      clones: fakeClones(healthyRepos()),
      exists: disk(healthyRepos()),
    });
    // A spec that names no layout is mainOnly, as preview and assembly treat it.
    expect(none.problems).toEqual([]);
    expect(none.ready).toBe(true);
  });

  it("names each missing setting by field", async () => {
    const repos = healthyRepos();
    const context = await buildDeployContext(
      input({ settings: defaultDeploySettings(), secrets: {} }),
      { clones: fakeClones(repos), exists: disk(repos) },
    );
    const fields = context.problems
      .filter((problem) => problem.code === "settings_missing")
      .map((problem) => (problem as { field: string }).field);
    expect(fields).toEqual(["qa.username", "qa.token"]);
  });

  it("names a WAF workspace that is not prepared, and looks at no clone", async () => {
    const clones = fakeClones({});
    const context = await buildDeployContext(input({ wafRoot: null }), {
      clones,
      exists: async () => false,
    });
    expect(context.problems).toEqual([{ code: "workspace_not_ready" }]);
    expect(context.ready).toBe(false);
    expect(clones.ops()).toEqual(["available"]);
  });

  it("refuses a module remote no clone may be made from", async () => {
    const repos = healthyRepos();
    for (const module of [
      "file:///srv/modules/words.git",
      "/srv/modules/words.git",
      "http://git.example.org/org/words.git",
      "https://user:secret@git.example.org/org/words.git",
    ]) {
      const context = await buildDeployContext(input({ remotes: { ...REMOTES, module } }), {
        clones: fakeClones(repos),
        exists: disk(repos),
      });
      expect(context.problems).toContainEqual({ code: "module_remote_invalid" });
      expect(context.ready).toBe(false);
      expect(context.module.remote).toBeNull();
    }
  });

  it("is not ready when git cannot say whether a clone is clean or pushed", async () => {
    const repos = healthyRepos();
    repos[PATHS.module]!.statusFails = true;
    repos[PATHS.activityData]!.noUpstream = true;
    repos[PATHS.media]!.branch = "some-other-branch";
    const context = await buildDeployContext(input(), {
      clones: fakeClones(repos),
      exists: disk(repos),
    });
    expect(context.ready).toBe(false);
    expect(context.problems).toEqual([
      { code: "clone_unknown", repo: "module", what: "status" },
      { code: "clone_unknown", repo: "activityData", what: "upstream" },
    ]);
    // Another checked-out branch is shown, not a problem: the deploy checks out main itself.
    expect(context.media.clone.branch).toBe("some-other-branch");
  });

  it("is not ready when the remote cannot be reached on Check remote", async () => {
    const repos = healthyRepos();
    repos[PATHS.activityData]!.unreachable = true;
    const context = await buildDeployContext(input({ checkRemote: true }), {
      clones: fakeClones(repos),
      exists: disk(repos),
    });
    expect(context.ready).toBe(false);
    expect(context.problems).toEqual([{ code: "remote_unreachable", repo: "activityData" }]);
  });

  it("names a media clone that does not check out this product's folder", async () => {
    const repos = healthyRepos();
    repos[PATHS.media]!.sparse = ["loom/other"];
    const context = await buildDeployContext(input(), {
      clones: fakeClones(repos),
      exists: disk(repos),
    });
    expect(context.ready).toBe(false);
    expect(context.problems).toEqual([{ code: "media_path_missing", path: "loom/words" }]);
    // A parent folder in the sparse set brings the product's in; so does no sparse set at all.
    repos[PATHS.media]!.sparse = ["loom"];
    const parent = await buildDeployContext(input(), {
      clones: fakeClones(repos),
      exists: disk(repos),
    });
    expect(parent.problems).toEqual([]);
    repos[PATHS.media]!.sparse = null;
    const whole = await buildDeployContext(input(), {
      clones: fakeClones(repos),
      exists: disk(repos),
    });
    expect(whole.problems).toEqual([]);
  });

  it("names each missing clone", async () => {
    const context = await buildDeployContext(input(), {
      clones: fakeClones({}),
      exists: async () => false,
    });
    expect(context.problems).toEqual([
      { code: "clone_missing", repo: "module" },
      { code: "clone_missing", repo: "activityData" },
      { code: "clone_missing", repo: "media" },
    ]);
    expect(context.media.clone.present).toBe(false);
  });

  it("names a dirty activity-data clone, one on the wrong remote, and missing main", async () => {
    const repos: Record<string, FakeRepo> = {
      [PATHS.module]: { origin: "git@github.com:someone/else.git", dirty: true },
      [PATHS.activityData]: { origin: DATA_REMOTE, dirty: true, branches: [] },
      [PATHS.media]: { origin: MEDIA_REMOTE, ahead: 2, dirty: true },
    };
    const context = await buildDeployContext(input(), {
      clones: fakeClones(repos),
      exists: disk(repos),
    });
    expect(context.problems).toEqual([
      { code: "clone_remote_mismatch", repo: "module" },
      { code: "clone_dirty", repo: "activityData" },
      { code: "branch_missing", repo: "activityData", branch: "main", where: "local" },
    ]);
  });

  it("names the activity-data clone ahead of its upstream, but not the authored clones", async () => {
    const repos = healthyRepos();
    repos[PATHS.activityData]!.ahead = 1;
    repos[PATHS.module]!.ahead = 3;
    repos[PATHS.media]!.ahead = 2;
    const context = await buildDeployContext(input(), {
      clones: fakeClones(repos),
      exists: disk(repos),
    });
    expect(context.problems).toEqual([{ code: "clone_ahead", repo: "activityData", count: 1 }]);
  });

  it("asks the remote about main and the deploy branches only when asked to", async () => {
    const repos = healthyRepos();
    repos[PATHS.media]!.remoteBranches = [];
    repos[PATHS.module]!.remoteBranches = ["main", "loom/words-deploy"];
    const clones = fakeClones(repos);
    const context = await buildDeployContext(input({ checkRemote: true }), {
      clones,
      exists: disk(repos),
    });
    expect(context.remoteChecked).toBe(true);
    expect(context.problems).toEqual([
      { code: "branch_missing", repo: "media", branch: "main", where: "remote" },
    ]);
    expect(context.branchState.deploy).toEqual({ local: false, remote: true });
    expect(context.branchState.activityData).toEqual({ local: true, remote: false });
  });

  it("says git is unavailable, and still says which clones are on disk", async () => {
    const repos = healthyRepos();
    delete repos[PATHS.media];
    const context = await buildDeployContext(input(), {
      clones: fakeClones(repos, { missing: true }),
      exists: disk(repos),
    });
    expect(context.problems).toEqual([
      { code: "git_unavailable" },
      { code: "clone_missing", repo: "media" },
    ]);
    expect(context.module.clone).toMatchObject({ present: true, clean: null });
  });
});

describe("deploy git helpers", () => {
  it("derives Loom's branch names", () => {
    expect(deployBranchName("waf-module-words")).toBe("loom/words-deploy");
    expect(activityDataBranchName("PC1")).toBe("loom/PC1-activity-data");
  });

  it("compares remotes across spellings", () => {
    expect(remoteKey("ssh://git@github.com/org/x.git")).toBe("github.com/org/x");
    expect(sameRemote("git@github.com:org/x.git", "https://github.com/ORG/x")).toBe(true);
    expect(sameRemote("git@github.com:org/x.git", "git@github.com:org/y.git")).toBe(false);
    expect(sameRemote("", "")).toBe(false);
  });
});
