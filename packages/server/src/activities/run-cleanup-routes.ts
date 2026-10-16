/**
 * Cleaning up activity runs (admin only, 403 for everyone else; see run-cleanup.ts):
 *
 *   GET  /api/admin/activity-run-cleanup/storage
 *     → { storage }: the disk every run folder takes together.
 *   GET  /api/admin/activity-run-cleanup/plan?keepNewest=<n>[&orphanTakes=1]
 *     → { report }: what a cleanup would remove, per category; nothing is removed.
 *   POST /api/admin/activity-run-cleanup/apply  { keepNewest, orphanTakes }
 *     → { report }: what it removed, worked out again as things stand now.
 *
 * keepNewest defaults to RUN_CLEANUP_KEEP_DEFAULT and orphanTakes to false.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { badRequest, readJson } from "../http/validate.js";
import type { ActivityRunCleanup } from "./run-cleanup.js";
import {
  RUN_CLEANUP_KEEP_DEFAULT,
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
      const report = await this.cleanup.plan({
        keepNewest: queryCount(c.req.query("keepNewest")),
        orphanTakes: queryFlag(c.req.query("orphanTakes")),
      });
      return c.json({ report } satisfies RunCleanupReportResponse);
    });
    app.post("/apply", async (c) => {
      const body = await readJson(c);
      const report = await this.cleanup.apply({
        keepNewest: (body.keepNewest ?? RUN_CLEANUP_KEEP_DEFAULT) as number,
        orphanTakes: (body.orphanTakes ?? false) as boolean,
      });
      return c.json({ report } satisfies RunCleanupReportResponse);
    });
    this.routes = app;
  }
}
