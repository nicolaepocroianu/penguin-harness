import { describe, expect, it } from "vitest";
import {
  SandboxBuilder,
  describeBuild,
  type BuilderDeps,
} from "../src/activities/sandbox-builder.js";

interface Deferred {
  resolve(outcome: { ok: boolean; log: string }): void;
  reject(error: unknown): void;
}

/**
 * A builder whose builds finish only when the test says so.
 *
 * `ensure` awaits the source scan before it calls `build`, so the deferred has to be
 * created INSIDE `build` and waited for — resolving one the test made up beforehand
 * settles a promise nobody is holding, and the build never completes. That is exactly
 * the bug this harness had on its first attempt.
 */
function harness(options: { sources?: number[]; nowStart?: number } = {}) {
  const calls: string[] = [];
  const pending: Deferred[] = [];
  let now = options.nowStart ?? 1_000;
  let sources = options.sources ?? [500];
  const deps: BuilderDeps = {
    build: (workspace) => {
      calls.push(workspace);
      return new Promise<{ ok: boolean; log: string }>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    sources: async () => sources,
    now: () => now,
  };
  /** Waits until a build has actually been entered, then hands back its deferred. */
  const nextBuild = async (): Promise<Deferred> => {
    for (let attempt = 0; attempt < 100 && !pending.length; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    if (!pending.length) throw new Error("no build was started");
    return pending.shift()!;
  };
  return {
    builder: new SandboxBuilder(deps),
    calls,
    async finish(outcome: { ok: boolean; log: string } = { ok: true, log: "" }) {
      (await nextBuild()).resolve(outcome);
    },
    async fail(error: unknown) {
      (await nextBuild()).reject(error);
    },
    advance(ms: number) {
      now += ms;
    },
    setSources(mtimes: number[]) {
      sources = mtimes;
    },
    get now() {
      return now;
    },
  };
}

describe("building once", () => {
  it("builds when nothing has been built yet", async () => {
    const h = harness();
    const pending = h.builder.ensure("/w");
    await h.finish({ ok: true, log: "done" });
    const result = await pending;
    expect(result).toMatchObject({ ok: true, joined: false, skipped: false, log: "done" });
    expect(h.calls).toEqual(["/w"]);
  });

  it("does nothing when the module is already current", async () => {
    const h = harness({ sources: [500] });
    const first = h.builder.ensure("/w");
    await h.finish();
    await first;
    h.advance(10);

    const second = await h.builder.ensure("/w");
    expect(second).toMatchObject({ skipped: true, joined: false, ok: true });
    // One build, not two.
    expect(h.calls).toEqual(["/w"]);
  });

  it("builds again once a source moves", async () => {
    const h = harness({ sources: [500] });
    const first = h.builder.ensure("/w");
    await h.finish();
    await first;
    h.setSources([h.now + 5]);

    const second = h.builder.ensure("/w");
    await h.finish();
    await second;
    expect(h.calls).toEqual(["/w", "/w"]);
  });

  it("builds on force even when nothing moved", async () => {
    const h = harness({ sources: [500] });
    const first = h.builder.ensure("/w");
    await h.finish();
    await first;

    const forced = h.builder.ensure("/w", true);
    await h.finish();
    expect(await forced).toMatchObject({ skipped: false });
    expect(h.calls).toEqual(["/w", "/w"]);
  });
});

describe("requests that overlap", () => {
  it("has four requests share one build, and tells three of them they joined", async () => {
    const h = harness();
    const all = [
      h.builder.ensure("/w"),
      h.builder.ensure("/w"),
      h.builder.ensure("/w"),
      h.builder.ensure("/w"),
    ];
    await h.finish({ ok: true, log: "one build" });
    const results = await Promise.all(all);
    // Four scene edits in a row must not start four webpack builds.
    expect(h.calls).toEqual(["/w"]);
    expect(results.filter((r) => r.joined)).toHaveLength(3);
    expect(results.filter((r) => !r.joined)).toHaveLength(1);
    expect(results.every((r) => r.ok && r.log === "one build")).toBe(true);
  });

  it("keeps separate workspaces separate", async () => {
    const h = harness();
    const a = h.builder.ensure("/a");
    const b = h.builder.ensure("/b");
    await h.finish();
    await h.finish();
    await Promise.all([a, b]);
    expect(h.calls.sort()).toEqual(["/a", "/b"]);
  });

  it("lets a failed build be retried instead of stranding every later request", async () => {
    const h = harness();
    const first = h.builder.ensure("/w");
    await h.finish({ ok: false, log: "webpack exploded" });
    expect(await first).toMatchObject({ ok: false, log: "webpack exploded" });

    // The in-flight entry must be gone, or this would join a settled promise forever.
    const retry = h.builder.ensure("/w");
    await h.finish({ ok: true, log: "fixed" });
    expect(await retry).toMatchObject({ ok: true, log: "fixed" });
    expect(h.calls).toEqual(["/w", "/w"]);
  });
});

describe("a build that cannot start", () => {
  it("becomes a failed build with a reason, not a thrown request", async () => {
    const h = harness();
    const pending = h.builder.ensure("/w");
    await h.fail(new Error("webpack is not installed"));
    const result = await pending;
    expect(result).toMatchObject({ ok: false, log: "webpack is not installed" });
  });

  it("does not count as a build, so the next request tries again", async () => {
    const h = harness();
    const pending = h.builder.ensure("/w");
    await h.fail(new Error("nope"));
    await pending;
    // A failed build leaves no timestamp, so the module is still stale.
    expect(h.builder.builtAtMs("/w")).toBeNull();
    const retry = h.builder.ensure("/w");
    await h.finish();
    await retry;
    expect(h.calls).toEqual(["/w", "/w"]);
  });

  it("keeps the failure text for showing an author why the preview is missing", async () => {
    const h = harness();
    const pending = h.builder.ensure("/w");
    await h.finish({ ok: false, log: "ERROR in ./src/index.ts" });
    await pending;
    expect(h.builder.lastLog("/w")).toBe("ERROR in ./src/index.ts");
  });
});

describe("forgetting a workspace", () => {
  it("rebuilds after a run directory is removed", async () => {
    const h = harness({ sources: [500] });
    const first = h.builder.ensure("/w");
    await h.finish();
    await first;
    h.builder.forget("/w");
    expect(h.builder.builtAtMs("/w")).toBeNull();
    const second = h.builder.ensure("/w");
    await h.finish();
    await second;
    expect(h.calls).toEqual(["/w", "/w"]);
  });
});

describe("what an author is told", () => {
  const base = { finishedAtMs: 1, log: "" };
  it("distinguishes built, joined, skipped and failed", () => {
    expect(describeBuild({ ...base, ok: true, joined: false, skipped: false })).toBe("Built.");
    expect(describeBuild({ ...base, ok: true, joined: true, skipped: false })).toBe(
      "Built by a request already in progress.",
    );
    expect(describeBuild({ ...base, ok: true, joined: false, skipped: true })).toBe(
      "The module was already up to date.",
    );
    expect(describeBuild({ ...base, ok: false, joined: false, skipped: false })).toBe(
      "The build failed; see its output.",
    );
    expect(describeBuild({ ...base, ok: false, joined: true, skipped: false })).toBe(
      "A build already in progress failed; see its output.",
    );
  });
});
