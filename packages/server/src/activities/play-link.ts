/**
 * Where an authorised author is sent to play an activity: a signed, short-lived link on the
 * preview origin (see play-routes.ts), with the play query carried on in Loom's names. Shared
 * by the activity's own play entry and Loom's `/player.html` path.
 */
import type { Context } from "hono";
import type { Config } from "../hmr/capabilities.js";
import { requestOrigin } from "../http/routes/model-oauth.js";
import { hostOnly, requestAuthority, resolvePreviewTarget } from "../services/preview-token.js";
import { playQueryString, type PlayQuery } from "./play-query.js";
import { playBase } from "./play-routes.js";
import type { ActivitySandbox } from "./sandbox-service.js";

export async function signedPlayLocation(
  c: Context,
  deps: { config: Config; sandbox: ActivitySandbox },
  projectId: string,
  activityId: string,
  query: PlayQuery,
  /** Whether the link asked for a language; one that did not is carried on without one. */
  askedLanguage: boolean,
): Promise<string> {
  const target = resolvePreviewTarget(
    c.req.url,
    c.req.header("host"),
    deps.config.previewOrigin,
    deps.config,
  );
  // No separate preview origin: the page is served on the App's host, sandboxed.
  const host = target?.host ?? hostOnly(requestAuthority(c.req.url, c.req.header("host")));
  // The origin this author reached the App on: the only one the page may report its state
  // to. Proxy headers count only where the deployment says a proxy sets them.
  const parentOrigin = requestOrigin(
    c.req.url,
    {
      ...(c.req.header("x-forwarded-proto") !== undefined
        ? { proto: c.req.header("x-forwarded-proto")! }
        : {}),
      ...(c.req.header("x-forwarded-host") !== undefined
        ? { host: c.req.header("x-forwarded-host")! }
        : {}),
    },
    deps.config.trustProxy,
  );
  const { token } = await deps.sandbox.play(
    projectId,
    activityId,
    host,
    target === null,
    parentOrigin,
  );
  const search = playQueryString(query, { languageCode: askedLanguage });
  return `${target?.origin ?? ""}${playBase(token)}play${search ? `?${search}` : ""}`;
}
