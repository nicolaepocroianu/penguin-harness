/**
 * A clone, against real repositories: a bare origin in a temp folder, clones of it reached by
 * file URL, and real git. What it proves: the state a clone reports; putting a clone on a
 * branch as origin has it, carrying work, discarding it, or refusing a branch that diverged
 * with the work put back as it was, even when stopped; a stash that cannot be put back, and
 * counting it; staging in batches, committing, pushing with a lease; what changed, a branch's
 * commit, whether two commits hold the same files; tags and what they hold; exporting a
 * commit's files; a partial clone's sparse folders, and its LFS files uploaded before a push;
 * and the deploy log a clone writes.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CloneDiverged,
  CloneError,
  CloneStopped,
  gitClones,
  type Clone,
} from "../src/activities/clone.js";
import { spawnGit, type DeployGit } from "../src/activities/deploy-git.js";

const clones = gitClones();

/** Whether git-lfs is installed here: the CI runners have it; a host without it skips its test. */
const HAS_LFS = spawnSync("git", ["lfs", "version"]).status === 0;
const WHO = { name: "Deploy Bot", email: "deploy@example.org" };
const dirs: string[] = [];

// Newer git starts background maintenance after a commit, which can still be writing packs
// into a test's repository while the test removes it (ENOTEMPTY on the CI runners). Every
// git here, the test's and the clones', reads this environment.
beforeAll(() => {
  vi.stubEnv("GIT_CONFIG_COUNT", "1");
  vi.stubEnv("GIT_CONFIG_KEY_0", "maintenance.auto");
  vi.stubEnv("GIT_CONFIG_VALUE_0", "false");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

/** Runs git in `cwd` for the test's own setup and checks; throws when it fails. */
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", `user.name=${WHO.name}`, "-c", `user.email=${WHO.email}`, ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

async function write(dir: string, file: string, content: string) {
  await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await fs.writeFile(path.join(dir, file), content);
}

const read = (dir: string, file: string) => fs.readFile(path.join(dir, file), "utf8");

/**
 * A bare origin whose main has `files`, reached by file URL, and a folder to clone it into.
 * `push` commits more files to origin's `branch` from a clone of its own.
 */
async function origin(files: Record<string, string> = { "README.md": "hello\n" }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-clone-"));
  dirs.push(root);
  const bare = path.join(root, "origin.git");
  git(root, "init", "--bare", "--initial-branch=main", bare);
  const url = pathToFileURL(bare).href;
  const seed = path.join(root, "seed");
  git(root, "clone", url, seed);
  git(seed, "checkout", "-B", "main");
  for (const [file, content] of Object.entries(files)) await write(seed, file, content);
  git(seed, "add", "--all");
  git(seed, "commit", "-m", "seed");
  git(seed, "push", "-u", "origin", "main");
  const push = async (changes: Record<string, string>, branch = "main") => {
    git(seed, "fetch", "origin");
    git(seed, "checkout", "-B", branch, `origin/${branch}`);
    for (const [file, content] of Object.entries(changes)) await write(seed, file, content);
    git(seed, "add", "--all");
    git(seed, "commit", "-m", `change ${branch}`);
    git(seed, "push", "origin", branch);
  };
  const branchOff = (branch: string) => {
    git(seed, "fetch", "origin");
    git(seed, "push", "origin", `origin/main:refs/heads/${branch}`);
  };
  const cloneOf = async (name: string, ...flags: string[]) => {
    const dir = path.join(root, name);
    git(root, "clone", ...flags, url, dir);
    return dir;
  };
  return { root, url, push, branchOff, cloneOf };
}

describe("what a clone looks like", () => {
  it("names its branch, whether it is clean, how far it is ahead, and origin", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    const clone = clones.open(dir);
    expect(await clone.state()).toEqual({
      branch: "main",
      clean: true,
      ahead: 0,
      origin: remote.url,
    });
    await write(dir, "new.txt", "work");
    expect((await clone.state()).clean).toBe(false);
    await clone.stage();
    expect(await clone.commitStaged(WHO, "work")).toMatch(/^[0-9a-f]{40}$/);
    expect(await clone.state()).toMatchObject({ clean: true, ahead: 1 });
    git(dir, "checkout", "--detach");
    expect((await clone.state()).branch).toBeNull();
  }, 30_000);

  it("knows which branches it and origin have", async () => {
    const remote = await origin();
    remote.branchOff("v2");
    const dir = await remote.cloneOf("clone");
    const clone = clones.open(dir);
    expect(await clone.hasBranch("main")).toBe(true);
    expect(await clone.hasBranch("v2")).toBe(false);
    expect(await clone.remoteHasBranch("v2")).toBe(true);
    expect(await clone.remoteHasBranch("v3")).toBe(false);
    expect(await clones.remoteExists(remote.url, remote.root)).toBe(true);
    const nowhere = pathToFileURL(path.join(remote.root, "missing.git")).href;
    expect(await clones.remoteExists(nowhere, remote.root)).toBe(false);
  }, 30_000);

  it("answers whether HEAD has a file, and whether one changed since", async () => {
    const remote = await origin({ "a/one.txt": "1" });
    const dir = await remote.cloneOf("clone");
    const clone = clones.open(dir);
    expect(await clone.inHead("a/one.txt")).toBe(true);
    expect(await clone.inHead("a/two.txt")).toBe(false);
    expect(await clone.changed("a/one.txt")).toBe(false);
    await write(dir, "a/one.txt", "changed");
    await write(dir, "a/two.txt", "new");
    expect(await clone.changed("a/one.txt")).toBe(true);
    expect(await clone.changed("a/two.txt")).toBe(true);
    // A file git cannot report on counts as changed, so it is published rather than left out.
    expect(await clone.changed("../outside.txt")).toBe(true);
  }, 30_000);
});

describe("putting a clone on a branch as origin has it", () => {
  it("carries the work in its working tree onto main brought up to origin", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    await remote.push({ "from-origin.txt": "theirs" });
    await write(dir, "authored.txt", "mine");
    const clone = clones.open(dir);
    await clone.fetch();
    expect(await clone.onBranchFromOrigin("main", { work: "carry" })).toEqual({
      workInPlace: false,
    });
    expect(await read(dir, "from-origin.txt")).toBe("theirs");
    expect(await read(dir, "authored.txt")).toBe("mine");
    expect(git(dir, "rev-parse", "HEAD")).toBe(git(dir, "rev-parse", "origin/main"));
  }, 30_000);

  const status = (dir: string) => git(dir, "status", "--porcelain", "--untracked-files=all");

  /**
   * A clone whose main has a commit origin's lacks while origin's has one it lacks, holding
   * uncommitted work of every kind on `on`: a changed file, a staged new one, an untracked one.
   */
  async function divergedWithWork(on = "main") {
    const remote = await origin({ "README.md": "hello", "tracked.txt": "base" });
    const dir = await remote.cloneOf("clone");
    await write(dir, "local.txt", "committed here");
    git(dir, "add", "--all");
    git(dir, "commit", "-m", "local");
    await remote.push({ "from-origin.txt": "theirs" });
    if (on !== "main") git(dir, "checkout", "-b", on);
    await write(dir, "tracked.txt", "changed");
    await write(dir, "staged.txt", "staged");
    git(dir, "add", "staged.txt");
    await write(dir, "authored.txt", "mine");
    return { dir, head: git(dir, "rev-parse", "HEAD"), status: status(dir) };
  }

  it("refuses a main that has diverged from origin's, putting the work back as it was", async () => {
    const { dir, head, status: before } = await divergedWithWork();
    expect(before).toBe("A  staged.txt\n M tracked.txt\n?? authored.txt");
    const clone = clones.open(dir);
    await clone.fetch();
    const failure = await clone.onBranchFromOrigin("main", { work: "carry" }).catch((e) => e);
    expect(failure).toBeInstanceOf(CloneDiverged);
    expect((failure as CloneDiverged).command).toBe("git merge --ff-only origin/main");
    // Nothing is left in the stash: the work is where it was, staged as it was.
    expect(git(dir, "stash", "list")).toBe("");
    expect(await clone.stashedWork()).toBe(0);
    expect(git(dir, "branch", "--show-current")).toBe("main");
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
    expect(status(dir)).toBe(before);
    expect(await read(dir, "authored.txt")).toBe("mine");
  }, 30_000);

  it("goes back to the branch the clone was on, its work as it was, when main has diverged", async () => {
    const { dir, head, status: before } = await divergedWithWork("loom/words-deploy");
    const clone = clones.open(dir);
    await clone.fetch();
    const failure = await clone.onBranchFromOrigin("main", { work: "carry" }).catch((e) => e);
    expect(failure).toBeInstanceOf(CloneDiverged);
    expect(git(dir, "branch", "--show-current")).toBe("loom/words-deploy");
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
    expect(status(dir)).toBe(before);
    expect(git(dir, "stash", "list")).toBe("");
  }, 30_000);

  it.each([
    ["the work is set aside", "stash push"],
    ["main is brought up to origin", "merge --ff-only"],
  ])(
    "puts the work back even when the deploy is stopped as %s",
    async (_, stoppedAt) => {
      const remote = await origin();
      const dir = await remote.cloneOf("clone");
      await remote.push({ "from-origin.txt": "theirs" });
      git(dir, "checkout", "-b", "loom/words-deploy");
      await write(dir, "authored.txt", "mine");
      const controller = new AbortController();
      // Stopped as that command finishes: every command after it is refused but the ones that
      // put the work back.
      const stopping: DeployGit = {
        async run(args, cwd, options) {
          const result = await spawnGit.run(args, cwd, options);
          if (args.join(" ").startsWith(stoppedAt)) controller.abort();
          return result;
        },
      };
      const clone = gitClones(stopping).open(dir, { signal: controller.signal });
      await clone.fetch();
      const failure = await clone.onBranchFromOrigin("main", { work: "carry" }).catch((e) => e);
      expect(failure).toBeInstanceOf(CloneStopped);
      expect(git(dir, "branch", "--show-current")).toBe("loom/words-deploy");
      expect(status(dir)).toBe("?? authored.txt");
      expect(git(dir, "stash", "list")).toBe("");
    },
    30_000,
  );

  it("fails naming git's words when the carried work conflicts with origin's, which the stash keeps and counts", async () => {
    const remote = await origin({ "shared.txt": "base\n" });
    const dir = await remote.cloneOf("clone");
    await remote.push({ "shared.txt": "theirs\n", "added.txt": "theirs" });
    await write(dir, "shared.txt", "mine\n");
    await write(dir, "added.txt", "mine");
    const clone = clones.open(dir);
    await clone.fetch();
    const failure = await clone.onBranchFromOrigin("main", { work: "carry" }).catch((e) => e);
    expect(failure).toBeInstanceOf(CloneError);
    expect((failure as CloneError).command).toBe("git stash pop");
    expect(git(dir, "stash", "list")).toBe(
      "stash@{0}: On main: penguin-harness deploy: work set aside to bring main up to origin",
    );
    expect(await clone.stashedWork()).toBe(1);
  }, 30_000);

  it("counts the work deploys left in the stash, as earlier versions named it too, and no other", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    const clone = clones.open(dir);
    expect(await clone.stashedWork()).toBe(0);
    for (const [file, message] of [
      ["one.txt", "penguin-harness deploy"],
      ["two.txt", "my own notes about penguin-harness deploy"],
      ["three.txt", "penguin-harness deployment"],
    ] as const) {
      await write(dir, file, "work");
      git(dir, "stash", "push", "--include-untracked", "-m", message);
    }
    await write(dir, "four.txt", "work");
    git(dir, "stash", "push", "--include-untracked");
    expect(await clone.stashedWork()).toBe(1);
  }, 30_000);

  it("keeps a new repository's work in place, on main as origin has it", async () => {
    const remote = await origin({ "README.md": "origin's", "docs/setup.md": "steps" });
    const dir = path.join(remote.root, "new-module");
    await fs.mkdir(dir);
    await clones.create(dir, remote.url);
    await write(dir, "authored.js", "export {};\n");
    const clone = clones.open(dir);
    await clone.fetch();
    expect(await clone.onBranchFromOrigin("main", { work: "carry" })).toEqual({
      workInPlace: true,
    });
    // Origin's files are there, and only the module's own work is a change.
    expect(await read(dir, "docs/setup.md")).toBe("steps");
    expect(git(dir, "status", "--porcelain")).toBe("?? authored.js");
    expect(git(dir, "rev-parse", "HEAD")).toBe(git(dir, "rev-parse", "origin/main"));
  }, 30_000);

  it("starts main where a new repository is when origin has none", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-clone-"));
    dirs.push(root);
    const bare = path.join(root, "empty.git");
    git(root, "init", "--bare", "--initial-branch=main", bare);
    const dir = path.join(root, "new-module");
    await fs.mkdir(dir);
    await clones.create(dir, pathToFileURL(bare).href);
    await write(dir, "authored.js", "export {};\n");
    const clone = clones.open(dir);
    await clone.fetch();
    expect(await clone.onBranchFromOrigin("main", { work: "carry" })).toEqual({
      workInPlace: true,
    });
    await clone.stage();
    expect(await clone.commitStaged(WHO, "first")).not.toBeNull();
    expect(git(dir, "branch", "--show-current")).toBe("main");
    await clone.push("main");
    expect(await clone.remoteHasBranch("main")).toBe(true);
  }, 30_000);

  it("discards what the deploy's own clone has, on a branch from origin's main or its own", async () => {
    const remote = await origin({ "data.json": "{}" });
    const dir = await remote.cloneOf("clone");
    await write(dir, "data.json", "half written");
    await write(dir, "stray/left.json", "{}");
    const clone = clones.open(dir);
    await clone.onBranchFromOrigin("loom/pc-activity-data", { work: "discard", from: "main" });
    expect(git(dir, "branch", "--show-current")).toBe("loom/pc-activity-data");
    expect(await read(dir, "data.json")).toBe("{}");
    await expect(fs.stat(path.join(dir, "stray"))).rejects.toThrow();
    // Once origin has the branch, it is made as origin has it.
    await remote.push({ "data.json": '{"deployed":true}' }, "main");
    remote.branchOff("loom/pc-activity-data");
    await clone.onBranchFromOrigin("loom/pc-activity-data", { work: "discard", from: "main" });
    expect(await read(dir, "data.json")).toBe('{"deployed":true}');
  }, 30_000);

  it("switches a single-branch clone to a branch origin has, fast-forwarded", async () => {
    const remote = await origin();
    remote.branchOff("v2");
    await remote.push({ "v2.txt": "two" }, "v2");
    const dir = await remote.cloneOf("clone", "--branch", "main", "--single-branch");
    await clones.open(dir).onBranchFromOrigin("v2", { work: "clean" });
    expect(git(dir, "branch", "--show-current")).toBe("v2");
    expect(await read(dir, "v2.txt")).toBe("two");
  }, 30_000);

  it("goes back to the branch it was on when the one asked for has diverged from origin's", async () => {
    const remote = await origin();
    remote.branchOff("v2");
    const dir = await remote.cloneOf("clone");
    git(dir, "checkout", "-b", "v2", "origin/v2");
    await write(dir, "local.txt", "here");
    git(dir, "add", "--all");
    git(dir, "commit", "-m", "local");
    git(dir, "checkout", "main");
    await remote.push({ "v2.txt": "there" }, "v2");
    const failure = await clones
      .open(dir)
      .onBranchFromOrigin("v2", { work: "clean" })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(CloneDiverged);
    expect(git(dir, "branch", "--show-current")).toBe("main");
  }, 30_000);
});

