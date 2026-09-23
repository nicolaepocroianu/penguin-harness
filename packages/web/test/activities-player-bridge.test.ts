import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_MESSAGE,
  STATE_MESSAGE,
  highlightMessage,
  readPlayerReport,
} from "../src/features/activities/player-bridge";

const frame = { name: "player" };
const detail = { index: 3, phase: "active", sceneId: "scene-4", state: "awaitTap" };

describe("player bridge", () => {
  it("reads a state report from the player's own frame", () => {
    const report = readPlayerReport(
      {
        type: STATE_MESSAGE,
        detail,
        interactables: [
          { id: "rock_P", inputType: "CLICK", description: "Rock P", params: { x: 1 } },
          { id: "chest", inputType: "DRAG" },
        ],
      },
      frame,
      frame,
    );
    expect(report).toEqual({
      state: detail,
      interactables: [
        { id: "rock_P", inputType: "CLICK", description: "Rock P" },
        { id: "chest", inputType: "DRAG" },
      ],
    });
  });

  it("ignores any other window, and a frame that is not there", () => {
    const message = { type: STATE_MESSAGE, detail, interactables: [] };
    expect(readPlayerReport(message, { name: "other" }, frame)).toBeNull();
    expect(readPlayerReport(message, frame, null)).toBeNull();
    expect(readPlayerReport(message, null, null)).toBeNull();
  });

  it("ignores other message types and malformed state", () => {
    expect(readPlayerReport({ type: "other", detail }, frame, frame)).toBeNull();
    expect(readPlayerReport("text", frame, frame)).toBeNull();
    expect(
      readPlayerReport({ type: STATE_MESSAGE, detail: { ...detail, index: 1.5 } }, frame, frame),
    ).toBeNull();
    expect(
      readPlayerReport({ type: STATE_MESSAGE, detail: { ...detail, state: 7 } }, frame, frame),
    ).toBeNull();
    expect(
      readPlayerReport(
        { type: STATE_MESSAGE, detail: { ...detail, sceneId: "x".repeat(201) } },
        frame,
        frame,
      ),
    ).toBeNull();
  });

  it("drops tap targets it cannot vouch for, and caps how many it keeps", () => {
    const report = readPlayerReport(
      {
        type: STATE_MESSAGE,
        detail,
        interactables: [
          { id: "ok", inputType: "CLICK" },
          { id: "", inputType: "CLICK" },
          { id: "odd", inputType: "HOVER" },
          { id: "long", inputType: "CLICK", description: "d".repeat(201) },
          null,
          ...Array.from({ length: 150 }, (_, index) => ({ id: `t${index}`, inputType: "CLICK" })),
        ],
      },
      frame,
      frame,
    );
    expect(report!.interactables[0]).toEqual({ id: "ok", inputType: "CLICK" });
    // An overlong description is dropped, not the target.
    expect(report!.interactables[1]).toEqual({ id: "long", inputType: "CLICK" });
    expect(report!.interactables.length).toBeLessThanOrEqual(100);
  });

  it("treats a missing tap target list as none", () => {
    expect(readPlayerReport({ type: STATE_MESSAGE, detail }, frame, frame)!.interactables).toEqual(
      [],
    );
  });

  it("asks the player to outline one target, or none", () => {
    expect(highlightMessage("rock_P")).toEqual({ type: HIGHLIGHT_MESSAGE, id: "rock_P" });
    expect(highlightMessage(null)).toEqual({ type: HIGHLIGHT_MESSAGE, id: null });
  });
});
