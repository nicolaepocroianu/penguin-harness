/**
 * Prompt text only (decision 18): what an assessment run's agent is told. Nothing here but text and
 * the names it is filled with: the bench lets a candidate recipe change this text and nothing
 * else, and run-kinds/assessment.ts fills it in.
 */

/**
 * One run writes both the questions the screens imply and the assessment. The collector
 * checks the second covers the first.
 */
export const ASSESSMENT_PROMPT = (values: {
  readonly ASSESSMENT_FILE: string;
  readonly ASSESSMENT_HINTS_FILE: string;
  readonly ASSESSMENT_SKILL_FILE: string;
}) =>
  `Write the WAF assessment for this activity. Work in this workspace.
Read and follow the WAF assessment skill in ${values.ASSESSMENT_SKILL_FILE}. The activity is described by description.md, input.json and activity-spec.json. If current-assessment.json exists, it is the assessment in use now: update it to match the specification rather than replacing it, and keep what still fits.
Write two files, each a JSON object without Markdown fences:
1. ${values.ASSESSMENT_HINTS_FILE}: {"items": [{"sceneId": "scene id", "source": "loading|speaker|selection", "question": "what the learner answers", "choices": ["exact on-screen choice", "..."], "correct": "the correct choice text"}]}. List every learner answer or selection screen, in the order the screens appear, including intermediate loading screens, speaker or choice screens and final answer screens. Skip screens marked instructional-only and screens that never ask the learner to choose. Use the exact on-screen text for each choice and for correct; leave correct out when the screen does not settle it. If description.md contains <items><item>...</item></items> blocks, each non-empty <item> block is one question, in order.
2. ${values.ASSESSMENT_FILE}: {"items": [...]} with one item per entry of ${values.ASSESSMENT_HINTS_FILE}, in the same order, each keeping that entry's choices and correct answer. An item is {"interactionKey": "SIMPLE_CHOICE" or "MULTIPLE_RESPONSE_CHOICE", "configuration": {"shuffle": boolean, "question": {"text": "..."}, "simpleChoice" or "multipleResponseChoice": [{"id": "string id", "isCorrect": boolean, "value": {"text": "..."}}]}}. Use only those two interactions. Every item needs non-empty question text and at least two choices with unique non-empty string ids and non-empty text; a SIMPLE_CHOICE item has exactly one correct choice, a MULTIPLE_RESPONSE_CHOICE item at least one. Do not copy <items> or <item> tags into the assessment. Do not include qa_, prod_ or dev_ keys. Titles, scores and the assessment's configuration are derived; you may leave them out.
Do not edit the input files. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing both files as valid JSON.`;
