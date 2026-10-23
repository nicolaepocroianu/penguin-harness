/**
 * The QA deploy's six stages, each run against fakes: the clones and Jenkins answer from
 * memory, the clock waits no time, FFmpeg is a fake (`fake-ffmpeg.ts`), and the activity-data
 * and media clones are temp dirs. No test here runs git, FFmpeg or makes a request, and nothing
 * is written outside the temp dirs.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SpawnConfiner } from "@waterford/waf-harness-core";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClones } from "./fake-clones.js";
import { MP3_OPTIMISED, MP3_STEREO, fakeFfmpeg } from "./fake-ffmpeg.js";
import type { DeployProcessOptions } from "../src/activities/deploy-process.js";
import type { DeployJenkins, JenkinsBuildStatus } from "../src/activities/deploy-jenkins.js";
import { moduleContentHash } from "../src/activities/deploy-service.js";
import { defaultDeploySettings } from "../src/activities/deploy-settings.js";
import {
  DEPLOY_STAGE_DEFINITIONS,
  DeployStageFailure,
  activityDeployParams,
  qaActivityUrl,
  qaStages,
  releaseCurrent,
  stagesFor,
  type DeployActivitySnapshot,
  type DeployStageContext,
} from "../src/activities/deploy-stages.js";
import type { DeployStage } from "../src/activities/deploy-types.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * The activity-data and media clones, answering from memory; `tracked` is what the media
 * repository holds, and `authored` what is new or changed in its working tree.
 */
function fakeClones(
  dirs: { activityData: string; media: string },
  options: { tracked?: string[]; authored?: string[] } = {},
) {
  const clones = new FakeClones();
  clones.add(dirs.activityData, {
    origin: "git@github.com:org/data.git",
    head: "feedface",
  });
  clones.add(dirs.media, {
    origin: "git@github.com:org/media.git",
    head: "feedface",
    inHead: options.tracked ?? [],
    changed: options.authored ?? [],
  });
  return clones;
}

/** What was asked of the clone at `dir`, each operation with its arguments. */
function asked(clones: FakeClones, dir: string): unknown[][] {
  return clones.calls
    .filter((call) => path.resolve(call.dir) === path.resolve(dir))
    .map((call) => [call.op, ...call.args]);
}

function fakeJenkins(statuses: JenkinsBuildStatus[] = [{ state: "unknown" }]) {
  const triggers: Array<{ job: string; params: Record<string, string> }> = [];
  const polls: Array<{ params: Record<string, string>; after: number | null | undefined }> = [];
  const jenkins: DeployJenkins = {
    async trigger(job, params) {
      triggers.push({ job, params });
      return { queueUrl: null };
    },
    async status(_job, params, options) {
      polls.push({ params, after: options?.after });
      return statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    },
  };
  return { triggers, polls, jenkins };
}

function fakeClock() {
  let now = Date.UTC(2026, 8, 28, 12, 0, 0);
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => now,
      async sleep(ms: number) {
        sleeps.push(ms);
        now += ms;
      },
    },
  };
}

function snapshot(): DeployActivitySnapshot {
  return {
    title: "Words",
    layout: "mainOnly",
    theme: null,
    contentRevision: "rev-42",
    productRevision: "product-rev-42",
    refs: [
      {
        refNum: 1,
        displayName: "First",
        configuration: { words: { "en-US": { edited: true } } },
        assessment: null,
        usesAssessment: false,
        assets: [{ key: "hello", type: "audio", path: "media/loom/words/hello.mp3" }],
      },
    ],
  };
}

