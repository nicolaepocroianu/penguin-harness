/**
 * Loom's `/player.html` address, wired by hand around a fake sign-in, so what it answers can
 * be pinned without a project on disk: Loom's order and words for a link it cannot play, and
 * a renewed sign-in that survives those answers. The way to a played ref is
 * activity-play-routes.test.ts's.
 */
import { describe, expect, it } from "vitest";
import { wire } from "@waterford/waf-harness-core/kernel";
import { ActivityPlayerHtmlRoutes } from "../src/activities/player-html-routes.js";

function player(options: { renewed?: boolean } = {}) {
  const routes = wire(ActivityPlayerHtmlRoutes, {
    auth: {
      sessionTtlMs: 60_000,
      authenticateApiToken: () => null,
      authenticateWithMeta: (token: string) =>
        token === "good"
          ? {
              user: { userId: "u1", isAdmin: false },
              via: "password",
              renewed: options.renewed ?? false,
            }
          : null,
    },
    config: { trustProxy: false },
    access: { accessibleProjectIds: () => ["p1"] },
    sandbox: { playCandidates: async () => [] },
  });
  routes.setup();
  return (query: string, cookie = "good") =>
    routes.routes.request(`http://localhost/?${query}`, {
      headers: cookie ? { cookie: `wafh_session=${cookie}` } : {},
    });
}

const words = async (response: Response) =>
  /<p id="activity">([^<]*)<\/p>/.exec(await response.text())?.[1];

describe("Loom's /player.html address", () => {
  it("asks for a module first, in Loom's words, before it reads the ref", async () => {
    const get = player();
    for (const query of ["ref=1", "", "ref=-1"]) {
      const response = await get(query);
      expect(response.status).toBe(400);
      expect(await words(response)).toBe("Missing module id in player URL.");
    }
  });

  it("keeps a renewed sign-in on a link it cannot play", async () => {
    const response = await player({ renewed: true })("module=m2ab01&ref=1");
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toContain("wafh_session=good");
  });

  it("sends a visitor who is not signed in to sign in", async () => {
    const response = await player()("module=m2ab01&ref=1", "");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });
});
