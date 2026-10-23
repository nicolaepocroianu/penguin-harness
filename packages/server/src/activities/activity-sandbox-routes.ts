/**
 * The admin switch for confining activity agents (admin only, 403 for everyone else): GET
 * /api/admin/activity-sandbox reads it and whether runs could be confined right now, PUT
 * { enabled } changes it. On by default; an admin who does not want activity agents sandboxed
 * turns it off, and from then on activity runs are neither confined nor refused for want of
 * a sandbox. A run already going keeps what it started with.
 */
import { Bind, Component, Use } from "@waterford/waf-harness-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { optionalBoolean, readJson } from "../http/validate.js";
import type { Settings } from "../mechanisms/settings.js";
import { Sandbox, SandboxModule } from "../sandbox/service.js";
import type { ActivitySandboxState } from "./activity-sandbox-types.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "admin-api.activity-sandbox",
        prefix: "/api/admin/activity-sandbox",
        auth: "user",
        order: 49,
      },
    ],
  },
})
export class ActivitySandboxAdminRoutes {
  @Use() private readonly settings!: Settings;
  @Use(SandboxModule) private readonly sandbox!: Sandbox;
  @Bind("admin-api.activity-sandbox") routes!: Hono<AppEnv>;

  setup() {
    const state = (): ActivitySandboxState => ({
      enabled: this.settings.getConfineActivityAgents(),
      problem: this.sandbox.confinementProblem("workspace-write"),
    });
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin) {
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      }
      await next();
    });
    app.get("/", (c) => c.json({ sandbox: state() }));
    app.put("/", async (c) => {
      const enabled = optionalBoolean(await readJson(c), "enabled");
      if (enabled === undefined) {
        throw new HttpError(400, "bad_request", "enabled must be a boolean.");
      }
      this.settings.setConfineActivityAgents(enabled);
      return c.json({ sandbox: state() });
    });
    this.routes = app;
  }
}
