import { describe, expect, it } from "vitest";
import { RELEASE_IDENTITY } from "@prismshadow/penguin-core/release-identity";
import { feedUrlOverride, updateSourceConfig, updateSupport } from "../src/update-support.js";

describe("updateSupport", () => {
  const releases = { publishesReleases: true };

  it("supports packaged macOS and Windows builds", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(
        updateSupport({ ...releases, isPackaged: true, profile: "release", platform, env: {} }),
      ).toEqual({
        supported: true,
      });
    }
  });

  it("supports Linux only when running as an AppImage", () => {
    const env = { APPIMAGE: "/opt/PenguinHarness.AppImage" };
    expect(
      updateSupport({ ...releases, isPackaged: true, profile: "release", platform: "linux", env }),
    ).toEqual({
      supported: true,
    });
    // A deb install has no APPIMAGE: updating around dpkg would desync the two.
    expect(
      updateSupport({
        ...releases,
        isPackaged: true,
        profile: "release",
        platform: "linux",
        env: {},
      }),
    ).toEqual({
      supported: false,
      reason: "linux-not-appimage",
    });
  });

  it("never updates a dev run, whatever the platform", () => {
    expect(
      updateSupport({
        ...releases,
        isPackaged: false,
        profile: "dev",
        platform: "darwin",
        env: { APPIMAGE: "/x" },
      }),
    ).toEqual({ supported: false, reason: "dev" });
  });

  it("never updates a packaged build on the dev profile: the installation is the release instance's", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(
        updateSupport({ ...releases, isPackaged: true, profile: "dev", platform, env: {} }),
      ).toEqual({
        supported: false,
        reason: "dev",
      });
    }
  });

  it("never updates a build whose repository publishes no releases, in any form", () => {
    const forms = [
      { isPackaged: true, profile: "release", platform: "win32", env: {} },
      { isPackaged: true, profile: "release", platform: "darwin", env: {} },
      {
        isPackaged: true,
        profile: "release",
        platform: "linux",
        env: { APPIMAGE: "/opt/PenguinHarness.AppImage" },
      },
      { isPackaged: true, profile: "release", platform: "linux", env: {} },
      { isPackaged: true, profile: "dev", platform: "win32", env: {} },
      { isPackaged: false, profile: "dev", platform: "darwin", env: {} },
    ] as const;
    for (const form of forms) {
      expect(updateSupport({ ...form, publishesReleases: false })).toEqual({
        supported: false,
        reason: "fork",
      });
    }
  });

  it("this build publishes no releases, so its updater stands down", () => {
    expect(
      updateSupport({
        isPackaged: true,
        profile: "release",
        platform: "win32",
        env: {},
        publishesReleases: RELEASE_IDENTITY.publishesReleases,
      }),
    ).toEqual({ supported: false, reason: "fork" });
  });
});

describe("feedUrlOverride", () => {
  it("accepts http(s) URLs and normalizes them", () => {
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: "http://127.0.0.1:8080/feed" })).toBe(
      "http://127.0.0.1:8080/feed",
    );
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: " https://example.com/u " })).toBe(
      "https://example.com/u",
    );
  });

  it("ignores unset, blank, non-http and unparseable values", () => {
    expect(feedUrlOverride({})).toBeNull();
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: "   " })).toBeNull();
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: "file:///etc/passwd" })).toBeNull();
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: "not a url" })).toBeNull();
  });
});

describe("updateSourceConfig", () => {
  it("defaults to auto with the speed probe on", () => {
    expect(updateSourceConfig({})).toEqual({
      source: "auto",
      probe: true,
      invalidSource: false,
      invalidProbe: false,
    });
  });

  it("accepts every source and the probe switch, trimming whitespace", () => {
    expect(updateSourceConfig({ PENGUIN_UPDATE_SOURCE: " oss " })).toMatchObject({
      source: "oss",
      invalidSource: false,
    });
    expect(updateSourceConfig({ PENGUIN_UPDATE_SOURCE: "github" })).toMatchObject({
      source: "github",
      invalidSource: false,
    });
    expect(updateSourceConfig({ PENGUIN_UPDATE_SOURCE: "auto" })).toMatchObject({
      source: "auto",
      invalidSource: false,
    });
    expect(updateSourceConfig({ PENGUIN_UPDATE_SPEED_PROBE: "1" })).toMatchObject({
      probe: true,
      invalidProbe: false,
    });
    expect(updateSourceConfig({ PENGUIN_UPDATE_SPEED_PROBE: " 0 " })).toMatchObject({
      probe: false,
      invalidProbe: false,
    });
  });

  it("treats unsupported values as defaults and flags them", () => {
    expect(
      updateSourceConfig({ PENGUIN_UPDATE_SOURCE: "mirror", PENGUIN_UPDATE_SPEED_PROBE: "2" }),
    ).toEqual({ source: "auto", probe: true, invalidSource: true, invalidProbe: true });
  });
});
