/**
 * Playing an activity, served where its code cannot reach the App.
 *
 * `GET /preview/activity/:key/*` sits outside `/api` and outside the auth middleware, as
 * Loom's dev-sandbox does: the key names the activity (see `play-links.ts`) and is no
 * credential, so a link is the same every time. A module's code -- Loom's or Penguin's,
 * written by an agent either way -- runs in this page, and on the App's origin it would run
 * with the author's session. So only a preview host (see `isPreviewHost`) serves it as is;
 * anywhere else it is served sandboxed, with an opaque origin.
 *
 * Everything the learner runtime asks for hangs off that one path: the page, the player
 * bundle, the module's files, the media, the framework's shared resources, and the few
 * backend calls the framework makes, answered the way the WAF backend would answer them.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono, type Context } from "hono";
import type { Config } from "../hmr/capabilities.js";
import { hostOnly, isPreviewHost, requestAuthority } from "../services/preview-token.js";
import { playKey, readPlayKey } from "./play-links.js";
import { readPlayQuery, type PlayQuery } from "./play-query.js";
import type { ActivitySandbox, FrameworkResource, PlayTarget } from "./sandbox-service.js";

/** The base every played activity's paths hang off, for one play key. */
export function playBase(key: string): string {
  return `/preview/activity/${key}/`;
}

/**
 * The page that plays `target`, its files under the target's play key: served here, and as
 * Loom's `/player.html` (see player-html-routes.ts). `shared` serves it sandboxed.
 */
export async function playerPageResponse(
  sandbox: ActivitySandbox,
  target: PlayTarget,
  query: PlayQuery,
  shared: boolean,
): Promise<Response> {
  const page = await sandbox.playerPage(
    target.projectId,
    target.activityId,
    playBase(playKey(target)),
    {
      languageCode: query.languageCode,
      startSceneId: query.startSceneId,
      resolution: query.resolution,
      runId: target.runId ?? null,
    },
    query.parentOrigin,
  );
  return new Response(page.html, {
    status: page.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // As under a play key: a request the page makes elsewhere learns nothing of what played.
      "Referrer-Policy": "no-referrer",
      // Off a sandbox host there is no origin boundary, so the page gets an opaque origin
      // instead: scripts run, but nothing it does is the App's.
      ...(shared
        ? { "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-modals" }
        : {}),
    },
  });
}

/** What a request under a play key carries: what it plays, and whether to sandbox it. */
type PlayEnv = { Variables: { target: PlayTarget; shared: boolean } };

/** What follows `<prefix>` in the request path, still encoded. */
function rest(c: Context, prefix: string): string {
  const at = c.req.path.indexOf(prefix);
  return at < 0 ? "" : c.req.path.slice(at + prefix.length);
}

const COMMON_HEADERS: Record<string, string> = {
  // A request the page makes elsewhere has no business knowing what was being played.
  "Referrer-Policy": "no-referrer",
  // On the App's own host the page runs sandboxed, with an opaque origin, so its requests
  // back here are cross-origin. No cookie is involved and the key is no secret, so allowing
  // any origin grants nothing the path does not.
  "Access-Control-Allow-Origin": "*",
};

@Component({
  contributes: {
    "HttpModule.routes": [
      // Ahead of the workspace preview's `/preview/:token/*`, which would otherwise take
      // "activity" for a token and answer 404.
      { id: "activities.play", prefix: "/preview/activity", auth: "none", order: 890 },
    ],
  },
})
export class ActivityPlayRoutes {
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly config!: Config;
  @Bind("activities.play") routes!: Hono;

