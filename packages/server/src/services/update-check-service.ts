/**
 * Update-check service: resolves the newest published release from the GitHub Releases
 * API and compares it with the running version (core's VERSION), for the web UI's
 * update reminder (GET /api/version/update-check).
 *
 * This is the server's only outbound internet call, so it is strictly fail-soft: check()
 * never throws and never surfaces an upstream failure as a 5xx — a failed lookup returns
 * a normal response with `error` set and `latestVersion` null. Outcomes are cached
 * in-memory (success for 1 hour, failure for 10 minutes) so a sidebar that opens on every
 * page load cannot hammer GitHub's unauthenticated rate limit; concurrent requests share
 * one in-flight lookup. `PENGUIN_UPDATE_CHECK=off` disables the lookup entirely (no
 * network call), for air-gapped or privacy-sensitive deployments. A build whose repository
 * publishes no releases (core's RELEASE_IDENTITY) answers the same way: there is nothing it
 * should be offered, and every release out there is another repository's.
 *
 * The request mirrors the CLI's fetchLatestVersion (packages/cli/src/commands/update.ts):
 * same endpoint, same accept / user-agent header shape, same 15s timeout — the server
 * cannot import the CLI package (the dependency runs the other way), hence the small
 * duplication. fetch and the clock are injectable so tests never touch the network.
 */
import {
  BUILD_DATE,
  RELEASE_IDENTITY,
  VERSION,
  compareVersions,
  normalizeVersion,
} from "@prismshadow/penguin-core";
import type { ReleaseIdentity } from "@prismshadow/penguin-core";
import type { UpdateCheckResponse } from "../api/types.js";
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Hono } from "hono";
import type { ClassCtx, Opaque } from "@prismshadow/penguin-core/kernel";
import { versionRoutes } from "../http/routes/version.js";
import type { Clock, Config, Lifecycle } from "../hmr/capabilities.js";
import type { UpdateJob } from "./update-job.js";

/** How long a successful lookup is served from cache. */
export const SUCCESS_TTL_MS = 60 * 60 * 1000;
/** How long a failed lookup is served from cache (short: transient failures should heal). */
export const FAILURE_TTL_MS = 10 * 60 * 1000;

/** The network, as the update check reaches it; a test stands in a canned one. */
export abstract class HttpFetch extends Interface<{
  fetch(
    input: string,
    init?: Opaque<"RequestInit", RequestInit>,
  ): Promise<Opaque<"Response", Response>>;
}>() {}
@Component()
export class GlobalFetch implements HttpFetch {
  fetch(input: string, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }
}

@Component()
export class UpdateCheckService implements UpdateCheck {
  @Use() private readonly http!: HttpFetch;
  @Use() private readonly clock!: Clock;
  /** Environment to read PENGUIN_UPDATE_CHECK from; a test wires its own. */
  private env: Record<string, string | undefined> = process.env;
  /** Where releases come from, and whether there are any; a test wires its own. */
  private identity: ReleaseIdentity = RELEASE_IDENTITY;
  private cached: { response: UpdateCheckResponse; expiresAt: number } | null = null;
  private inflight: Promise<UpdateCheckResponse> | null = null;

  /**
   * Never throws; never makes a network call when disabled or (without `force`) while
   * the cache is fresh. `force` — the web's manual "check for updates" action — skips
   * the freshness check and performs a real lookup even over a warm cache: the cache
   * exists to shield GitHub's unauthenticated rate limit from *passive* checks fired
   * by every sidebar open, and an explicit user click is rare enough to press through
   * it. Everything else is unchanged: the opt-out stays authoritative (force never
   * dials out under PENGUIN_UPDATE_CHECK=off, nor for a repository that publishes no
   * releases), the outcome lands in the same cache
   * (subsequent passive checks reuse it), and concurrent callers — forced or not —
   * still share one in-flight lookup.
   */
  async check(force = false): Promise<UpdateCheckResponse> {
    if (this.env["PENGUIN_UPDATE_CHECK"] === "off" || !this.identity.publishesReleases) {
      return {
        currentVersion: VERSION,
        buildDate: BUILD_DATE,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        publishedAt: null,
        checkedAt: this.clock.now().toISOString(),
        disabled: true,
      };
    }
    if (!force && this.cached && this.clock.now().getTime() < this.cached.expiresAt) {
      return this.cached.response;
    }
    this.inflight ??= this.lookup().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** One real lookup; stores the outcome (success or failure) in the cache with its TTL. */
  private async lookup(): Promise<UpdateCheckResponse> {
    const response = await this.resolveLatest();
    const ttl = response.error === undefined ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    this.cached = { response, expiresAt: this.clock.now().getTime() + ttl };
    return response;
  }

  /**
   * Failure taxonomy mirrors the CLI's fetchLatestVersion: an unreachable endpoint or
   * timeout is "network"; a 403/429 is "rate_limited" (unauthenticated clients hit
   * GitHub's per-IP limit); any other non-2xx status, an unparsable body, or a body
   * without a usable tag_name is "bad_response".
   */
  private async resolveLatest(): Promise<UpdateCheckResponse> {
    const checkedAt = this.clock.now().toISOString();
    const base = { currentVersion: VERSION, buildDate: BUILD_DATE, checkedAt };
    const failure = (error: "network" | "rate_limited" | "bad_response"): UpdateCheckResponse => ({
      ...base,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      publishedAt: null,
      error,
    });

    // The Releases API endpoint for the newest release this build's repository published.
    const latestReleaseApi = `https://api.github.com/repos/${this.identity.repository}/releases/latest`;
    let res: Response;
    try {
      res = await this.http.fetch(latestReleaseApi, {
        headers: { accept: "application/vnd.github+json", "user-agent": "penguin-server" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return failure("network");
    }
    if (res.status === 403 || res.status === 429) return failure("rate_limited");
    if (!res.ok) return failure("bad_response");

    let body: { tag_name?: unknown; html_url?: unknown; published_at?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return failure("bad_response");
    }
    const tag = typeof body.tag_name === "string" ? normalizeVersion(body.tag_name) : "";
    if (tag === "") return failure("bad_response");
    return {
      ...base,
      latestVersion: tag,
      updateAvailable: compareVersions(tag, VERSION) > 0,
      releaseUrl: typeof body.html_url === "string" ? body.html_url : null,
      publishedAt: typeof body.published_at === "string" ? body.published_at : null,
    };
  }
}

export abstract class UpdateCheck extends Interface<Pick<UpdateCheckService, "check">>() {}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "VersionModule.routes",
        prefix: "/api/version",
        auth: "user",
        order: 20,
      },
    ],
  },
})
export class VersionRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly updateCheck!: UpdateCheck;
  @Use() private readonly updateJob!: UpdateJob;
  @Use() private readonly lifecycle!: Lifecycle;
  @Bind("VersionModule.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = versionRoutes({
      config: this.config,
      updateCheck: this.updateCheck,
      updateJob: this.updateJob,
      lifecycle: this.lifecycle,
    });
  }
}
