import { describe, expect, it } from "vitest";
import {
  RUNTIME_PROMPT_MAX,
  admitRuntimeAi,
  declaresRuntimeAi,
  refusalStatus,
  type AdmissionState,
} from "../src/activities/runtime-ai.js";

const open: AdmissionState = { busy: false, declared: true, playable: true };

describe("admitting a runtime AI call", () => {
  it("allows one when the activity declared it and nothing is in flight", () => {
    expect(admitRuntimeAi(open, "What rhymes with cat?")).toBeNull();
  });

  it("refuses an activity that never declared a runtime AI service", () => {
    const refusal = admitRuntimeAi({ ...open, declared: false }, "hello");
    expect(refusal?.kind).toBe("not_declared");
    expect(refusal?.message).toContain("does not declare a runtime AI service");
  });

  it("refuses an undeclared activity even while busy, rather than saying try again", () => {
    // Telling it to wait its turn would hide a generated module calling an endpoint
    // nobody granted it.
    const refusal = admitRuntimeAi({ busy: true, declared: false, playable: true }, "hello");
    expect(refusal?.kind).toBe("not_declared");
  });

  it("refuses when there is no playable preview at all", () => {
    const refusal = admitRuntimeAi({ ...open, playable: false }, "hello");
    expect(refusal?.kind).toBe("not_playable");
  });

  it("checks playability before anything else", () => {
    const refusal = admitRuntimeAi({ busy: true, declared: false, playable: false }, "");
    expect(refusal?.kind).toBe("not_playable");
  });

  it("refuses an empty, blank or non-string prompt", () => {
    for (const bad of ["", "   ", undefined, null, 42, {}])
      expect(admitRuntimeAi(open, bad)?.kind, String(bad)).toBe("prompt_invalid");
  });

  it("refuses a prompt past the cap, and says how long it was", () => {
    const refusal = admitRuntimeAi(open, "x".repeat(RUNTIME_PROMPT_MAX + 1));
    expect(refusal?.kind).toBe("prompt_invalid");
    expect(refusal?.message).toContain(String(RUNTIME_PROMPT_MAX + 1));
  });

  it("allows a prompt exactly at the cap", () => {
    expect(admitRuntimeAi(open, "x".repeat(RUNTIME_PROMPT_MAX))).toBeNull();
  });

  it("refuses a second call while one is in flight", () => {
    const refusal = admitRuntimeAi({ ...open, busy: true }, "hello");
    expect(refusal?.kind).toBe("busy");
  });

  it("checks the prompt before busyness, so a bad prompt is not mistaken for a queue", () => {
    expect(admitRuntimeAi({ ...open, busy: true }, "")?.kind).toBe("prompt_invalid");
  });
});

describe("the status a refusal deserves", () => {
  it("is 403 for an undeclared capability, not 404", () => {
    // The endpoint exists; this activity may not use it.
    expect(refusalStatus({ kind: "not_declared", message: "" })).toBe(403);
  });

  it("is 409 for busy and for an unplayable preview", () => {
    expect(refusalStatus({ kind: "busy", message: "" })).toBe(409);
    expect(refusalStatus({ kind: "not_playable", message: "" })).toBe(409);
  });

  it("is 400 for a bad prompt", () => {
    expect(refusalStatus({ kind: "prompt_invalid", message: "" })).toBe(400);
  });
});

describe("reading the declaration off a specification", () => {
  it("is declared only by an explicit true", () => {
    expect(declaresRuntimeAi({ runtime: { usesAiService: true } })).toBe(true);
    expect(declaresRuntimeAi({ runtime: { usesAiService: false } })).toBe(false);
    expect(declaresRuntimeAi({ runtime: { usesAiService: "yes" } })).toBe(false);
  });

  it("is not declared when the runtime block or the specification is absent", () => {
    expect(declaresRuntimeAi({ runtime: {} })).toBe(false);
    expect(declaresRuntimeAi({})).toBe(false);
    expect(declaresRuntimeAi(null)).toBe(false);
  });

  it("survives a runtime block that is not an object", () => {
    expect(declaresRuntimeAi({ runtime: "html" })).toBe(false);
    expect(declaresRuntimeAi({ runtime: [] })).toBe(false);
  });
});