  setup() {
    const app = new Hono<PlayEnv>();

    app.options("/:key/*", () => {
      return new Response(null, {
        status: 204,
        headers: {
          ...COMMON_HEADERS,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "600",
        },
      });
    });

    app.use("/:key/*", async (c, next) => {
      const target = readPlayKey(c.req.param("key") ?? "");
      if (!target) return c.text("Not found", 404, COMMON_HEADERS);
      const host = hostOnly(requestAuthority(c.req.url, c.req.header("host")));
      c.set("target", target);
      c.set("shared", !isPreviewHost(host, this.config.previewOrigin, this.config.host));
      await next();
      for (const [name, value] of Object.entries(COMMON_HEADERS)) c.res.headers.set(name, value);
    });

    const respond = (served: {
      status: number;
      headers: Record<string, string>;
      body?: Uint8Array;
    }) => new Response(served.body ?? null, { status: served.status, headers: served.headers });

    const rangeOf = (c: Context) => ({
      range: c.req.header("range") ?? null,
      ifRange: c.req.header("if-range") ?? null,
      ifNoneMatch: c.req.header("if-none-match") ?? null,
      version: c.req.query("v") ?? null,
    });

    app.get("/:key/play", async (c) => {
      const target = c.get("target");
      // Loom's player.html query (see play-query.ts). The key names the activity: a
      // `module`, `ref` or `source` that names another is refused, never followed.
      const query = readPlayQuery((name) => c.req.query(name));
      const refused =
        query.refError ??
        query.sourceError ??
        (await this.sandbox.playLinkMismatch(target.projectId, target.activityId, query));
      if (refused)
        return c.text(refused, 400, {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
      return playerPageResponse(this.sandbox, target, query, c.get("shared"));
    });

    app.get("/:key/player/*", async (c) =>
      respond(await this.sandbox.playerFile(rest(c, "/player/"))),
    );

    app.get("/:key/module/*", async (c) => {
      const target = c.get("target");
      return respond(
        await this.sandbox.moduleFile(
          target.projectId,
          target.activityId,
          rest(c, "/module/"),
          target.runId ?? null,
        ),
      );
    });

    app.get("/:key/navbar/*", async (c) =>
      respond(await this.sandbox.navbarFile(rest(c, "/navbar/"))),
    );

    app.get("/:key/media/*", async (c) => {
      const target = c.get("target");
      return respond(
        await this.sandbox.media(
          target.projectId,
          target.activityId,
          rest(c, "/media/"),
          rangeOf(c),
        ),
      );
    });

    for (const resource of ["layouts", "css", "images", "audio"] as FrameworkResource[]) {
      app.get(`/:key/${resource}/*`, async (c) =>
        respond(await this.sandbox.frameworkFile(resource, rest(c, `/${resource}/`), rangeOf(c))),
      );
    }

    // The framework's configuration request, in both API versions and both shapes: by
    // product mapping and by activity version. Whatever ids it sends, the key names the
    // activity; the language, start scene and resolution ride on the query, set by the player.
    const configuration = async (c: Context<PlayEnv>) => {
      const target = c.get("target");
      const query = readPlayQuery((name) => c.req.query(name));
      const activity = await this.sandbox.payload(target.projectId, target.activityId, {
        languageCode: query.languageCode,
        startSceneId: query.startSceneId,
        resolution: query.resolution,
        base: playBase(c.req.param("key") ?? ""),
        runId: target.runId ?? null,
      });
      c.header("Cache-Control", "no-store");
      return c.json({ data: { attributes: { activity } } });
    };
    for (const version of ["v2", "v3"]) {
      app.get(`/:key/activity/${version}/configuration/activities/mapping`, configuration);
      app.get(
        `/:key/activity/${version}/configuration/activities/:id/version/:version`,
        configuration,
      );
    }

    // The assessment service, emulated (see sandbox-assessment.ts): a POST starts a session
    // or continues the one its score id names. Whatever key and student the framework sends,
    // the key names the activity.
    const assess = async (c: Context<PlayEnv>) => {
      const target = c.get("target");
      let body: unknown = null;
      try {
        body = await c.req.json();
      } catch {
        // A first request may carry no body at all.
      }
      const data = (body as { data?: unknown } | null)?.data;
      const part = await this.sandbox.assess(
        target.projectId,
        target.activityId,
        playBase(c.req.param("key") ?? ""),
        c.req.param("scoreId") ?? null,
        Array.isArray(data) ? data : [],
        target.runId ?? null,
      );
      c.header("Cache-Control", "no-store");
      return c.json(part);
    };
    for (const version of ["v2", "v3"]) {
      for (const mode of ["assess", "preview/assess"]) {
        const at = `/:key/assessment/${version}/apps/:app/assessments/:key/versions/:version/orgs/:org/students/:student/${mode}`;
        app.post(at, assess);
        app.post(`${at}/:scoreId`, assess);
      }
    }

    // The app configuration the framework loads at start. A preview has none.
    app.get("/:key/configuration/v3/apps/:app/configurations", (c) =>
      c.json({ data: { attributes: {} } }),
    );

    this.routes = app as unknown as Hono;
  }
}
