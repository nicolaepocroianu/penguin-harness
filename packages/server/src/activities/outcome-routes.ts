/**
 * The outcome ledger, read (admin only, 403 for everyone else): every project's runs are in it.
 *
 *   GET /api/admin/activity-outcomes/tally?kind=<run kind>[&by=<dimension>][&projectId=…]
 *       [&activityId=…]…[&since=<ISO time>][&until=<ISO time>]
 *     → { tallies }: counts for one run kind, per recipe or per part of one.
 *   GET /api/admin/activity-outcomes/history?projectId=…&activityId=…[&runId=…]
 *     → { runs }: one activity's runs (or one run), oldest first, with recipes and facts.
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
  OutcomeQuery,
  OutcomeTallyResponse,
} from "./outcome-types.js";
import type { ActivityOutcomes } from "./outcomes.js";
import { RUN_KINDS } from "./run-kinds/index.js";

/** Every kind a run records: those a start makes, and those the server records itself. */
const KINDS: ReadonlySet<string> = new Set<ActivityRunKind>([
  ...Object.values(RUN_KINDS).map((kind) => kind.run),
  "quality",
  "test",
  "video",
]);

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
      const kind = c.req.query("kind");
      if (!kind || !KINDS.has(kind))
        throw badRequest(`kind must be one of ${[...KINDS].sort().join(", ")}.`);
      const by = c.req.query("by");
      if (by !== undefined && !DIMENSIONS.includes(by as OutcomeDimension))
        throw badRequest(`by must be one of ${DIMENSIONS.join(", ")}.`);
      const activityIds = c.req.queries("activityId");
      if (activityIds?.some((id) => !isValidId(id))) throw badRequest("activityId must be an id.");
      const projectId = queryId(c, "projectId");
      const since = queryTime(c, "since");
      const until = queryTime(c, "until");
      const query: OutcomeQuery = {
        kind: kind as ActivityRunKind,
        ...(by !== undefined ? { by: by as OutcomeDimension } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
        ...(activityIds?.length ? { activityIds } : {}),
        ...(since !== undefined ? { since } : {}),
        ...(until !== undefined ? { until } : {}),
      };
      return c.json({
        tallies: await this.outcomes.tally(query),
      } satisfies OutcomeTallyResponse);
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
