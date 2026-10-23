/**
 * Loom's dev-sandbox address, `/player.html?module=<product>&ref=<n>&languageCode=…&
 * startSceneId=…&resolution=…&source=…`, so a link made for Loom plays here unchanged.
 *
 * On the sandbox origin (the configured preview origin, `dev-sandbox.<zone>` deployed, or the
 * loopback name the App leaves free) it IS the player page, as Loom's dev-sandbox serves it.
 * On the App's own host it serves no module code: it sends the visitor to the same address on
 * the sandbox origin, or, where there is none, serves the page sandboxed. Like Loom's, it asks
 * for no sign-in: whoever can reach it can play any ref.
 *
 * A product is normally open in one project (the one that claimed it). Should it be open in
 * several, `project=<id>` picks one; without it the page names them.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono, type Context } from "hono";
import type { Config } from "../hmr/capabilities.js";
import type { Projects } from "../mechanisms/projects.js";
import {
  hostOnly,
  isPreviewHost,
  requestAuthority,
  resolvePreviewTarget,
} from "../services/preview-token.js";
import { playerAddress } from "./play-link.js";
import { readPlayQuery, type PlaySource } from "./play-query.js";
import { playerPageResponse } from "./play-routes.js";
import type { ActivitySandbox, PlayCandidate } from "./sandbox-service.js";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

/**
 * A plain page saying why nothing plays, in the words Loom's player uses where it has them.
 */
function refusal(c: Context, status: 400 | 404 | 409, message: string): Response {
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
 * The one ref a Loom link names among the candidates in every project, or why there
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
      message: `"${moduleId}" ref ${ref} is open in more than one project: ${refs
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
  @Use() private readonly config!: Config;
  @Use() private readonly projects!: Projects;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Bind("activities.player-html") routes!: Hono;

  setup() {
    const app = new Hono();
    app.get("/", (c) => this.play(c));

    this.routes = app as unknown as Hono;
  }

  private async play(c: Context): Promise<Response> {
    const query = readPlayQuery((name) => c.req.query(name));
    // Loom's player asks for the module first, then the ref, in these words.
    if (!query.module) return refusal(c, 400, "Missing module id in player URL.");
    if (query.ref === null)
      return refusal(c, 400, query.refError ?? "Ref is required. Use a non-negative whole number.");
    if (query.sourceError) return refusal(c, 400, query.sourceError);
    const every = this.projects.listAll().map((row) => row.projectId);
    const asked = c.req.query("project")?.trim();
    const projects = asked ? every.filter((id) => id === asked) : every;
    const picked = pickPlayable(
      await this.sandbox.playCandidates(projects, query.module),
      query.module,
      query.ref,
      query.source,
    );
    if ("message" in picked) return refusal(c, picked.status, picked.message);
    const chosen = picked.chosen;
    const host = hostOnly(requestAuthority(c.req.url, c.req.header("host")));
    const onSandbox = isPreviewHost(host, this.config.previewOrigin, this.config.host);
    const sandboxOrigin = resolvePreviewTarget(
      c.req.url,
      c.req.header("host"),
      this.config.previewOrigin,
      this.config,
    );
    if (!onSandbox && sandboxOrigin)
      return c.redirect(playerAddress(c, this.config, query, asked || null), 302);
    return playerPageResponse(
      this.sandbox,
      { projectId: chosen.projectId, activityId: chosen.activityId },
      query,
      !onSandbox,
    );
  }
}
