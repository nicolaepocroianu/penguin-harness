/**
 * The line under the "Confine activity agents" switch: what the setting means right now, in a
 * status tone — never the brand colour, which is for selection only.
 */
import { describe, expect, it } from "vitest";
import { activitySandboxLine } from "../src/features/settings/activity-sandbox-row";
import { S } from "../src/lib/strings";

const words = S.settings.wafWorkspace;

describe("activitySandboxLine", () => {
  it("says agents run confined when it is on and a sandbox is available", () => {
    expect(activitySandboxLine({ enabled: true, problem: null })).toEqual({
      tone: "success",
      text: words.confineAgentsReady,
    });
  });

  it("warns that runs will not start when it is on and no sandbox is available", () => {
    expect(
      activitySandboxLine({ enabled: true, problem: "no sandbox backend is mounted" }),
    ).toEqual({ tone: "danger", text: words.confineAgentsUnavailable });
  });

  it("says agents are not confined when an admin turned it off, whatever the sandbox", () => {
    for (const problem of [null, "no sandbox backend is mounted"]) {
      expect(activitySandboxLine({ enabled: false, problem })).toEqual({
        tone: "attention",
        text: words.confineAgentsOff,
      });
    }
  });
});