describe("committing and publishing", () => {
  it("stages hundreds of files in batches a command line holds, and commits only when something is staged", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    const files = Array.from(
      { length: 250 },
      (_, i) =>
        `res/images/scene-${String(i).padStart(4, "0")}/a-picture-with-a-long-enough-name.txt`,
    );
    for (const file of files) await write(dir, file, file);
    await write(dir, "not-staged.txt", "left");
    const clone = clones.open(dir);
    await clone.stage(files);
    const staged = git(dir, "diff", "--cached", "--name-only").split("\n");
    expect(staged).toHaveLength(files.length);
    expect(staged).not.toContain("not-staged.txt");
    expect(await clone.commitStaged(WHO, "files")).toBe(git(dir, "rev-parse", "HEAD"));
    expect(git(dir, "log", "-1", "--format=%an <%ae>")).toBe("Deploy Bot <deploy@example.org>");
    expect(await clone.commitStaged(WHO, "nothing")).toBeNull();
  }, 120_000);

  it("pushes a branch with a lease, and refuses to overwrite what someone else pushed", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    const clone = clones.open(dir);
    await clone.branchFrom("loom/words-deploy", "main");
    await write(dir, "built.txt", "one");
    await clone.stage();
    await clone.commitStaged(WHO, "one");
    await clone.push("loom/words-deploy", { lease: true, track: true });
    expect(await clone.remoteHasBranch("loom/words-deploy")).toBe(true);
    // Someone else pushes the branch; this clone has not seen it.
    await remote.push({ "theirs.txt": "two" }, "loom/words-deploy");
    await write(dir, "built.txt", "three");
    await clone.stage();
    await clone.commitStaged(WHO, "three");
    const refused = await clone
      .push("loom/words-deploy", { lease: true, track: true })
      .catch((e) => e);
    expect(refused).toBeInstanceOf(CloneError);
    expect((refused as CloneError).command).toBe(
      "git push --force-with-lease -u origin loom/words-deploy",
    );
    expect((refused as CloneError).reason).toMatch(/stale info|rejected/);
  }, 60_000);

  it("lists every path changed since HEAD: a changed file, a moved one, a new folder", async () => {
    const remote = await origin({ "a.txt": "1", "r.txt": "r" });
    const dir = await remote.cloneOf("clone");
    const clone = clones.open(dir);
    expect(await clone.changes()).toEqual([]);
    await write(dir, "a.txt", "2");
    await write(dir, "new folder/b.txt", "b");
    git(dir, "mv", "r.txt", "moved.txt");
    expect((await clone.changes()).sort()).toEqual(["a.txt", "moved.txt", "new folder/"]);
  }, 30_000);

  it("names a branch's commit, compares two commits' files, and says whether a tag holds a commit or its files", async () => {
    const remote = await origin({ "a.txt": "1" });
    const dir = await remote.cloneOf("clone");
    const clone = clones.open(dir);
    const base = await clone.commitOf("main");
    expect(base).toBe(git(dir, "rev-parse", "HEAD"));
    await clone.branchFrom("loom/words-deploy", "main");
    await write(dir, "a.txt", "2");
    await clone.stage(["a.txt"]);
    const first = (await clone.commitStaged(WHO, "first"))!;
    // The same files committed anew from main, as a deploy run again does.
    await clone.branchFrom("loom/words-deploy", "main");
    await write(dir, "a.txt", "2");
    await clone.stage(["a.txt"]);
    const again = (await clone.commitStaged(WHO, "again"))!;
    expect(again).not.toBe(first);
    expect(await clone.commitOf("loom/words-deploy")).toBe(again);
    expect(await clone.sameContent(first, again)).toBe(true);
    expect(await clone.sameContent(base, again)).toBe(false);
    expect(await clone.sameContent("0".repeat(40), again)).toBe(false);
    // A build tags a commit it made on top of the one it built, or that one itself.
    await write(dir, "package.json", '{"version":"1.1.0"}');
    await clone.stage(["package.json"]);
    const bumped = (await clone.commitStaged(WHO, "1.1.0"))!;
    git(dir, "tag", "-a", "v1.1.0", "-m", "release", bumped);
    git(dir, "tag", "1.0.0", base);
    expect(await clone.tagHolds("v1.1.0", again)).toBe(true);
    expect(await clone.tagHolds("v1.1.0", bumped)).toBe(true);
    expect(await clone.tagHolds("v1.1.0", first)).toBe(false);
    expect(await clone.tagHolds("1.0.0", again)).toBe(false);
    await expect(clone.tagHolds("2.0.0", again)).rejects.toBeInstanceOf(CloneError);
    // What a tag has otherwise than a commit, a file it adds aside, and what a file holds.
    expect(await clone.tagDiffers("v1.1.0", first)).toEqual([]);
    expect(await clone.tagDiffers("v1.1.0", base)).toEqual(["a.txt"]);
    expect(await clone.tagDiffers("1.0.0", bumped)).toEqual(["a.txt", "package.json"]);
    await expect(clone.tagDiffers("2.0.0", again)).rejects.toBeInstanceOf(CloneError);
    expect(await clone.fileAt({ tag: "v1.1.0" }, "package.json")).toBe('{"version":"1.1.0"}');
    expect(await clone.fileAt({ commit: first }, "a.txt")).toBe("2");
    expect(await clone.fileAt({ commit: base }, "package.json")).toBeNull();
    expect(await clone.fileAt({ tag: "2.0.0" }, "a.txt")).toBeNull();
  }, 30_000);

  it("fetches origin's tags", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    const tagger = await remote.cloneOf("tagger");
    git(tagger, "tag", "1.0.0");
    git(tagger, "tag", "v1.2.0");
    git(tagger, "push", "origin", "--tags");
    const tags = await clones.open(dir).fetchTags();
    expect(tags).toEqual(expect.arrayContaining(["1.0.0", "v1.2.0"]));
  }, 30_000);

  it("exports a commit's files, and nothing of the repository, leaving the clone as it was", async () => {
    const remote = await origin({ "package.json": "{}", "src/index.js": "export {};" });
    const dir = await remote.cloneOf("clone");
    // A link in the commit, made without asking the file system for one.
    await write(remote.root, "target", "../..");
    const blob = git(dir, "hash-object", "-w", "--no-filters", path.join(remote.root, "target"));
    git(dir, "update-index", "--add", "--cacheinfo", `120000,${blob},link`);
    git(dir, "commit", "-m", "link");
    const commit = git(dir, "rev-parse", "HEAD");
    // Work in the clone's index and working tree, which the export must not touch.
    await write(dir, "src/index.js", "export const changed = 1;");
    git(dir, "add", "src/index.js");
    await write(dir, "loose.txt", "not committed");
    const out = path.join(remote.root, "export", "words");
    await fs.mkdir(out, { recursive: true });
    // What an export cut short left of its index does not stop the next.
    await write(remote.root, "export/words.index.lock", "");
    await clones.open(dir).exportTo(commit, out);
    expect((await fs.readdir(out)).sort()).toEqual(["link", "package.json", "src"]);
    expect(await read(out, "src/index.js")).toBe("export {};");
    // A link arrives as a file naming its target, so nothing written through it leaves the folder.
    expect((await fs.lstat(path.join(out, "link"))).isFile()).toBe(true);
    expect(await read(out, "link")).toBe("../..");
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("src/index.js");
    expect(await read(dir, "src/index.js")).toBe("export const changed = 1;");
    // The export's own index is gone.
    expect(await fs.readdir(path.dirname(out))).toEqual(["words"]);
  }, 30_000);
});

