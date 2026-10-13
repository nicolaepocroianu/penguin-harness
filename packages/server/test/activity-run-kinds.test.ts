/**
 * Run kinds through their contract, with no Session and no server: what a kind refuses, what
 * it stages in a workspace, and what it makes of what its agent wrote there. The prompts and
 * staged files of every kind, as a real start hands them over, are pinned in
 * activity-run-kinds-golden.test.ts.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentRevision,
  type ActivityDetail,
  type ActivityRun,
  type ActivityRunKind,
  type ActivityRunOf,
} from "../src/activities/domain.js";
import type { RunRequest } from "../src/activities/run-request.js";
import { RUN_KINDS, runKindOf } from "../src/activities/run-kinds/index.js";
import {
  canRun,
  type CollectInput,
  type RunKindServices,
  type Settlement,
} from "../src/activities/run-kinds/contract.js";
import { assistKind } from "../src/activities/run-kinds/assist.js";
import { mediaTextKind, MEDIA_TEXT_OUTPUT } from "../src/activities/run-kinds/media-text.js";
import { phonemesKind } from "../src/activities/run-kinds/phonemes.js";
import { mediaSpecKind, specKind, SPEC_OUTPUT } from "../src/activities/run-kinds/spec.js";
import { testKind } from "../src/activities/run-kinds/test.js";
import { imageKind, IMAGE_OUTPUT } from "../src/activities/run-kinds/image.js";
import { PHONEMES_FILE } from "../src/activities/phonemes-run.js";
import { experimentOff } from "../src/activities/video-experiment.js";
import {
  ACCEPTANCE_REPORT_DIR,
  ACCEPTANCE_REPORT_FILE,
  ACCEPTANCE_RESULTS_FILE,
} from "../src/activities/acceptance-harness.js";
import { CURRENT_SPEC_FILE, SPEC_TEMPLATE_FILE } from "../src/activities/spec-prompts.js";
import { activitySpec } from "./activity-fixtures.js";
import { imagePng } from "./image-fixtures.js";

const workspaces: string[] = [];
afterEach(async () => {
  for (const dir of workspaces.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "run-kind-"));
  workspaces.push(dir);
  return dir;
}

function activity(draft: Partial<ActivityDetail["draft"]> = {}): ActivityDetail {
  return {
    id: "act_1",
    productCode: "words",
    refNum: 1,
    activityType: "standard",
    draft: {
      draftId: "draft_1",
      contentRevision: "r1",
      status: "draft",
      description: "Teach sight words",
      spec: null,
      ...draft,
    },
  } as ActivityDetail;
}

/** Only what a test's kind reaches for; anything else fails loudly. */
function services(overrides: Partial<RunKindServices> = {}): RunKindServices {
  return new Proxy(
    {
      // The experiment is off here.
      requireVideoExperiment: () => {
        throw experimentOff();
      },
      ...overrides,
    },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        throw new Error(`The kind reached for services.${String(key)}.`);
      },
    },
  ) as RunKindServices;
}

function run<Kind extends ActivityRunKind>(
  kind: Kind,
  fields: Partial<ActivityRunOf<Kind>> = {},
): ActivityRunOf<Kind> {
  return {
    kind,
    runId: `run_${"a".repeat(32)}`,
    activityId: "act_1",
    projectId: "kinds-work",
    draftId: "draft_1",
    inputRevision: "r1",
    agentId: "default_agent",
    sessionId: "session-1",
    status: "running",
    createdAt: "2026-10-12T00:00:00.000Z",
    finishedAt: null,
    error: null,
    candidate: null,
    ...fields,
  } as ActivityRunOf<Kind>;
}

function collecting<Run extends ActivityRun>(
  current: Run,
  dir: string,
  extra: Partial<CollectInput<Run>> = {},
): CollectInput<Run> & { saved: ActivityRun[] } {
  const saved: ActivityRun[] = [];
  return {
    services: services(),
    run: current,
    workspace: dir,
    observed: { completed: true, error: null },
    stopping: () => false,
    save: (value) => saved.push(structuredClone(value)),
    saved,
    ...extra,
  };
}

describe("the run a request asks for", () => {
  it("records speech and sound as audio runs, and every other request as its own kind", () => {
    const kinds = Object.keys(RUN_KINDS) as RunRequest["kind"][];
    expect(Object.fromEntries(kinds.map((kind) => [kind, runKindOf({ kind })]))).toEqual({
      spec: "spec",
      "media-spec": "media-spec",
      module: "module",
      speech: "audio",
      sound: "audio",
      image: "image",
      "media-text": "media-text",
      assist: "assist",
      assessment: "assessment",
      test: "test",
      phonemes: "phonemes",
      composition: "composition",
      timeline: "timeline",
      critique: "critique",
    });
  });
});

