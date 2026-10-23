/**
 * User-level server event stream: GET /api/events (SSE user channel).
 * Carries cross-Session notifications (reserved for automated tasks); sends a `hello` handshake event on connect.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { sseEndpoint, streamRevocation } from "../sse.js";
import type { ChannelHub } from "../../runtime/channel.js";
import type { ServerEvent } from "../../api/types.js";
import { Bind, Component, Use } from "@waterford/waf-harness-core/kernel";
import type { ClassCtx } from "@waterford/waf-harness-core/kernel";
import { Channels } from "../../hmr/capabilities.js";
import { LiveStreams } from "../../auth/live-streams.js";
import { Auth } from "../../mechanisms/identity.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface EventsRouteDeps {
  channels: ChannelHub;
  /** The registry that ends this stream when the session behind it is revoked. */
  liveStreams: LiveStreams;
  /** Re-validates the session behind an open stream, once per heartbeat. */
  auth: Auth;
}

/** The user channel's key in ChannelHub. */
export function userChannelKey(userId: string): string {
  return `user:${userId}`;
}

/**
 * Publishes `event` on the user channel of everyone who can open the Project: its owner and
 * its members. A user with no stream open is skipped; a Project that is gone reaches no one.
 */
export function publishToProjectUsers(
  channels: ChannelHub,
  projects: { findById(projectId: string): { ownerUserId: string } | null },
  members: { list(projectId: string): readonly { userId: string }[] },
  projectId: string,
  event: ServerEvent,
): void {
  const ownerUserId = projects.findById(projectId)?.ownerUserId;
  if (ownerUserId === undefined) return;
  const audience = new Set([ownerUserId, ...members.list(projectId).map((m) => m.userId)]);
  for (const userId of audience) {
    channels.peek(userChannelKey(userId))?.publish(event, "server_event");
  }
}

export function eventsRoutes(deps: EventsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    const channel = deps.channels.get(userChannelKey(c.var.user.userId));
    return sseEndpoint(c, channel, {
      initialEvents: [{ type: "hello" }],
      revocation: streamRevocation(c, c.var.user, deps),
      // The stream beats as well as pings: a machine's events reach the hub over this
      // endpoint, and both the hub and the browser end a stream that misses two beats
      // (machines/event-hub.ts, web api/socket.ts). A comment line is invisible to both.
      heartbeatEvent: true,
    });
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "EventsRoutes.routes",
        prefix: "/api/events",
        auth: "user",
        order: 60,
      },
    ],
  },
})
export class EventsRoutes {
  @Use() private readonly channels!: Channels;
  @Use() private readonly liveStreams!: LiveStreams;
  @Use() private readonly auth!: Auth;
  @Bind("EventsRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = eventsRoutes({
      channels: this.channels as ChannelHub,
      liveStreams: this.liveStreams,
      auth: this.auth,
    });
  }
}