async function setup(
  overrides: Partial<DeployStageContext> = {},
  cloneOptions: Parameters<typeof fakeClones>[1] = {},
  // Unless a test says otherwise, every file is already as a deploy ships it.
  ffmpeg = fakeFfmpeg({}, { describe: MP3_OPTIMISED }),
) {
  const activityData = await tempDir("wafh-qa-data-");
  const media = await tempDir("wafh-qa-media-");
  const mediaWork = path.join(await tempDir("wafh-qa-media-work-"), "waf-module-words");
  const clones = fakeClones({ activityData, media }, cloneOptions);
  const jenkins = fakeJenkins();
  const clock = fakeClock();
  const lines: string[] = [];
  const settings = defaultDeploySettings();
  settings.git = { userName: "Deploy Bot", userEmail: "deploy@example.org" };
  settings.timeouts.deployMinutes = 1;
  const ctx: DeployStageContext = {
    clones,
    serial: clones.serial,
    jenkins: jenkins.jenkins,
    process: ffmpeg.process(),
    ffmpeg: "ffmpeg",
    styles: async () => ({ code: 0, tail: "" }),
    confinement: () => null,
    clock: clock.clock,
    settings,
    productCode: "words",
    module: {
      folder: "waf-module-words",
      dir: await tempDir("wafh-qa-module-"),
      checkDir: path.join(await tempDir("wafh-qa-checks-"), "waf-module-words"),
      source: null,
    },
    moduleVersion: null,
    metadata: {},
    earlier: { await_module_build: { resolvedModuleVersion: "1.5.0" } },
    log: (text) => lines.push(text),
    signal: new AbortController().signal,
    qa: {
      activityData: { dir: activityData },
      media: { dir: media, workDir: mediaWork },
      refNum: 1,
      target: {
        tier: "qa",
        environment: "loom",
        frameworkVersion: "4.2.1",
        activityBaseUrl: "https://qa.example.org/play",
      },
      snapshot: async () => snapshot(),
    },
    ...overrides,
  };
  return { ctx, clones, jenkins, clock, lines, activityData, media, mediaWork, ffmpeg };
}

const run = (stage: DeployStage, ctx: DeployStageContext) =>
  DEPLOY_STAGE_DEFINITIONS[stage].run(ctx);

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(DeployStageFailure);
  return (error as DeployStageFailure).error;
}

describe("QA stage sequencing", () => {
  it("runs all ten stages unless the release is current for the same module", () => {
    expect(stagesFor("qa")).toHaveLength(10);
    const done = { status: "done" as const, metadata: {} };
    const stored = {
      verify_module: { status: "done" as const, metadata: { moduleContentHash: "h1" } },
      prepare_deploy: done,
      trigger_module_build: done,
      await_module_build: { status: "done" as const, metadata: { resolvedModuleVersion: "1.5.0" } },
    };
    expect(releaseCurrent(stored, "h1")).toBe(true);
    expect(releaseCurrent(stored, "h2")).toBe(false);
    expect(releaseCurrent(stored, null)).toBe(false);
    expect(
      releaseCurrent(
        { ...stored, trigger_module_build: { status: "pending", metadata: {} } },
        "h1",
      ),
    ).toBe(false);
    expect(qaStages(true)).toEqual([
      "export_activity_data",
      "verify_activity_data",
      "verify_media_assets",
      "publish_activity_data",
      "trigger_activity_deploy",
      "await_activity_deploy",
    ]);
    expect(qaStages(false)[0]).toBe("verify_module");
  });
});

describe("moduleContentHash", () => {
  it("changes with the module's content and build configuration, not with its build output", async () => {
    const root = await tempDir("wafh-qa-hash-");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export {};");
    await fs.writeFile(path.join(root, "package.json"), "{}");
    await fs.writeFile(path.join(root, "webpack.config.cjs"), "module.exports = {};");
    const first = await moduleContentHash(root);
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist", "main.js"), "built");
    expect(await moduleContentHash(root)).toBe(first);
    await fs.writeFile(path.join(root, "webpack.config.cjs"), "module.exports = { mode: 1 };");
    const second = await moduleContentHash(root);
    expect(second).not.toBe(first);
    await fs.writeFile(path.join(root, "tsconfig.build.json"), "{}");
    expect(await moduleContentHash(root)).not.toBe(second);
  });
});

