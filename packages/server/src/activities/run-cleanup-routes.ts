/**
 * Cleaning up activity runs (admin only, 403 for everyone else; see run-cleanup.ts):
 *
 *   GET  /api/admin/activity-run-cleanup/storage
 *     → { storage }: the disk every run folder takes together.
 *   GET  /api/admin/activity-run-cleanup/plan?keepNewest=<n>[&orphanTakes=1]
 *     → { plan }: what a cleanup would remove, per category, and the id that confirms it;
 *       nothing is removed. keepNewest defaults to RUN_CLEANUP_KEEP_DEFAULT, orphanTakes to 0.
 *   POST /api/admin/activity-run-cleanup/apply  { planId }
 *     → { report }: what it removed of what the dry run listed, as things stand now; 409
 *       `run_cleanup_plan_expired` when that dry run can no longer be confirmed.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { badRequest, readJson } from "../http/validate.js";
import type { ActivityRunCleanup } from "./run-cleanup.js";
import {
  RUN_CLEANUP_KEEP_DEFAULT,
  type RunCleanupPlanResponse,
  type RunCleanupReportResponse,
  type RunStorageResponse,
} from "./run-cleanup-types.js";

/** A whole number from the query string; the service says which ones it takes. */
function queryCount(value: string | undefined): number {
  if (value === undefined) return RUN_CLEANUP_KEEP_DEFAULT;
  if (!/^\d+$/.test(value)) throw badRequest("keepNewest must be a whole number.");
  return Number(value);
}

function queryFlag(value: string | undefined): boolean {
  if (value === undefined || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw badRequest("orphanTakes must be 1 or 0.");
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "admin-api.activity-run-cleanup",
        prefix: "/api/admin/activity-run-cleanup",
        auth: "user",
        order: 44,
      },
    ],
  },
})
export class ActivityRunCleanupRoutes {
  @Use() private readonly cleanup!: ActivityRunCleanup;
  @Bind("admin-api.activity-run-cleanup") routes!: Hono<AppEnv>;

  setup() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin)
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      await next();
    });
    app.get("/storage", async (c) =>
      c.json({ storage: await this.cleanup.storage() } satisfies RunStorageResponse),
    );
    app.get("/plan", async (c) => {
      const plan = await this.cleanup.plan({
        keepNewest: queryCount(c.req.query("keepNewest")),
        orphanTakes: queryFlag(c.req.query("orphanTakes")),
      });
      return c.json({ plan } satisfies RunCleanupPlanResponse);
    });
    app.post("/apply", async (c) => {
      const { planId } = await readJson(c);
      if (typeof planId !== "string" || !planId) throw badRequest("planId must name a dry run.");
      const report = await this.cleanup.apply(planId);
      return c.json({ report } satisfies RunCleanupReportResponse);
    });
    this.routes = app;
  }
}
