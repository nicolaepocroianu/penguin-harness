import { describe, expect, it } from "vitest";
import { buildReadiness } from "../src/activities/build-readiness.js";
import { contentRevision, type ActivityDetail } from "../src/activities/domain.js";

const usage = [{ sceneId: "intro", sourceKey: "k", occurrence: 1, sceneOccurrenceCount: 1 }];
const spec = { id: "words", title: "Words", activityDescription: "d", scenes: [] };

function activity(overrides: Partial<ActivityDetail["draft"]> = {}): ActivityDetail {
  return {
    draft: {
      description: "Scene 1: Intro",
      status: "valid",
      spec,
      mediaPlan: {
        specRevision: contentRevision(spec),
        requirements: {},
        manifest: {
          productCode: "words",
          refNum: 1,
          assets: {
            "es-MX": [{ key: "hi", type: "audio", description: "", script: "Hola", usages: usage }],
            "en-US": [
              {
                key: "hi",
                type: "audio",
                description: "",
                script: "Hi",
                path: "hi.wav",
                usages: usage,
              },
              { key: "bye", type: "audio", description: "", script: "Bye", usages: usage },
              { key: "cat", type: "image", description: "Cat", path: "cat.png", usages: usage },
            ],
          },
        },
      },
      ...overrides,
    },
  } as unknown as ActivityDetail;
}

describe("build readiness", () => {
  it("counts speech per language, the default language first, and coverage against it", () => {
    expect(buildReadiness(activity(), { canonical: true, checkoutFound: true })).toEqual([
      { id: "script", level: "ok" },
      { id: "spec", level: "ok" },
      { id: "plan", level: "ok", state: "current" },
      { id: "speech", level: "warn", language: "en-US", bound: 1, total: 2 },
      { id: "speech", level: "warn", language: "es-MX", bound: 0, total: 1 },
      { id: "coverage", level: "warn", language: "es-MX", covered: 1, total: 2 },
      { id: "media", level: "ok", bound: 1, total: 1 },
      { id: "canonical", level: "ok" },
      { id: "checkout", level: "ok", found: true },
    ]);
  });

  it("fails what assembly refuses: an invalid spec, a stale plan, another ref's module, no checkout", () => {
    const checks = buildReadiness(
      activity({ status: "draft", spec: { ...spec, title: "Changed" } }),
      { canonical: false, checkoutFound: false },
    );
    const level = (id: string) => checks.find((check) => check.id === id)!.level;
    expect(level("spec")).toBe("fail");
    expect(checks.find((check) => check.id === "plan")).toMatchObject({
      level: "fail",
      state: "stale",
    });
    expect(level("canonical")).toBe("fail");
    expect(level("checkout")).toBe("fail");
  });

  it("only warns about a missing plan, which assembles a module without media", () => {
    const checks = buildReadiness(activity({ mediaPlan: undefined }), {
      canonical: true,
      checkoutFound: true,
    });
    expect(checks.find((check) => check.id === "plan")).toEqual({
      id: "plan",
      level: "warn",
      state: "missing",
    });
    expect(checks.some((check) => check.id === "speech")).toBe(false);
  });
});
