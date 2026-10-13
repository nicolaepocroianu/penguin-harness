/**
 * The outcome ledger, read (admin only, 403 for everyone else): every project's runs are in it.
 *
 *   GET /api/admin/activity-outcomes/tally?kind=<run kind>[&by=<dimension>][&projectId=…]
 *       [&activityId=…]…[&since=<ISO time>][&until=<ISO time>]
 *     → { tallies }: counts for one run kind, per recipe or per part of one.
 *   GET /api/admin/activity-outcomes/history?projectId=…&activityId=…[&runId=…]
 *     → { runs }: one activity's runs (or one run), oldest first, with recipes and facts.
 *   GET /api/admin/activity-outcomes/runs?<the tally's query>&key=<the tally's key>
 *     → { runs }: the runs one tally counted, newest first, at most 50. An empty `key` is the
 *     tally of runs whose recipes have no such part (its key is null).
 *   GET /api/admin/activity-outcomes/projects
 *     → { projects }: the ids of the projects the ledger holds runs of.
 */
import { isValidId } from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import type { ActivityRunKind } from "./domain.js";
import type {
  OutcomeDimension,
  OutcomeHistoryResponse,
  OutcomeProjectsResponse,
  OutcomeQuery,
  OutcomeRunsResponse,
  OutcomeTallyResponse,
} from "./outcome-types.js";
import type { ActivityOutcomes } from "./outcomes.js";
import { RECORDED_RUN_KINDS } from "./run-kinds/index.js";

const DIMENSIONS: readonly OutcomeDimension[] = [
  "recipe",
  "runtime",
  "prompt",
  "library",
  "harness",
  "penguin",
];

/** An optional query id; 400 when it is given and is not an id. */
function queryId(c: Context<AppEnv>, name: string): string | undefined {
  const value = c.req.query(name);
  if (value === undefined) return undefined;
  if (!isValidId(value)) throw badRequest(`${name} must be an id.`);
  return value;
}

function requiredId(c: Context<AppEnv>, name: string): string {
  const value = queryId(c, name);
  if (value === undefined) throw badRequest(`${name} is required.`);
  return value;
}

/** An optional ISO time; 400 when it is given and is not one. */
function queryTime(c: Context<AppEnv>, name: string): string | undefined {
  const value = c.req.query(name);
  if (value === undefined) return undefined;
  if (Number.isNaN(Date.parse(value))) throw badRequest(`${name} must be an ISO time.`);
  return new Date(value).toISOString();
}

/** Which runs a tally counts, from the query string; 400 for anything it cannot answer. */
function outcomeQuery(c: Context<AppEnv>): OutcomeQuery {
  const kind = c.req.query("kind");
  if (!kind || !RECORDED_RUN_KINDS.has(kind as ActivityRunKind))
    throw badRequest(`kind must be one of ${[...RECORDED_RUN_KINDS].sort().join(", ")}.`);
  const by = c.req.query("by");
  if (by !== undefined && !DIMENSIONS.includes(by as OutcomeDimension))
    throw badRequest(`by must be one of ${DIMENSIONS.join(", ")}.`);
  const activityIds = c.req.queries("activityId");
  if (activityIds?.some((id) => !isValidId(id))) throw badRequest("activityId must be an id.");
  const projectId = queryId(c, "projectId");
  const since = queryTime(c, "since");
  const until = queryTime(c, "until");
  return {
    kind: kind as ActivityRunKind,
    ...(by !== undefined ? { by: by as OutcomeDimension } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(activityIds?.length ? { activityIds } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
  };
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "admin-api.activity-outcomes",
        prefix: "/api/admin/activity-outcomes",
        auth: "user",
        order: 44,
      },
    ],
  },
})
export class ActivityOutcomeRoutes {
  @Use() private readonly outcomes!: ActivityOutcomes;
  @Bind("admin-api.activity-outcomes") routes!: Hono<AppEnv>;

  setup() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin)
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      await next();
    });
    app.get("/tally", async (c) => {
      return c.json({
        tallies: await this.outcomes.tally(outcomeQuery(c)),
      } satisfies OutcomeTallyResponse);
    });
    app.get("/runs", async (c) => {
      const query = outcomeQuery(c);
      const key = c.req.query("key");
      if (key === undefined) throw badRequest("key is required.");
      return c.json({
        runs: await this.outcomes.tallyRuns({ ...query, key: key === "" ? null : key }),
      } satisfies OutcomeRunsResponse);
    });
    app.get("/projects", async (c) => {
      return c.json({ projects: await this.outcomes.projects() } satisfies OutcomeProjectsResponse);
    });
    app.get("/history", async (c) => {
      const runId = queryId(c, "runId");
      return c.json({
        runs: await this.outcomes.history(
          requiredId(c, "projectId"),
          requiredId(c, "activityId"),
          runId,
        ),
      } satisfies OutcomeHistoryResponse);
    });
    this.routes = app;
  }
}
