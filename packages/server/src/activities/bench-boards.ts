/**
 * An activity bench home's Benchmarks, read for the Evaluation Center (admin only).
 *
 * `pnpm bench` keeps its scores in a bench home, as Benchmarks in the format the Evaluation Center
 * reads any Benchmark in: `<home>/<project>/benchmarks/activity-bench-r<N>/`. An admin chooses
 * the bench home once (kept in `server_settings`), and the Evaluation Center lists those
 * Benchmarks beside the Project's own, read-only.
 *
 * What is read is those folders and nothing past them: never the bench's vault, its trials, its
 * seed, its recipes, its Claude login or its records. A folder reached through a link is not
 * followed, so a link cannot lead the reads anywhere else. Nothing here writes to the bench home,
 * and nothing runs.
 *
 *   GET /api/admin/activity-bench → the bench home chosen, and its Benchmarks
 *   PUT /api/admin/activity-bench { home } → chooses it (an absolute folder of its own), or forgets
 *     it (null)
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isValidId } from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type {
  ActivityBenchBoard,
  ActivityBenchResponse,
  ActivityBenchUpdateRequest,
} from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import type { Paths } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { readJson } from "../http/validate.js";
import type { Settings } from "../mechanisms/settings.js";
import { readBenchmarkDir } from "../services/benchmark-service.js";

/** Where the admin's choice is kept in `server_settings`; absent or empty when none was made. */
export const BENCH_HOME_SETTING = "activityBenchHome";

/** What a bench home keeps besides its Projects' Benchmarks: never read. */
const BENCH_OWN = new Set([
  "seed",
  "claude-config",
  "recipes",
  "trials",
  "seed-server",
  "evaluations",
]);

/** A bench's Benchmark: one per case-set revision and scorer. */
const BENCH_BENCHMARK = /^activity-bench-r(\d+)$/;

const PATH_MAX = 1024;

/** What is at `file` without following a link there: a directory, a file, or anything else. */
async function kindOf(file: string): Promise<"dir" | "file" | "other" | "none"> {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat) return "none";
  if (stat.isDirectory()) return "dir";
  return stat.isFile() ? "file" : "other";
}

/** A directory's own subdirectories by name, links not followed; none when it cannot be read. */
async function subdirectories(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

const revision = (id: string) => Number(BENCH_BENCHMARK.exec(id)?.[1] ?? 0);

/**
 * The Benchmarks a bench home holds, by Project and then by revision. A Benchmark whose config or
 * scoreboard is a link, or that has no config, is not listed.
 */
export async function readBenchBoards(home: string): Promise<ActivityBenchBoard[]> {
  const boards: ActivityBenchBoard[] = [];
  const projects = (await subdirectories(home))
    .filter((name) => !BENCH_OWN.has(name) && isValidId(name))
    .sort();
  for (const project of projects) {
    const dir = path.join(home, project, "benchmarks");
    if ((await kindOf(dir)) !== "dir") continue;
    const ids = (await subdirectories(dir))
      .filter((name) => BENCH_BENCHMARK.test(name))
      .sort((a, b) => revision(a) - revision(b));
    for (const id of ids) {
      const benchDir = path.join(dir, id);
      if ((await kindOf(path.join(benchDir, "benchmark_config.toml"))) !== "file") continue;
      // A Benchmark not yet evaluated may have no scoreboard; a link there is not followed.
      const scoreboard = await kindOf(path.join(benchDir, "scoreboard.yaml"));
      if (scoreboard !== "file" && scoreboard !== "none") continue;
      boards.push({ ...(await readBenchmarkDir(benchDir, id)), project });
    }
  }
  return boards;
}

/** Whether one of two absolute paths holds the other, or they are the same. */
function overlaps(a: string, b: string): boolean {
  const inside = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  return inside(a, b) || inside(b, a);
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "admin-api.activity-bench",
        prefix: "/api/admin/activity-bench",
        auth: "user",
        order: 50,
      },
    ],
  },
})
export class ActivityBenchRoutes {
  @Use() private readonly settings!: Settings;
  @Use() private readonly paths!: Paths;
  @Bind("admin-api.activity-bench") routes!: Hono<AppEnv>;

  setup() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin)
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      await next();
    });
    app.get("/", async (c) => c.json(await this.view()));
    app.put("/", async (c) => {
      const body = (await readJson(c)) as Partial<ActivityBenchUpdateRequest>;
      if (body.home === null) this.settings.set(BENCH_HOME_SETTING, "");
      else this.settings.set(BENCH_HOME_SETTING, await this.benchHome(body.home));
      return c.json(await this.view());
    });
    this.routes = app;
  }

  /** The bench home as stored: the folder as chosen, resolved; 400 for one that cannot be. */
  private async benchHome(value: unknown): Promise<string> {
    const refuse = (message: string) => new HttpError(400, "bench_home_invalid", message);
    if (typeof value !== "string" || !path.isAbsolute(value) || value.length > PATH_MAX)
      throw refuse("home must be an absolute folder on this server, or null.");
    const home = await fs.realpath(value).catch(() => null);
    if (home === null || (await kindOf(home)) !== "dir")
      throw refuse("There is no folder there on this server.");
    const root = await fs.realpath(this.paths.root).catch(() => this.paths.root);
    if (overlaps(home, root))
      throw refuse("A bench home is a folder of its own, apart from this server's data folder.");
    // As the bench itself refuses: Penguin's default home, the user's home folder holding it, and
    // anything inside it.
    const penguinHome = path.join(os.homedir(), ".penguin");
    const resolvedPenguinHome = await fs.realpath(penguinHome).catch(() => penguinHome);
    if (overlaps(home, resolvedPenguinHome))
      throw refuse(
        "A bench home is a folder of its own, apart from the home folder and ~/.penguin.",
      );
    return home;
  }

  private async view(): Promise<ActivityBenchResponse> {
    const home = this.settings.get(BENCH_HOME_SETTING) || null;
    if (home === null) return { home: null, boards: [], problem: null };
    if ((await kindOf(home)) !== "dir") return { home, boards: [], problem: "home_missing" };
    return { home, boards: await readBenchBoards(home), problem: null };
  }
}
