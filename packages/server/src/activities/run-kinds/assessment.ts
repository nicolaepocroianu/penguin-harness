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
import { authoringSkill, hasValidSpec, requireCompleted, type SessionRunKind } from "./contract.js";

/** The assessment skill a run follows, staged into its workspace under a file name of its own. */
const ASSESSMENT_SKILL = "waf-assessment-patterns";
const ASSESSMENT_SKILL_FILE = "assessment-skill.md";
const ASSESSMENT_FILE = "assessment.json";
const ASSESSMENT_HINTS_FILE = "assessment-hints.json";

/**
 * One run writes both the questions the screens imply and the assessment. The collector
 * checks the second covers the first.
 */
export const assessmentPrompt = `Write the WAF assessment for this activity. Work in this workspace.
Read and follow the WAF assessment skill in ${ASSESSMENT_SKILL_FILE}. The activity is described by description.md, input.json and activity-spec.json. If current-assessment.json exists, it is the assessment in use now: update it to match the specification rather than replacing it, and keep what still fits.
Write two files, each a JSON object without Markdown fences:
1. ${ASSESSMENT_HINTS_FILE}: {"items": [{"sceneId": "scene id", "source": "loading|speaker|selection", "question": "what the learner answers", "choices": ["exact on-screen choice", "..."], "correct": "the correct choice text"}]}. List every learner answer or selection screen, in the order the screens appear, including intermediate loading screens, speaker or choice screens and final answer screens. Skip screens marked instructional-only and screens that never ask the learner to choose. Use the exact on-screen text for each choice and for correct; leave correct out when the screen does not settle it. If description.md contains <items><item>...</item></items> blocks, each non-empty <item> block is one question, in order.
2. ${ASSESSMENT_FILE}: {"items": [...]} with one item per entry of ${ASSESSMENT_HINTS_FILE}, in the same order, each keeping that entry's choices and correct answer. An item is {"interactionKey": "SIMPLE_CHOICE" or "MULTIPLE_RESPONSE_CHOICE", "configuration": {"shuffle": boolean, "question": {"text": "..."}, "simpleChoice" or "multipleResponseChoice": [{"id": "string id", "isCorrect": boolean, "value": {"text": "..."}}]}}. Use only those two interactions. Every item needs non-empty question text and at least two choices with unique non-empty string ids and non-empty text; a SIMPLE_CHOICE item has exactly one correct choice, a MULTIPLE_RESPONSE_CHOICE item at least one. Do not copy <items> or <item> tags into the assessment. Do not include qa_, prod_ or dev_ keys. Titles, scores and the assessment's configuration are derived; you may leave them out.
Do not edit the input files. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing both files as valid JSON.`;

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
  async check(services, request, activity) {
    if (!hasValidSpec(activity))
      throw new HttpError(
        400,
        "assessment_spec_required",
        "Save a valid specification before generating the assessment.",
      );
    const runtime = activity.draft.spec!.runtime as { usesAssessment?: unknown } | undefined;
    if (runtime?.usesAssessment !== true)
      throw new HttpError(
        409,
        "assessment_unused",
        "The specification says this activity has no assessment.",
      );
    // Every ref of the product shares one assessment, and only the canonical ref owns it.
    if (!services.activities.isCanonicalRef(activity))
      throw new HttpError(
        409,
        "not_canonical",
        "The assessment is shared by every ref of this product. Generate it on the canonical ref.",
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
