/**
 * An activity bench home's Benchmarks, read for the Evaluation Center: what is listed, what is
 * never read (the vault, the trials, the seed, links), that nothing is written, and the admin route
 * that chooses the bench home and answers with its Benchmarks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityBenchResponse } from "../src/api/types.js";
import { readBenchBoards } from "../src/activities/bench-boards.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const ROUTE = "/api/admin/activity-bench";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-bench-home-"));
  temps.push(dir);
  return dir;
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const EVALUATION = `evaluations:
  - time: "2026-10-13T10:00:00.000Z"
    agent_id: activity_agent
    version: 3
    provider: custom
    model_id: m
    thinking_level: medium
    summary_title: "abc1234: the module prompt"
    summary: "Base 60, head 70."
    score: 70
    cost: 1.5
    duration_ms: 60000
    cases:
      - case: CASE-001-star
        score: 70
        cost: 1.5
        duration_ms: 60000
        runs:
          - score: 70
            cost: 1.5
            duration_ms: 60000
            session_id: sess_1
`;

/** A Benchmark folder as `pnpm bench` leaves it. */
function benchmark(dir: string, title: string, scoreboard = EVALUATION): void {
  write(path.join(dir, "benchmark_config.toml"), `title = "${title}"\nruns = 1\n`);
  write(path.join(dir, "scoreboard.yaml"), scoreboard);
  write(path.join(dir, "CASE-001-star", "statement", "README.md"), "# Tap the star\n");
}

/** A bench home with Benchmarks to list, and everything it holds that must never be read. */
function benchHome(): string {
  const home = tempDir();
  benchmark(path.join(home, "bench", "benchmarks", "activity-bench-r10"), "Revision ten");
  benchmark(path.join(home, "bench", "benchmarks", "activity-bench-r2"), "Revision two");
  // Not the bench's: another Benchmark in the same folder.
  benchmark(path.join(home, "bench", "benchmarks", "swe-bench-v1"), "Someone else's");
  // The bench's own folders hold no scores to list, whatever they contain.
  benchmark(path.join(home, "trials", "benchmarks", "activity-bench-r1"), "A trial");
  benchmark(path.join(home, "seed", "benchmarks", "activity-bench-r1"), "The seed");
  write(path.join(home, "vault", "waterford.sealed"), "sealed");
  benchmark(path.join(home, "evaluations", "benchmarks", "activity-bench-r1"), "Held out");
  write(path.join(home, "bench.json"), '{ "project": "bench" }');
  return home;
}

