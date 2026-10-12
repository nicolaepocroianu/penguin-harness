import { describe, expect, it } from "vitest";
import type { ApiFetchOptions } from "../src/api/client";
import { projectActivitiesApi, type ApiSend } from "../src/features/activities/activity-api";
import { memoryActivity } from "./activity-memory-api";

/** Each request as METHOD path, and its body when it has one. */
const shown = (calls: readonly { method: string; path: string; body?: unknown }[]) =>
  calls.map((call) => [call.method, call.path, ...(call.body === undefined ? [] : [call.body])]);

describe("the activity client's routes", () => {
  it("builds each activity route's path and body in one place", () => {
    const { api, calls } = memoryActivity();
    void api.videoTimeline("en-US", "intro video");
    void api.moduleBuilds.pin(null, "r1");
    void api.moduleBuilds.pin("run 2", "r1");
    void api.versions.restore("v/1", "r1");
    void api.ref.renumber(7, "r1");
    void api.ref.remove();
    void api.deploy.log("run_1", 40);
    void api.moduleDocuments.save("assessment", { items: [] }, "r1");
    expect(shown(calls)).toEqual([
      ["GET", "video-timeline?language=en-US&assetKey=intro%20video"],
      ["POST", "module-builds/unpin", { expectedRevision: "r1" }],
      ["POST", "module-builds/run%202/pin", { expectedRevision: "r1" }],
      ["POST", "versions/v%2F1/restore", { expectedRevision: "r1" }],
      ["POST", "ref-number", { refNum: 7, expectedRevision: "r1" }],
      ["DELETE", ""],
      ["GET", "deploy/runs/run_1/log?after=40"],
      ["PUT", "module-documents/assessment", { value: { items: [] }, expectedRevision: "r1" }],
    ]);
  });

  it("reaches the project's activities, and another activity of it", () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const send: ApiSend = <T>(path: string, options: ApiFetchOptions = {}) => {
      calls.push({ method: options.method ?? "GET", path, body: options.body });
      return new Promise<T>(() => {});
    };
    const project = projectActivitiesApi("p 1", send);
    void project.list(true);
    void project.refs("c1");
    void project.create({ productCode: "words" });
    void project.sceneLooks();
    void project.activity("a 2").pipeline.start({ stage: "assets" });
    expect(shown(calls)).toEqual([
      ["GET", "/api/projects/p%201/activities?summary=1"],
      ["GET", "/api/projects/p%201/activities?collectionId=c1"],
      ["POST", "/api/projects/p%201/activities", { productCode: "words" }],
      ["GET", "/api/projects/p%201/activities/scene-looks"],
      ["POST", "/api/projects/p%201/activities/a%202/pipeline", { stage: "assets" }],
    ]);
  });
});
