/**
 * Loom's `/player.html` address, wired by hand, so what it answers can be pinned without a
 * project on disk: Loom's order and words for a link it cannot play, and no sign-in asked
 * for. The way to a played ref is activity-play-routes.test.ts's.
 */
import { describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import { ActivityPlayerHtmlRoutes } from "../src/activities/player-html-routes.js";

function player() {
  const routes = wire(ActivityPlayerHtmlRoutes, {
    config: { trustProxy: false },
    projects: { listAll: () => [{ projectId: "p1" }] },
    sandbox: { playCandidates: async () => [] },
  });
  routes.setup();
  return (query: string) => routes.routes.request(`http://localhost/?${query}`);
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

  it("answers a visitor with no sign-in as Loom's player does", async () => {
    const response = await player()("module=m2ab01&ref=1");
    expect(response.status).toBe(404);
    expect(await words(response)).toBe("Failed to load module metadata for &quot;m2ab01&quot;.");
  });
});