describe("a partial clone's sparse folders", () => {
  it("checks out only the folders it includes, adding one once", async () => {
    const remote = await origin({
      "loom/words/a.mp3": "a",
      "loom/other/b.mp3": "b",
      "README.md": "media",
    });
    const dir = path.join(remote.root, "media");
    await clones.cloneFrom(remote.url, dir, { branch: "main", partial: true });
    const clone = clones.open(dir);
    expect(await clone.includes("loom/words")).toBe(false);
    await clone.include(["loom/words"]);
    expect(await read(dir, "loom/words/a.mp3")).toBe("a");
    await expect(fs.stat(path.join(dir, "loom/other"))).rejects.toThrow();
    expect(await clone.includes("loom/words")).toBe(true);
    expect(await clone.includes("loom/words/scene-1")).toBe(true);
    const listed = git(dir, "sparse-checkout", "list");
    await clone.include(["loom/words", "loom/words/scene-1"]);
    expect(git(dir, "sparse-checkout", "list")).toBe(listed);
    // A clone that is not sparse checks out every folder.
    const full = await remote.cloneOf("full");
    expect(await clones.open(full).includes("loom/other")).toBe(true);
  }, 60_000);

  it.skipIf(!HAS_LFS)(
    "uploads a branch's LFS files before pushing it, from a clone git-lfs installed no hook in",
    async () => {
      // git-lfs's filters as `git lfs install` sets them, for every git here: no hook anywhere.
      vi.stubEnv("GIT_CONFIG_COUNT", "4");
      vi.stubEnv("GIT_CONFIG_KEY_1", "filter.lfs.process");
      vi.stubEnv("GIT_CONFIG_VALUE_1", "git-lfs filter-process");
      vi.stubEnv("GIT_CONFIG_KEY_2", "filter.lfs.required");
      vi.stubEnv("GIT_CONFIG_VALUE_2", "true");
      vi.stubEnv("GIT_CONFIG_KEY_3", "filter.lfs.clean");
      vi.stubEnv("GIT_CONFIG_VALUE_3", "git-lfs clean -- %f");
      try {
        const remote = await origin({
          ".gitattributes": "*.bin filter=lfs diff=lfs merge=lfs -text\n",
          "README.md": "media\n",
        });
        const asked: string[][] = [];
        const noting: DeployGit = {
          run: (args, cwd, opts) => {
            asked.push(args);
            return spawnGit.run(args, cwd, opts);
          },
        };
        const dir = path.join(remote.root, "media");
        await gitClones(noting).cloneFrom(remote.url, dir, { branch: "main" });
        await expect(fs.stat(path.join(dir, ".git", "hooks", "pre-push"))).rejects.toThrow();
        const content = "an LFS file's bytes\n";
        await write(dir, "loom/words/a.bin", content);
        const clone = gitClones(noting).open(dir);
        await clone.stage();
        await clone.commitStaged(WHO, "media");
        asked.length = 0;
        await clone.push("main");
        expect(asked.filter((args) => args[0] !== "grep").map((args) => args.slice(0, 2))).toEqual([
          ["lfs", "push"],
          ["push", "origin"],
        ]);
        // The file itself reached origin's LFS store, not only its pointer.
        const oid = createHash("sha256").update(content).digest("hex");
        const stored = path.join(remote.root, "origin.git", "lfs", "objects", oid.slice(0, 2));
        expect(await fs.readFile(path.join(stored, oid.slice(2, 4), oid), "utf8")).toBe(content);
        // A branch that routes nothing through LFS is pushed alone.
        const plain = await remote.cloneOf("plain");
        await write(plain, ".gitattributes", "");
        git(plain, "commit", "-am", "no LFS");
        asked.length = 0;
        await gitClones(noting).open(plain).push("main");
        expect(asked.filter((args) => args[0] === "lfs")).toEqual([]);
      } finally {
        vi.stubEnv("GIT_CONFIG_COUNT", "1");
      }
    },
    60_000,
  );
});

