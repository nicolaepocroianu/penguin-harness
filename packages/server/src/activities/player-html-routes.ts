/**
 * Loom's dev-sandbox address, `/player.html?module=<product>&ref=<n>&languageCode=…&
 * startSceneId=…&resolution=…&source=…`, on the App's own origin, so a link made for Loom
 * plays here unchanged.
 *
 * It serves no module code: it signs the visitor in as the App does, finds the ref the query
 * names in a project the visitor can see, and sends them to that ref's signed play link on the
 * preview origin (see play-routes.ts), the query carried on in Loom's names. A visitor who is
 * not signed in is sent to the sign-in page, as the App's own pages send them.
 *
 * A product is normally open in one project (the one that claimed it). Should it be open in
 * several the visitor can see, `project=<id>` picks one; without it the page names them.
 */
import { Bind, Component, Use } from "@waterford/waf-harness-core/kernel";
import { Hono, type Context } from "hono";
import { authMiddleware, type AppEnv } from "../auth/middleware.js";
import type { Config } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { Auth } from "../mechanisms/identity.js";
import type { Access } from "../mechanisms/projects.js";
import { signedPlayLocation } from "./play-link.js";
import { readPlayQuery, type PlaySource } from "./play-query.js";
import type { ActivitySandbox, PlayCandidate } from "./sandbox-service.js";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

/**
 * A plain page saying why nothing plays, in the words Loom's player uses where it has them.
 * Answered through the context, so a sign-in the request renewed keeps its cookie.
 */
function refusal(c: Context<AppEnv>, status: 400 | 404 | 409, message: string): Response {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  return c.html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Activity failed to load</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#1f2933}</style>
</head><body><p id="activity">${escapeHtml(message)}</p></body></html>`,
    status,
  );
}

/**
 * The one ref a Loom link names among the candidates in the visitor's projects, or why there
 * is none: Loom's player's words for an unknown module or a ref it does not have, and a 409
 * naming the projects when the ref is open in several.
 */
export function pickPlayable(
  candidates: readonly PlayCandidate[],
  moduleId: string,
  ref: number,
  source: PlaySource | null,
): { chosen: PlayCandidate } | { status: 404 | 409; message: string } {
  const product = candidates.filter((each) => source === null || each.source === source);
  if (!moduleId || !product.length)
    return { status: 404, message: `Failed to load module metadata for "${moduleId}".` };
  const refs = product.filter((each) => each.refNum === ref);
  if (!refs.length)
    return { status: 404, message: `Ref #${ref} is not available for "${moduleId}".` };
  if (refs.length > 1)
    return {
      status: 409,
      message: `"${moduleId}" ref ${ref} is open in more than one of your projects: ${refs
        .map((each) => each.projectId)
        .join(", ")}. Add project=<id> to the link to choose one.`,
    };
  return { chosen: refs[0]! };
}

@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "activities.player-html", prefix: "/player.html", auth: "none", order: 891 },
    ],
  },
})
export class ActivityPlayerHtmlRoutes {
  @Use() private readonly auth!: Auth;
  @Use() private readonly config!: Config;
  @Use() private readonly access!: Access;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Bind("activities.player-html") routes!: Hono;

  setup() {
    const app = new Hono<AppEnv>();
    const authenticate = authMiddleware(this.auth, this.config.trustProxy);

    app.get("/", async (c) => {
      // The App's own sign-in, run here so a visitor without one is sent to sign in rather
      // than answered with the API's 401.
      try {
        await authenticate(c, async () => {});
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) return c.redirect("/login", 302);
        throw error;
      }
      return this.play(c);
    });

    this.routes = app as unknown as Hono;
  }

  private async play(c: Context<AppEnv>): Promise<Response> {
    const query = readPlayQuery((name) => c.req.query(name));
    // Loom's player asks for the module first, then the ref, in these words.
    if (!query.module) return refusal(c, 400, "Missing module id in player URL.");
    if (query.ref === null)
      return refusal(c, 400, query.refError ?? "Ref is required. Use a non-negative whole number.");
    if (query.sourceError) return refusal(c, 400, query.sourceError);
    const visible = this.access.accessibleProjectIds(c.var.user.userId);
    const asked = c.req.query("project")?.trim();
    const projects = asked ? visible.filter((id) => id === asked) : visible;
    const picked = pickPlayable(
      await this.sandbox.playCandidates(projects, query.module),
      query.module,
      query.ref,
      query.source,
    );
    if ("message" in picked) return refusal(c, picked.status, picked.message);
    const chosen = picked.chosen;
    return c.redirect(
      await signedPlayLocation(
        c,
        { config: this.config, sandbox: this.sandbox },
        chosen.projectId,
        chosen.activityId,
        query,
      ),
      302,
    );
  }
}
