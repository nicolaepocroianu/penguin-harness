/**
 * The product's assessment, written by an agent from the specification: the questions the
 * screens imply, and the assessment that must cover them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../http/errors.js";
import { readCandidate } from "../artifact.js";
import { coverageProblem } from "../assessment-hints.js";
import { normalizeAssessment, parseHints, writtenItems } from "../assessment-document.js";
import type { AssessmentRun } from "../domain.js";
import { validateAssessment } from "../module-overrides.js";
import type { RunRequestOf } from "../run-request.js";
import { atomicJson } from "../service.js";
import {
  DOCUMENT_RUN_MS,
  RunRefusal,
  authoringSkill,
  hasValidSpec,
  requireCompleted,
  type SessionRunKind,
} from "./contract.js";
import { ASSESSMENT_PROMPT } from "../prompts/assessment.js";

/** The assessment skill a run follows, staged into its workspace under a file name of its own. */
const ASSESSMENT_SKILL = "waf-assessment-patterns";
const ASSESSMENT_SKILL_FILE = "assessment-skill.md";
const ASSESSMENT_FILE = "assessment.json";
const ASSESSMENT_HINTS_FILE = "assessment-hints.json";

/** The assessment prompt: its text is in prompts/assessment.ts. */
export const assessmentPrompt = ASSESSMENT_PROMPT({
  ASSESSMENT_FILE,
  ASSESSMENT_HINTS_FILE,
  ASSESSMENT_SKILL_FILE,
});

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

type AssessmentRequest = RunRequestOf<"assessment">["assessment"];

export const assessmentKind: SessionRunKind<
  RunRequestOf<"assessment">,
  AssessmentRequest,
  AssessmentRun
> = {
  run: "assessment",
  runner: "session",
  // An assessment is written from the specification.
  needsScript: false,
  // It writes the hints and the assessment, two documents, and runs no program.
  limits: { wallClockMs: DOCUMENT_RUN_MS },
  async check(services, request, activity) {
    if (!hasValidSpec(activity))
      throw new HttpError(
        400,
        "assessment_spec_required",
        "Save a valid specification before generating the assessment.",
      );
    const runtime = activity.draft.spec!.runtime as { usesAssessment?: unknown } | undefined;
    if (runtime?.usesAssessment !== true)
      throw new RunRefusal(
        409,
        "assessment_unused",
        "The specification says this activity has no assessment.",
        "noAssessment",
      );
    // Every ref of the product shares one assessment, and only the canonical ref owns it.
    if (!services.activities.isCanonicalRef(activity))
      throw new RunRefusal(
        409,
        "not_canonical",
        "The assessment is shared by every ref of this product. Generate it on the canonical ref.",
        "notCanonical",
      );
    return request.assessment;
  },
  record: () => ({}),
  async stage({ activity, prepared, workspace }) {
    const skill = authoringSkill(ASSESSMENT_SKILL, "assessment_skill_missing", "assessment skill");
    await atomicJson(path.join(workspace, "activity-spec.json"), activity.draft.spec);
    if (prepared.current)
      await atomicJson(path.join(workspace, "current-assessment.json"), prepared.current);
    await fs.writeFile(path.join(workspace, ASSESSMENT_SKILL_FILE), skill, { flag: "wx" });
  },
  prompt: () => assessmentPrompt,
  outputs: [ASSESSMENT_FILE, ASSESSMENT_HINTS_FILE],
  async collect({ services, run, workspace, observed, save }) {
    requireCompleted(observed, "Assessment Session did not complete.");
    const hints = parseHints(
      parseJson(
        await readCandidate(path.join(workspace, ASSESSMENT_HINTS_FILE), 256 * 1024),
        ASSESSMENT_HINTS_FILE,
      ),
    );
    const input = await services.activities.getActivity(run.projectId, run.activityId);
    const data = normalizeAssessment(
      parseJson(await readCandidate(path.join(workspace, ASSESSMENT_FILE)), ASSESSMENT_FILE),
      input.productCode,
      services.activities.productOf(input)?.canonicalRefNum ?? input.refNum,
    );
    validateAssessment(data);
    const missing = coverageProblem(writtenItems(data), hints);
    if (missing) throw new Error(missing);
    run.candidate = JSON.stringify(data);
    save(run);
    return { kept: true, draftChanged: "The draft changed during assessment generation." };
  },
  /**
   * Kept as the product's assessment edit, the way an author's own save keeps one: only a
   * successful run, and only on the draft it was generated from.
   */
  accept: {
    changed: {
      code: "assessment_changed",
      message: "Only a successful assessment candidate can be accepted.",
    },
    draftChanged: async () =>
      new HttpError(
        409,
        "draft_conflict",
        "The draft changed since the assessment was generated. Generate a new one.",
      ),
    apply: (services, run, expectedRevision) =>
      services.activities.setModuleDocument(
        run.projectId,
        run.activityId,
        "assessment",
        JSON.parse(run.candidate) as unknown,
        expectedRevision,
      ),
  },
};