describe("export_activity_data", () => {
  it("puts the clone on the product's branch and writes the data for the released version", async () => {
    const { ctx, clones, activityData } = await setup();
    await run("export_activity_data", ctx);
    // The clone is the deploy's own: it is put back as origin has it.
    expect(asked(clones, activityData)).toEqual([
      ["onBranchFromOrigin", "loom/words-activity-data", { work: "discard", from: "main" }],
    ]);
    expect(clones.calls).toHaveLength(1);
    const template = JSON.parse(
      await fs.readFile(path.join(activityData, "data/templates/loom/words.json"), "utf8"),
    );
    expect(template.layout.compartments.main.module).toBe("words@^1.5.0");
    const configuration = JSON.parse(
      await fs.readFile(path.join(activityData, "data/configurations/loom/words-1.json"), "utf8"),
    );
    expect(configuration.words["en-US"]).toEqual({
      edited: true,
      hello: "{{MEDIA}}/loom/words/hello.mp3",
    });
    expect(ctx.metadata).toMatchObject({
      resolvedModuleVersion: "1.5.0",
      deployedRefNums: [1],
      exportedRevision: "rev-42",
      exportedProductRevision: "product-rev-42",
      exportedFiles: [
        "data/configurations/loom/words-1.json",
        "data/templates/loom/words.json",
        "deployLists/loom-words.txt",
      ],
    });
  });

  it("needs a released version", async () => {
    const none = await setup({ earlier: {} });
    expect(await failure(run("export_activity_data", none.ctx))).toEqual({
      code: "missing_input",
      stage: "await_module_build",
    });
  });
});

