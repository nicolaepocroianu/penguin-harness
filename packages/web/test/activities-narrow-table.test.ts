import { describe, expect, it } from "vitest";
import { tableLayout } from "../src/features/activities/narrow-table";

describe("tableLayout", () => {
  it("keeps the table while its box is as wide as its columns need", () => {
    expect(tableLayout(1200, 880)).toBe("table");
    expect(tableLayout(880, 880)).toBe("table");
  });

  it("stacks one row per entry once the box is narrower than the columns need", () => {
    expect(tableLayout(879, 880)).toBe("stacked");
    // A side panel beside the work: the window is wide, the box is not.
    expect(tableLayout(520, 880)).toBe("stacked");
  });

  it("keeps the table before the box is measured, rather than flashing the stacked rows", () => {
    expect(tableLayout(0, 880)).toBe("table");
    expect(tableLayout(Number.NaN, 880)).toBe("table");
  });
});