describe("speaking for a deploy", () => {
  it("writes each command and what git said to the log, but not what it only asked", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    const lines: string[] = [];
    const clone: Clone = clones.open(dir, { log: (line) => lines.push(line) });
    await clone.branchFrom("loom/words-deploy", "main");
    await clone.commitStaged(WHO, "nothing staged");
    expect(lines[0]).toBe("$ git checkout -B loom/words-deploy main");
    expect(lines.some((line) => line.includes("Switched to"))).toBe(true);
    expect(lines).toContain("$ git diff --cached --quiet");
  }, 30_000);

  it("stops when its signal aborts, before running anything more", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    const controller = new AbortController();
    controller.abort();
    const clone = clones.open(dir, { signal: controller.signal });
    await expect(clone.fetch()).rejects.toBeInstanceOf(CloneStopped);
  }, 30_000);

  it("names the command and git's words when one fails", async () => {
    const remote = await origin();
    const dir = await remote.cloneOf("clone");
    const failure = await clones
      .open(dir)
      .branchFrom("loom/x", "no-such-start")
      .catch((e) => e);
    expect(failure).toBeInstanceOf(CloneError);
    expect((failure as CloneError).command).toBe("git checkout -B loom/x no-such-start");
    expect((failure as CloneError).message).toMatch(/^git checkout failed: /);
  }, 30_000);
});

