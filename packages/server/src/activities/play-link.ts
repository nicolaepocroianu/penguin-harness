/**
 * Where an author is sent to play an activity: Loom's dev-sandbox address on the sandbox
 * origin, `<origin>/player.html?module=<product>&ref=<n>&…`, as Loom's preview links read
 * (waf-loom `SandboxService.preview_url`). Deployed, that origin is `dev-sandbox.<zone>`, the
 * configured preview origin. The play query is carried on in Loom's names, with the App
 * origin that asked as `parent`. Shared by the activity's own play entry and `/player.html`
 * on the App's host.
 */
import type { Context } from "hono";
import type { Config } from "../hmr/capabilities.js";
import { requestOrigin } from "../http/routes/model-oauth.js";
import type { Projects } from "../mechanisms/projects.js";
import { resolvePreviewTarget } from "../services/preview-token.js";
import { parsePlayParent, playQueryString, type PlayQuery } from "./play-query.js";
import type { ActivitySandbox } from "./sandbox-service.js";

/** Loom's player address, for a query that already names the product and ref. */
export const PLAYER_PATH = "/player.html";

/** The App origin this request reached the App on; proxy headers only where trusted. */
export function askingOrigin(c: Context, config: Config): string | null {
  return parsePlayParent(
    requestOrigin(
      c.req.url,
      {
        ...(c.req.header("x-forwarded-proto") !== undefined
          ? { proto: c.req.header("x-forwarded-proto")! }
          : {}),
        ...(c.req.header("x-forwarded-host") !== undefined
          ? { host: c.req.header("x-forwarded-host")! }
          : {}),
      },
      config.trustProxy,
    ),
  );
}

/** `/player.html?…` on the sandbox origin, or on this host when there is none (sandboxed). */
export function playerAddress(
  c: Context,
  config: Config,
  query: PlayQuery,
  project: string | null,
): string {
  const target = resolvePreviewTarget(
    c.req.url,
    c.req.header("host"),
    config.previewOrigin,
    config,
  );
  const params = new URLSearchParams(
    playQueryString({ ...query, parentOrigin: askingOrigin(c, config) }),
  );
  if (project) params.set("project", project);
  return `${target?.origin ?? ""}${PLAYER_PATH}?${params}`;
}

export async function playLocation(
  c: Context,
  deps: { config: Config; sandbox: ActivitySandbox; projects: Projects },
  projectId: string,
  activityId: string,
  query: PlayQuery,
): Promise<string> {
  const address = await deps.sandbox.playAddress(projectId, activityId);
  // Loom's link names no project. One is added only when the ref is open in several, as
  // `/player.html` would otherwise ask which.
  const elsewhere = (
    await deps.sandbox.playCandidates(
      deps.projects.listAll().map((row) => row.projectId),
      address.productCode,
    )
  ).filter((each) => each.refNum === address.refNum && each.projectId !== projectId);
  return playerAddress(
    c,
    deps.config,
    {
      ...query,
      module: address.productCode,
      ref: address.refNum,
      source: query.source ?? address.source,
    },
    elsewhere.length ? projectId : null,
  );
}