describe("whether a run may start", () => {
  const owner = { projectId: "kinds-work" };

  it("refuses a script pass with no script, and a media pass with no saved specification", async () => {
    expect(
      await canRun(specKind, services(), { kind: "spec" }, activity({ description: " " }), owner),
    ).toMatchObject({ ok: false, refusal: { code: "description_required" } });
    expect(await canRun(specKind, services(), { kind: "spec" }, activity(), owner)).toEqual({
      ok: true,
    });
    // The media pass is written from the specification, so its script does not matter.
    expect(
      await canRun(mediaSpecKind, services(), { kind: "media-spec" }, activity(), owner),
    ).toMatchObject({ ok: false, refusal: { code: "media_spec_spec_required", status: 400 } });
    expect(
      await canRun(
        mediaSpecKind,
        services(),
        { kind: "media-spec" },
        activity({ description: "", spec: activitySpec, status: "valid" }),
        owner,
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a scene video while the experiment is off, before anything else", async () => {
    const request: RunRequest = {
      kind: "composition",
      composition: { language: "en-US", assetKey: "intro-video" },
    };
    expect(
      await canRun(
        RUN_KINDS.composition,
        services(),
        request,
        activity({ description: "" }),
        owner,
      ),
    ).toMatchObject({ ok: false, refusal: { code: "experiment_off", status: 403 } });
  });

  it("asks the owning Agent's Vault only when told who owns the run", async () => {
    const image: RunRequest = { kind: "image", image: { language: "en-US", assetKey: "cover" } };
    const planned = activity({
      spec: activitySpec,
      status: "valid",
      mediaPlan: {
        specRevision: contentRevision(activitySpec),
        manifest: {
          assets: { "en-US": [{ key: "cover", type: "image", description: "A blue penguin" }] },
        },
      } as unknown as ActivityDetail["draft"]["mediaPlan"],
    });
    const vault = services({ vaultKeys: async () => [] });
    expect(await canRun(imageKind, vault, image, planned, owner)).toEqual({ ok: true });
    expect(
      await canRun(imageKind, vault, image, planned, { ...owner, agentId: "media_agent" }),
    ).toMatchObject({
      ok: false,
      refusal: { code: "image_credential_missing" },
      // Left undone rather than failed where the work is done in stages.
      skip: "providerUnavailable",
    });
    expect(
      await canRun(
        imageKind,
        services({ vaultKeys: async () => ["GEMINI_API_KEY"] }),
        image,
        planned,
        { ...owner, agentId: "media_agent" },
      ),
    ).toEqual({ ok: true });
  });
});

describe("a specification pass", () => {
  it("stages the template for a first specification and the current one after that", async () => {
    const first = await workspace();
    const input = {
      services: services(),
      prepared: {},
      run: run("spec"),
      workspace: first,
      confined: false,
      description: "Teach sight words",
      expectedRevision: "r1",
    };
    await specKind.stage({ ...input, activity: activity() });
    expect(await fs.readdir(first)).toEqual([SPEC_TEMPLATE_FILE]);
    const again = await workspace();
    await specKind.stage({
      ...input,
      workspace: again,
      activity: activity({ spec: activitySpec, status: "valid" }),
    });
    expect(JSON.parse(await fs.readFile(path.join(again, CURRENT_SPEC_FILE), "utf8"))).toEqual(
      activitySpec,
    );
    const prompt = specKind.prompt({ ...input, activity: activity() }, undefined);
    const repaired = specKind.prompt(
      { ...input, activity: activity(), prepared: { repair: "It had no scenes." } },
      undefined,
    );
    expect(repaired).toContain("It had no scenes.");
    expect(repaired).toContain(prompt);
  });

  it("keeps what the agent wrote, then saves it as the specification it started from", async () => {
    const dir = await workspace();
    await fs.writeFile(path.join(dir, SPEC_OUTPUT), JSON.stringify(activitySpec));
    const applied: unknown[] = [];
    const current = run("spec");
    const input = collecting(current, dir, {
      services: services({
        activities: {
          getActivity: async () => activity(),
          applySpec: async (...args: unknown[]) => {
            applied.push(args);
            return activity().draft;
          },
        } as unknown as RunKindServices["activities"],
      }),
    });
    const settled = (await specKind.collect(input)) as Extract<Settlement, { kept: true }>;
    expect(input.saved[0]!.candidate).toBe(JSON.stringify(activitySpec));
    expect(applied).toEqual([]);
    await settled.apply!();
    expect(applied).toEqual([["kinds-work", "act_1", expect.any(Object), "r1"]]);
  });

  it("marks what failed its checks as repairable, and leaves a stopping server's run alone", async () => {
    const dir = await workspace();
    await fs.writeFile(path.join(dir, SPEC_OUTPUT), JSON.stringify({ scenes: [] }));
    const failing = run("spec");
    await expect(
      specKind.collect(
        collecting(failing, dir, {
          services: services({
            activities: {
              getActivity: async () => activity(),
            } as unknown as RunKindServices["activities"],
          }),
        }),
      ),
    ).rejects.toThrow("The specification has 0 scenes.");
    expect(failing.repairable).toBe(true);
    const stopping = run("spec");
    expect(await specKind.collect(collecting(stopping, dir, { stopping: () => true }))).toBeNull();
    expect(stopping.candidate).toBe(JSON.stringify({ scenes: [] }));
  });

  it("fails a Session that did not complete, naming why", async () => {
    const dir = await workspace();
    await fs.writeFile(path.join(dir, SPEC_OUTPUT), "{}");
    await expect(
      specKind.collect(
        collecting(run("spec"), dir, { observed: { completed: false, error: "Rate limited." } }),
      ),
    ).rejects.toThrow("Rate limited.");
  });
});

describe("collecting what an agent wrote", () => {
  it("keeps a media text candidate's own four fields, until the draft changes", async () => {
    const dir = await workspace();
    const mediaText = {
      language: "en-US",
      assetKey: "cover",
      type: "image" as const,
      text: "A penguin",
      translation: { from: "Hello", languageName: "Spanish" },
    };
    await fs.writeFile(
      path.join(dir, MEDIA_TEXT_OUTPUT),
      JSON.stringify({
        language: "en-US",
        assetKey: "cover",
        type: "image",
        text: "A blue penguin",
      }),
    );
    const current = run("media-text", { mediaText });
    expect(await mediaTextKind.collect(collecting(current, dir))).toEqual({
      kept: true,
      draftChanged: "The draft changed during media text generation.",
    });
    expect(JSON.parse(current.candidate!)).toEqual({
      language: "en-US",
      assetKey: "cover",
      type: "image",
      text: "A blue penguin",
    });
  });

  it("names nothing it was not asked for: an empty workspace is a missing output", async () => {
    const dir = await workspace();
    const error = await phonemesKind
      .collect(
        collecting(run("phonemes", { phonemes: { language: "en-US", words: ["cat"] } }), dir),
      )
      .catch((caught: NodeJS.ErrnoException) => caught);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    expect(phonemesKind.outputs).toEqual([PHONEMES_FILE]);
  });

  it("stores an image through the authoring service before keeping it", async () => {
    const dir = await workspace();
    await fs.writeFile(path.join(dir, IMAGE_OUTPUT), imagePng());
    const stored: string[] = [];
    const current = run("image", { image: { language: "en-US", assetKey: "cover" } as never });
    await imageKind.collect(
      collecting(current, dir, {
        services: services({
          activities: {
            storeImage: async (_p: string, _a: string, runId: string) => {
              stored.push(runId);
              return { runId, sha256: "abc", bytes: 1 };
            },
          } as unknown as RunKindServices["activities"],
        }),
      }),
    );
    expect(stored).toEqual([current.runId]);
    expect(JSON.parse(current.candidate!)).toMatchObject({ runId: current.runId });
  });

  it("writes a test run's report beside what the agent reported, and keeps no candidate", async () => {
    const dir = await workspace();
    await fs.writeFile(
      path.join(dir, ACCEPTANCE_RESULTS_FILE),
      JSON.stringify({ results: [{ criterion: "It plays.", status: "passed", durationMs: 5 }] }),
    );
    const current = run("test", {
      test: { criteria: ["It plays."], specRevision: "s1", harnessVersion: 1, reused: false },
    });
    expect(await testKind.collect(collecting(current, dir))).toEqual({ kept: true });
    expect(current.candidate).toBeNull();
    const report = JSON.parse(
      await fs.readFile(path.join(dir, ACCEPTANCE_REPORT_DIR, ACCEPTANCE_REPORT_FILE), "utf8"),
    ) as { specRevision: string };
    expect(report.specRevision).toBe("s1");
  });

  it("settles a conversation by its Session alone", async () => {
    const dir = await workspace();
    expect(await assistKind.collect(collecting(run("assist"), dir))).toEqual({
      settled: "succeeded",
    });
    expect(
      await assistKind.collect(
        collecting(run("assist"), dir, { observed: { completed: false, error: null } }),
      ),
    ).toEqual({ settled: "failed", error: "The agent did not reply." });
  });
});