/** Every file and folder under `dir`, with its size and modification time. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const visit = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      const stat = fs.lstatSync(full);
      out.push(`${path.relative(dir, full)} ${stat.size} ${stat.mtimeMs}`);
      if (entry.isDirectory()) visit(full);
    }
  };
  visit(dir);
  return out.sort();
}

describe("an activity bench home's Benchmarks", () => {
  it("lists the bench's Benchmarks by project and revision, with their scoreboards", async () => {
    const home = benchHome();
    const boards = await readBenchBoards(home);
    expect(boards.map((board) => [board.project, board.id, board.title])).toEqual([
      ["bench", "activity-bench-r2", "Revision two"],
      ["bench", "activity-bench-r10", "Revision ten"],
    ]);
    expect(boards[0]).toMatchObject({
      caseCount: 1,
      runs: 1,
      status: "published",
      agentIds: ["activity_agent"],
      evaluations: [
        {
          version: 3,
          score: 70,
          summaryTitle: "abc1234: the module prompt",
          modelId: "m",
          cases: [{ case: "CASE-001-star", score: 70 }],
        },
      ],
    });
  });

  it("follows no link: a linked Benchmark, scoreboard or Project lists nothing", async () => {
    const home = benchHome();
    const elsewhere = tempDir();
    benchmark(path.join(elsewhere, "activity-bench-r3"), "Linked");
    const benchmarks = path.join(home, "bench", "benchmarks");
    const link = (target: string, at: string) =>
      fs.symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
    link(path.join(elsewhere, "activity-bench-r3"), path.join(benchmarks, "activity-bench-r3"));
    link(path.join(home, "bench"), path.join(home, "linked"));
    // A scoreboard that is a link to a file elsewhere, here the vault.
    const r4 = path.join(benchmarks, "activity-bench-r4");
    benchmark(r4, "Linked scoreboard");
    fs.rmSync(path.join(r4, "scoreboard.yaml"));
    try {
      fs.symlinkSync(
        path.join(home, "vault", "waterford.sealed"),
        path.join(r4, "scoreboard.yaml"),
      );
    } catch {
      // Windows refuses file links without the privilege: the board then has no scoreboard.
    }
    const ids = (await readBenchBoards(home)).map((board) => `${board.project}/${board.id}`);
    expect(ids).not.toContain("bench/activity-bench-r3");
    expect(ids.filter((id) => id.startsWith("linked/"))).toEqual([]);
    if (fs.lstatSync(path.join(r4, "scoreboard.yaml"), { throwIfNoEntry: false })?.isSymbolicLink())
      expect(ids).not.toContain("bench/activity-bench-r4");
  });
});

describe("the bench home's admin route", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    return { t, admin };
  }

  it("keeps the folder an admin chooses, and answers with its Benchmarks without writing there", async () => {
    const { admin } = await fixture();
    const unset = await admin.get(ROUTE);
    expect(unset.status).toBe(200);
    expect(await unset.json()).toEqual({ home: null, boards: [], problem: null });

    const home = benchHome();
    const before = snapshot(home);
    const chosen = await admin.put(ROUTE, { home });
    expect(chosen.status, await chosen.clone().text()).toBe(200);
    const view = (await chosen.json()) as ActivityBenchResponse;
    expect(view.home).toBe(fs.realpathSync(home));
    expect(view.problem).toBeNull();
    expect(view.boards.map((board) => board.id)).toEqual([
      "activity-bench-r2",
      "activity-bench-r10",
    ]);
    const again = (await (await admin.get(ROUTE)).json()) as ActivityBenchResponse;
    expect(again.boards).toEqual(view.boards);
    expect(snapshot(home)).toEqual(before);

    // A home that is gone says so, and forgetting it clears it.
    fs.rmSync(home, { recursive: true, force: true });
    expect(((await (await admin.get(ROUTE)).json()) as ActivityBenchResponse).problem).toBe(
      "home_missing",
    );
    const forgot = await admin.put(ROUTE, { home: null });
    expect(await forgot.json()).toEqual({ home: null, boards: [], problem: null });
  });

  it("refuses a folder that is not one, is relative, or overlaps this server's data", async () => {
    const { t, admin } = await fixture();
    for (const home of [
      "relative/bench",
      path.join(tempDir(), "missing"),
      t.root,
      path.join(t.root, "inside"),
      path.dirname(t.root),
      42,
    ]) {
      if (typeof home === "string" && home.startsWith(t.root) && home !== t.root)
        fs.mkdirSync(home, { recursive: true });
      const response = await admin.put(ROUTE, { home });
      expect(response.status, String(home)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "bench_home_invalid" } });
    }
  });

  it("refuses the home folder, ~/.penguin, and anything inside ~/.penguin", async () => {
    const { admin } = await fixture();
    // A home folder of the test's own, so the user's is never looked at.
    const userHome = tempDir();
    fs.mkdirSync(path.join(userHome, ".penguin", "dev-data"), { recursive: true });
    fs.mkdirSync(path.join(userHome, "bench"), { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(userHome);
    try {
      for (const home of [
        userHome,
        path.join(userHome, ".penguin"),
        path.join(userHome, ".penguin", "dev-data"),
      ]) {
        const response = await admin.put(ROUTE, { home });
        expect(response.status, home).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "bench_home_invalid", message: expect.stringContaining("~/.penguin") },
        });
      }
      // A folder of its own beside them is a bench home.
      const own = await admin.put(ROUTE, { home: path.join(userHome, "bench") });
      expect(own.status, await own.clone().text()).toBe(200);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("is for admins only", async () => {
    const { t } = await fixture();
    const member = apiClient(t.app, (await provisionUser(t.app, "bench_reader")).cookie);
    for (const response of [await member.get(ROUTE), await member.put(ROUTE, { home: null })]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "admin_required" } });
    }
  });
});
