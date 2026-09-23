/**
 * The page a played preview is served as.
 *
 * Two things have to hold. What the player is told about the activity must reach it intact,
 * whatever an author put in a title. And the page must know when its link runs out: every
 * picture and sound it fetches rides on that link, so past it the activity would otherwise
 * break a file at a time and look faulty rather than expired.
 */
import { describe, expect, it } from "vitest";
import { playerPage, type PlayerPageInput } from "../src/activities/sandbox-player.js";

const input: PlayerPageInput = {
  base: "/preview/activity/token/",
  title: "Jobs",
  moduleId: "r2pt01",
  productCode: "r2pt01",
  refNum: 156,
  hasAssessment: false,
  resolution: "1024x768",
  languageCode: "en-US",
  startSceneId: null,
  expiresAt: 1_790_000_000_000,
};

function configuration(html: string): Record<string, unknown> {
  const match = /<script type="application\/json" id="penguin-sandbox">([\s\S]*?)<\/script>/.exec(
    html,
  );
  return JSON.parse(match![1]!) as Record<string, unknown>;
}

describe("the page a played preview is served as", () => {
  it("tells the player the activity and when its link expires", () => {
    const html = playerPage(input);
    expect(configuration(html)).toMatchObject({ refNum: 156, expiresAt: 1_790_000_000_000 });
    expect(html).toContain('id="playerExpired"');
    expect(html).toContain('src="/preview/activity/token/player/player.js"');
  });

  it("keeps a title that looks like markup from ending the configuration early", () => {
    const html = playerPage({ ...input, title: "</script><script>alert(1)</script>" });
    expect(configuration(html).title).toBe("</script><script>alert(1)</script>");
    expect(html).toContain("<title>&lt;/script&gt;");
  });
});