describe("verify_activity_data and verify_media_assets", () => {
  it("passes exported data, and fails naming the media found nowhere", async () => {
    const { ctx, lines } = await setup();
    await run("export_activity_data", ctx);
    await run("verify_activity_data", ctx);
    expect(ctx.metadata.preflight?.errors).toEqual([]);
    expect(ctx.metadata.preflight?.counts.media).toBe(1);
    expect(await failure(run("verify_media_assets", ctx))).toEqual({
      code: "media_missing",
      paths: ["media/loom/words/hello.mp3"],
      count: 1,
    });
    expect(lines).toContain("Missing: media/loom/words/hello.mp3");
  });

  it("fails the check when the data names another module", async () => {
    const { ctx } = await setup();
    await run("export_activity_data", ctx);
    ctx.metadata.resolvedModuleVersion = "1.6.0";
    expect(await failure(run("verify_activity_data", ctx))).toEqual({
      code: "preflight_failed",
      errors: 1,
    });
    expect(ctx.metadata.preflight?.errors[0]).toMatchObject({ code: "layout_module_mismatch" });
  });

  it("publishes authored media in the media clone: carries it onto main, commits and pushes", async () => {
    const { ctx, clones, media } = await setup({}, { authored: ["loom/words/hello.mp3"] });
    await fs.mkdir(path.join(media, "loom", "words"), { recursive: true });
    await fs.writeFile(path.join(media, "loom", "words", "hello.mp3"), "hello");
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    expect(await fs.readFile(path.join(media, "loom/words/hello.mp3"), "utf8")).toBe("hello");
    // The authored file is carried while main comes up to origin, never reset or cleaned away.
    expect(asked(clones, media)).toEqual([
      ["fetch"],
      ["onBranchFromOrigin", "main", { work: "carry" }],
      ["changed", "loom/words/hello.mp3"],
      ["stage", ["loom/words/hello.mp3"], { sparse: true }],
      [
        "commitStaged",
        "Publish media for words",
        { name: "Deploy Bot", email: "deploy@example.org" },
      ],
      ["push", "main", {}],
    ]);
    expect(ctx.metadata).toMatchObject({
      mediaChecked: 1,
      mediaCopied: ["loom/words/hello.mp3"],
      mediaCopiedCount: 1,
      mediaCommit: "feedface",
    });
    // All of it waits for, and holds off, the workspace's own git work on the media clone.
    expect(clones.unqueued(media)).toEqual([]);
    expect(
      clones.calls.filter((call) => call.dir === media).every((c) => c.queue === "media"),
    ).toBe(true);
  });

  it("stages every copied file, reaching folders the partial clone has not checked out", async () => {
    const count = 450;
    const paths = Array.from(
      { length: count },
      (_, i) =>
        `media/loom/words/audios/english/scene-${i}-an-audio-file-with-a-long-name-${i}.mp3`,
    );
    const { ctx, clones, media } = await setup(
      {},
      { authored: paths.map((file) => file.slice("media/".length)) },
    );
    const many = snapshot();
    many.refs[0]!.assets = paths.map((file, i) => ({ key: `clip${i}`, type: "audio", path: file }));
    ctx.qa!.snapshot = async () => many;
    for (const file of paths) {
      const target = path.join(media, file.slice("media/".length));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "clip");
    }
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    const staged = asked(clones, media).filter((call) => call[0] === "stage");
    expect(staged).toHaveLength(1);
    expect(staged[0]![2]).toEqual({ sparse: true });
    expect((staged[0]![1] as string[]).sort()).toEqual(
      paths.map((file) => file.slice("media/".length)).sort(),
    );
    expect(ctx.metadata.mediaCopiedCount).toBe(count);
  });

  it("re-encodes media not yet as a deploy ships it, and publishes it with what it saved", async () => {
    const ffmpeg = fakeFfmpeg({ "hello.mp3": { describe: MP3_STEREO, writes: "smaller" } });
    const { ctx, clones, media, lines } = await setup(
      {},
      { authored: ["loom/words/hello.mp3"] },
      ffmpeg,
    );
    await fs.mkdir(path.join(media, "loom", "words"), { recursive: true });
    await fs.writeFile(path.join(media, "loom", "words", "hello.mp3"), "a much larger sound");
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    expect(await fs.readFile(path.join(media, "loom/words/hello.mp3"), "utf8")).toBe("smaller");
    expect(ctx.metadata.mediaOptimised).toEqual({
      optimised: 1,
      rebranded: 0,
      alreadyOptimised: 0,
      skipped: 0,
      failed: 0,
      bytesBefore: 19,
      bytesAfter: 7,
      files: [
        {
          path: "loom/words/hello.mp3",
          kind: "audio",
          status: "optimised",
          bytesBefore: 19,
          bytesAfter: 7,
        },
      ],
    });
    expect(lines).toContain("Optimised loom/words/hello.mp3: 19 B → 7 B (saved 12 B, 63%).");
    expect(asked(clones, media).filter((call) => call[0] === "stage")).toEqual([
      ["stage", ["loom/words/hello.mp3"], { sparse: true }],
    ]);
    expect(asked(clones, media).at(-1)).toEqual(["push", "main", {}]);

    // The next deploy finds it already as a deploy ships it.
    ctx.metadata = {};
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    expect(ctx.metadata.mediaOptimised).toMatchObject({ optimised: 0, alreadyOptimised: 1 });
    expect(ffmpeg.encodes()).toHaveLength(1);
  });

  it("publishes nothing when an encode fails, leaving the original as it was", async () => {
    const ffmpeg = fakeFfmpeg({
      "hello.mp3": { describe: MP3_STEREO, exitCode: 1, output: "Error while encoding\n" },
    });
    const { ctx, clones, media, lines } = await setup(
      {},
      { authored: ["loom/words/hello.mp3"] },
      ffmpeg,
    );
    await fs.mkdir(path.join(media, "loom", "words"), { recursive: true });
    await fs.writeFile(path.join(media, "loom", "words", "hello.mp3"), "original");
    await run("export_activity_data", ctx);
    expect(await failure(run("verify_media_assets", ctx))).toEqual({
      code: "media_optimise_failed",
      paths: ["loom/words/hello.mp3"],
      count: 1,
    });
    expect(await fs.readFile(path.join(media, "loom/words/hello.mp3"), "utf8")).toBe("original");
    expect(lines).toContain("Could not optimise loom/words/hello.mp3: Error while encoding");
    expect(ctx.metadata.mediaOptimised).toMatchObject({ failed: 1 });
    expect(asked(clones, media).some((call) => call[0] === "stage" || call[0] === "push")).toBe(
      false,
    );
  });

  it("fails naming ffmpeg, and publishes nothing, when there is no FFmpeg to run", async () => {
    const ffmpeg = fakeFfmpeg({ "hello.mp3": { describe: MP3_STEREO } });
    ffmpeg.remove();
    const { ctx, clones, media, lines } = await setup(
      {},
      { authored: ["loom/words/hello.mp3"] },
      ffmpeg,
    );
    await fs.mkdir(path.join(media, "loom", "words"), { recursive: true });
    await fs.writeFile(path.join(media, "loom", "words", "hello.mp3"), "original");
    await run("export_activity_data", ctx);
    expect(await failure(run("verify_media_assets", ctx))).toEqual({
      code: "command_missing",
      command: "ffmpeg",
    });
    expect(lines.some((line) => /ffmpeg could not be run.*nothing was published/.test(line))).toBe(
      true,
    );
    expect(asked(clones, media).some((call) => call[0] === "stage" || call[0] === "push")).toBe(
      false,
    );
  });

  it("runs FFmpeg confined, writable in a work folder outside the clone, with none of the server's environment", async () => {
    const SECRET = "WAFH_DEPLOY_FFMPEG_PROBE";
    const saved = process.env[SECRET];
    process.env[SECRET] = "secret";
    try {
      const confined: Parameters<SpawnConfiner>[1][] = [];
      const confiner: SpawnConfiner = (argv, opts) => {
        confined.push(opts);
        return { argv: ["sandbox-runner", ...argv] };
      };
      const ffmpeg = fakeFfmpeg({ "hello.mp3": { describe: MP3_STEREO } });
      const seen: DeployProcessOptions[] = [];
      const inner = ffmpeg.process();
      const { ctx, media, mediaWork } = await setup(
        {
          confinement: () => confiner,
          process: {
            run: (command, args, options) => {
              seen.push(options);
              return inner.run(command, args, options);
            },
          },
        },
        { authored: ["loom/words/hello.mp3"] },
        ffmpeg,
      );
      await fs.mkdir(path.join(media, "loom", "words"), { recursive: true });
      await fs.writeFile(path.join(media, "loom", "words", "hello.mp3"), "sound");
      // A folder a stopped server left behind is cleared away.
      await fs.mkdir(path.join(mediaWork, "optimise-stale"), { recursive: true });
      await run("export_activity_data", ctx);
      await run("verify_media_assets", ctx);
      expect(seen).toHaveLength(2);
      for (const options of seen) {
        expect(options.shell).toBe(false);
        expect(options.env?.[SECRET]).toBeUndefined();
        expect(path.dirname(options.cwd)).toBe(mediaWork);
        expect(options.confine?.(["ffmpeg", "-i", "x"]).argv).toEqual([
          "sandbox-runner",
          "ffmpeg",
          "-i",
          "x",
        ]);
      }
      expect(confined[0]).toMatchObject({ cwd: seen[0]!.cwd, workspaceDir: seen[0]!.cwd });
      // The work folder is outside the media clone, and gone once the stage ends.
      expect(path.relative(media, seen[0]!.cwd).startsWith("..")).toBe(true);
      expect(await fs.readdir(mediaWork)).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env[SECRET];
      else process.env[SECRET] = saved;
    }
  });

  it("asks for no sandbox, and runs no FFmpeg, when the data names no audio or video", async () => {
    const { HttpError } = await import("../src/http/errors.js");
    const ffmpeg = fakeFfmpeg();
    const { ctx, clones, media } = await setup(
      {
        confinement: () => {
          throw new HttpError(503, "sandbox_unavailable", "No sandbox plugin is enabled.");
        },
      },
      { tracked: ["loom/words/hello.png"] },
      ffmpeg,
    );
    const pictures = snapshot();
    pictures.refs[0]!.assets = [
      { key: "hello", type: "image", path: "media/loom/words/hello.png" },
    ];
    ctx.qa!.snapshot = async () => pictures;
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    expect(ffmpeg.calls).toEqual([]);
    expect(ctx.metadata.mediaOptimised).toMatchObject({ optimised: 0, skipped: 1 });
    expect(asked(clones, media).some((call) => call[0] === "push")).toBe(false);
  });

  it("fails naming the media the clone has only as Git LFS pointers, publishing nothing", async () => {
    const { ctx, clones, media } = await setup({}, { authored: ["loom/words/hello.mp3"] });
    await fs.mkdir(path.join(media, "loom", "words"), { recursive: true });
    await fs.writeFile(
      path.join(media, "loom", "words", "hello.mp3"),
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 9\n",
    );
    await run("export_activity_data", ctx);
    expect(await failure(run("verify_media_assets", ctx))).toEqual({
      code: "media_lfs_pointer",
      paths: ["loom/words/hello.mp3"],
      count: 1,
    });
    expect(asked(clones, media).some((call) => call[0] === "stage" || call[0] === "push")).toBe(
      false,
    );
  });

  it("fails naming the media that changed while it was re-encoded, publishing nothing", async () => {
    const ffmpeg = fakeFfmpeg({
      "hello.mp3": {
        describe: MP3_STEREO,
        meanwhile: (source) => fs.writeFile(source, "a take accepted meanwhile"),
      },
    });
    const { ctx, clones, media } = await setup({}, { authored: ["loom/words/hello.mp3"] }, ffmpeg);
    await fs.mkdir(path.join(media, "loom", "words"), { recursive: true });
    await fs.writeFile(path.join(media, "loom", "words", "hello.mp3"), "the old take");
    await run("export_activity_data", ctx);
    expect(await failure(run("verify_media_assets", ctx))).toEqual({
      code: "media_changed",
      paths: ["loom/words/hello.mp3"],
      count: 1,
    });
    expect(await fs.readFile(path.join(media, "loom/words/hello.mp3"), "utf8")).toBe(
      "a take accepted meanwhile",
    );
    expect(asked(clones, media).some((call) => call[0] === "push")).toBe(false);
  });

  it("does nothing while activity agents are to be confined and nothing can confine FFmpeg", async () => {
    const { HttpError } = await import("../src/http/errors.js");
    const { ctx, clones, media } = await setup({
      confinement: () => {
        throw new HttpError(503, "sandbox_unavailable", "No sandbox plugin is enabled.");
      },
    });
    await run("export_activity_data", ctx);
    expect(await failure(run("verify_media_assets", ctx))).toEqual({
      code: "sandbox_unavailable",
    });
    expect(asked(clones, media).some((call) => call[0] === "push")).toBe(false);
  });

  it("pushes nothing when the repository already has every file", async () => {
    const { ctx, clones, media } = await setup({}, { tracked: ["loom/words/hello.mp3"] });
    await run("export_activity_data", ctx);
    await run("verify_media_assets", ctx);
    expect(asked(clones, media).some((call) => call[0] === "push")).toBe(false);
    expect(ctx.metadata.mediaCopiedCount).toBe(0);
  });
});

