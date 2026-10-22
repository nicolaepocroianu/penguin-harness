import { describe, expect, it } from "vitest";
import { runErrorReason } from "../src/features/activities/history-section";

describe("a failed run's reason", () => {
  it("reads the message out of a provider's JSON error", () => {
    const raw =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits."}}';
    expect(runErrorReason(raw)).toBe("You have reached your specified API usage limits.");
  });

  it("keeps the first line of plain text", () => {
    expect(runErrorReason("The agent stopped.\nstack trace")).toBe("The agent stopped.");
  });

  it("falls back to the text when the braces are not JSON", () => {
    expect(runErrorReason("bad {thing")).toBe("bad {thing");
  });
});
