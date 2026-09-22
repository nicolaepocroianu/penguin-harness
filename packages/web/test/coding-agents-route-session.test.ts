/**
 * coding-agents-page.tsx selectSessionFromRoute unit tests: a Quick Switcher pick reaches
 * the page as pushed location state, but the page's useState initializer only runs on first
 * mount — the effect re-applies the request on later navigations, and this decision is
 * pinned here. A push/replace naming a session always selects it; back/forward pops return
 * null so history navigation never yanks the selection away from what the user is reading.
 */
import { describe, expect, it } from "vitest";
import { selectSessionFromRoute } from "../src/features/coding-agents/coding-agents-page";

describe("selectSessionFromRoute", () => {
  it("selects the named session on a push while the page is already open", () => {
    expect(selectSessionFromRoute("sess-1", "PUSH")).toBe("sess-1");
  });

  it("treats a replace carrying a session as an explicit request too", () => {
    expect(selectSessionFromRoute("sess-2", "REPLACE")).toBe("sess-2");
  });

  it("never re-selects on back/forward pops", () => {
    expect(selectSessionFromRoute("sess-1", "POP")).toBe(null);
  });

  it("passes only well-formed session ids through", () => {
    expect(selectSessionFromRoute(null, "PUSH")).toBe(null);
    expect(selectSessionFromRoute(undefined, "PUSH")).toBe(null);
    expect(selectSessionFromRoute("", "PUSH")).toBe(null);
    expect(selectSessionFromRoute(42, "PUSH")).toBe(null);
    expect(selectSessionFromRoute({ sessionId: "sess-1" }, "PUSH")).toBe(null);
  });
});