describe("a module folder inside a shared repository", () => {
  it("is refused before git stages, stashes, checks out or cleans anything in it", async () => {
    const remote = await origin({
      "modules/waf-module-a/package.json": "{}\n",
      "other.txt": "x\n",
    });
    const monorepo = await remote.cloneOf("monorepo");
    const module = path.join(monorepo, "modules", "waf-module-a");
    await write(module, "new.txt", "work");
    await write(monorepo, "other.txt", "changed elsewhere\n");
    const clone = clones.open(module);
    for (const change of [
      () => clone.stage(),
      () => clone.onBranchFromOrigin("main", { work: "carry" }),
      () => clone.onBranchFromOrigin("main", { work: "discard", from: "main" }),
      () => clone.branchFrom("loom/a-deploy", "HEAD"),
    ]) {
      const refusal = (await change().then(
        () => null,
        (error: unknown) => error,
      )) as { status?: number; code?: string } | null;
      expect(refusal).toMatchObject({ status: 409, code: "module_shared_repository" });
    }
    // Nothing in the shared repository moved: its work is where it was, unstaged, on main.
    expect(git(monorepo, "status", "--porcelain")).toBe(
      ["M other.txt", "?? modules/waf-module-a/new.txt"].join("\n"),
    );
    expect(git(monorepo, "stash", "list")).toBe("");
    expect(git(monorepo, "branch", "--show-current")).toBe("main");
    // Questions that change nothing are still answered.
    expect((await clone.state()).branch).toBe("main");
  });
});