describe("publish_activity_data", () => {
  it("commits the exported files and pushes the branch", async () => {
    const { ctx, clones, activityData } = await setup();
    await run("export_activity_data", ctx);
    clones.calls.length = 0;
    await run("publish_activity_data", ctx);
    expect(asked(clones, activityData)).toEqual([
      [
        "stage",
        [
          "data/configurations/loom/words-1.json",
          "data/templates/loom/words.json",
          "deployLists/loom-words.txt",
        ],
        {},
      ],
      [
        "commitStaged",
        "Deploy activity data for words (words@^1.5.0)",
        { name: "Deploy Bot", email: "deploy@example.org" },
      ],
      ["push", "loom/words-activity-data", { track: true }],
    ]);
    expect(clones.calls).toHaveLength(3);
    expect(ctx.metadata.activityDataCommit).toBe("feedface");
  });

  it("needs an export to publish", async () => {
    const { ctx } = await setup();
    expect(await failure(run("publish_activity_data", ctx))).toEqual({
      code: "missing_input",
      stage: "export_activity_data",
    });
  });
});

describe("trigger_activity_deploy and await_activity_deploy", () => {
  it("starts the deploy job with the activity deploy parameters and records the QA address", async () => {
    const { ctx, jenkins } = await setup();
    await run("trigger_activity_deploy", ctx);
    expect(jenkins.triggers).toEqual([
      {
        job: "WAF Activity Deploy",
        params: {
          branch: "loom/words-activity-data",
          framework_version: "4.2.1",
          tier: "qa",
          deploy_environment: "loom",
          add_activities_to_catalog: "false",
          template_names: "words",
        },
      },
    ]);
    expect(jenkins.polls[0]!.params).toEqual({
      branch: "loom/words-activity-data",
      tier: "qa",
      deploy_environment: "loom",
      template_names: "words",
    });
    // The newest deploy, none of it still going, is the floor the new one is looked for above.
    expect(jenkins.polls.map((poll) => poll.after)).toEqual([undefined]);
    expect(ctx.metadata).toMatchObject({
      preDeployNumber: null,
      qaFrameworkVersion: "4.2.1",
      qaActivityUrl:
        "https://qa.example.org/play?productCode=words&refNum=1&frameworkVersion=4.2.1",
    });
    expect(qaActivityUrl("https://qa.example.org", "a b", 2, "4")).toBe(
      "https://qa.example.org?productCode=a+b&refNum=2&frameworkVersion=4",
    );
    expect(activityDeployParams("words", ctx.qa!.target).template_names).toBe("words");
  });

  it("waits for the deploy build it started, then records when and what went to QA", async () => {
    const { ctx, jenkins, clock } = await setup({
      earlier: {
        export_activity_data: {
          exportedRevision: "rev-41",
          exportedProductRevision: "product-rev-41",
        },
        trigger_activity_deploy: {
          preDeployNumber: 6,
          qaActivityUrl: "https://qa.example.org/play?productCode=words",
          qaFrameworkVersion: "4.2.1",
        },
      },
    });
    jenkins.polls.length = 0;
    const statuses: JenkinsBuildStatus[] = [
      { state: "queued" },
      { state: "building", number: 7, url: "https://jenkins.example.org/job/d/7/" },
      { state: "succeeded", number: 7, url: "https://jenkins.example.org/job/d/7/" },
    ];
    ctx.jenkins = fakeJenkins(statuses).jenkins;
    await run("await_activity_deploy", ctx);
    expect(clock.sleeps).toEqual([15_000, 15_000]);
    expect(ctx.metadata).toMatchObject({
      preDeployNumber: 6,
      activityDeployUrl: "https://jenkins.example.org/job/d/7/",
      qaActivityUrl: "https://qa.example.org/play?productCode=words",
      qaDeployedAt: "2026-09-28T12:00:30.000Z",
      contentRevision: "rev-41",
      productRevision: "product-rev-41",
    });
  });

  it("names the module build that went live, on QA and then on PROD", async () => {
    const earlier = {
      export_activity_data: { exportedRevision: "rev-41" },
      trigger_activity_deploy: { preDeployNumber: 6 },
      verify_module: { moduleContentHash: "h1", moduleRunId: "run_built" },
    };
    const live = () => fakeJenkins([{ state: "succeeded", number: 7, url: "u" }]).jenkins;
    // The release left out, the build is the one verified before.
    const released = await setup({ earlier });
    released.ctx.jenkins = live();
    await run("await_activity_deploy", released.ctx);
    expect(released.ctx.metadata.moduleRunId).toBe("run_built");
    // Verified in this run as the clone held it, no build went live, whatever went before.
    const asIs = await setup({ metadata: { moduleContentHash: null }, earlier });
    asIs.ctx.jenkins = live();
    await run("await_activity_deploy", asIs.ctx);
    expect(asIs.ctx.metadata).not.toHaveProperty("moduleRunId");
    // PROD gets what QA has.
    const prod = await setup({
      prod: { target: { tier: "prod", environment: "DEFAULT", frameworkVersion: "4.1.0" } },
      earlier: { await_activity_deploy: { contentRevision: "rev-41", moduleRunId: "run_built" } },
    });
    await run("trigger_production_deploy", prod.ctx);
    prod.ctx.jenkins = live();
    await run("await_production_deploy", prod.ctx);
    expect(prod.ctx.metadata.moduleRunId).toBe("run_built");
  });

  it("fails a deploy that fails or runs past its minutes, and one never started", async () => {
    const failed = await setup({ earlier: { trigger_activity_deploy: { preDeployNumber: null } } });
    failed.ctx.jenkins = fakeJenkins([{ state: "failed", result: "FAILURE", url: "u" }]).jenkins;
    expect(await failure(run("await_activity_deploy", failed.ctx))).toEqual({
      code: "build_failed",
      result: "FAILURE",
      url: "u",
    });
    const slow = await setup({ earlier: { trigger_activity_deploy: { preDeployNumber: null } } });
    slow.ctx.jenkins = fakeJenkins([{ state: "building" }]).jenkins;
    expect(await failure(run("await_activity_deploy", slow.ctx))).toEqual({
      code: "deploy_timed_out",
      minutes: 1,
    });
    const never = await setup();
    expect(await failure(run("await_activity_deploy", never.ctx))).toEqual({
      code: "missing_input",
      stage: "trigger_activity_deploy",
    });
  });

  // Started again after its wait was stopped, timed out or cut short by a restart.
  const going: JenkinsBuildStatus = { state: "building", number: 7, url: "https://j/d/7/" };

  it("follows the QA deploy its last start began while nothing new was published", async () => {
    const earlier = {
      trigger_activity_deploy: { preDeployNumber: 6, qaFrameworkVersion: "4.2.1" },
    };
    for (const status of [going, { state: "succeeded", number: 7 } as const]) {
      const again = await setup({ earlier });
      const jenkins = fakeJenkins([status]);
      again.ctx.jenkins = jenkins.jenkins;
      await run("trigger_activity_deploy", again.ctx);
      expect(jenkins.triggers).toEqual([]);
      expect(jenkins.polls.map((poll) => poll.after)).toEqual([6]);
      expect(again.ctx.metadata.preDeployNumber).toBe(6);
    }
    // This run published new activity data or new media: a new deploy, which never runs beside
    // one going.
    for (const metadata of [{ activityDataCommit: "d1" }, { mediaCommit: "m1" }]) {
      const published = await setup({ earlier, metadata });
      published.ctx.jenkins = fakeJenkins([going]).jenkins;
      expect(await failure(run("trigger_activity_deploy", published.ctx))).toEqual({
        code: "build_in_flight",
        url: "https://j/d/7/",
      });
    }
    // A last start whose wait finished, or one with another framework version, is not followed.
    for (const other of [
      { ...earlier, await_activity_deploy: { qaDeployedAt: "2026-09-28T12:00:00.000Z" } },
      { trigger_activity_deploy: { preDeployNumber: 6, qaFrameworkVersion: "4.2.0" } },
    ]) {
      const fresh = await setup({ earlier: other });
      const jenkins = fakeJenkins([{ state: "succeeded", number: 7 }]);
      fresh.ctx.jenkins = jenkins.jenkins;
      await run("trigger_activity_deploy", fresh.ctx);
      expect(jenkins.triggers).toHaveLength(1);
      expect(fresh.ctx.metadata.preDeployNumber).toBe(7);
    }
  });

  it("follows the PROD deploy its last start began, which the wait then records", async () => {
    const prod = { target: { tier: "prod", environment: "DEFAULT", frameworkVersion: "4.1.0" } };
    const earlier = {
      await_activity_deploy: { contentRevision: "rev-41" },
      trigger_production_deploy: { preProductionDeployNumber: 8, prodFrameworkVersion: "4.1.0" },
    };
    const again = await setup({ prod, earlier });
    const jenkins = fakeJenkins([{ state: "succeeded", number: 9, url: "https://j/p/9/" }]);
    again.ctx.jenkins = jenkins.jenkins;
    await run("trigger_production_deploy", again.ctx);
    expect(jenkins.triggers).toEqual([]);
    await run("await_production_deploy", again.ctx);
    expect(jenkins.polls.map((poll) => poll.after)).toEqual([8, 8]);
    expect(again.ctx.metadata).toMatchObject({
      productionDeployNumber: 9,
      productionDeployUrl: "https://j/p/9/",
      prodDeployedAt: "2026-09-28T12:00:00.000Z",
    });
    // Another PROD deploy of this activity still going, not this run's to follow.
    const beside = await setup({
      prod,
      earlier: { await_activity_deploy: earlier.await_activity_deploy },
    });
    beside.ctx.jenkins = fakeJenkins([going]).jenkins;
    expect(await failure(run("trigger_production_deploy", beside.ctx))).toEqual({
      code: "build_in_flight",
      url: "https://j/d/7/",
    });
  });
});
