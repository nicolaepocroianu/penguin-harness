---
name: waf-assessment-patterns
description: Use when generating or implementing WAF assessment-driven activity behavior, authoring module-local assessment JSON, or wiring SIMPLE_CHOICE and MULTIPLE_RESPONSE_CHOICE response submission for generated WAF modules.
---

# WAF Assessment Patterns

Use this skill when an activity has `runtime.usesAssessment: true`.

## Module Assessment File

Write module-local assessment JSON to:

```text
assessments/<product>-<refNum>.json
```

Use this root shape:

```json
{
  "title": "<product>-<refNum>",
  "configuration": {
    "maxItems": 1,
    "nextItemsSize": 1
  },
  "behavior": "LINEAR",
  "items": []
}
```

Do not include environment upload metadata in generated files:

- `qa_*`
- `prod_*`
- `dev_*`

## Module Runtime Helper

For assessed HTML sequence modules, keep assessment runtime wiring in:

```text
src/adapters/assessment.ts
```

Import the helper from an implementation under `src/activity/` (or
`src/sequence.js` in a legacy
module):

```js
import {
    initializeAssessmentRuntime,
    waitForAssessmentItem,
    submitSimpleChoiceAssessmentResponse,
    teardownAssessmentRuntime,
} from '../adapters/assessment';
```

Rules:

- The scaffolded assessment file (`src/adapters/assessment.ts`, or
  `src/assessment.js` for legacy
  modules) is a fixed runtime adapter. Do not modify, rewrite, or
  replace it. Only import and call its exported functions. The pipeline
  restores this file from a canonical template, so any local changes to it are
  discarded.
- For a legacy sequence module, call `initializeAssessmentRuntime(data)` during
  sequence initialization.
- For a State machine module, preserve the scaffolded
  `initializeAssessmentRuntime(data)` call in `createStateMachineImplementations`
  immediately after `initializeActivityContext(data)`. This subscribes before
  activity startup can publish the first assessment item. Without it, a passive
  opening scene can finish successfully and the first assessed scene can then
  wait forever for an item that was already published.
- For an State machine module, expose an idempotent
  `initializeAssessment` action that calls `initializeAssessmentRuntime(data)`
  and add its `{ type, params: { sceneId } }` descriptor to every top-level
  scene entry. These scene-entry calls are direct-preview safeguards and do not
  replace startup initialization. Preview start may enter any scene directly,
  so initialization only on the normal first scene is invalid.
- Call `waitForAssessmentItem(data)` before rendering each assessed item screen.
- Submit SIMPLE_CHOICE responses with `submitSimpleChoiceAssessmentResponse(data, item, choice)`.
- Submit exactly one response for each assessment item when that item's exercise is complete. Store the learner's first selected choice, whether it is correct or incorrect, and submit that stored choice at completion. If the activity offers corrective feedback and another on-screen attempt, do not replace the stored choice with the eventual correct choice.
- When a choice screen can replay option or student audio declared by another
  scene, give the replay action an explicit source-scene descriptor parameter
  such as `readingSceneId`. Resolve clips from that scene's catalog metadata;
  do not assume the choice scene owns the reading clips.
- Call `teardownAssessmentRuntime(data)` during sequence finalization.
- Give each assessed presentation action an `assessmentItemOffset` descriptor
  param. Before waiting for its item, call the assessment Adapter's
  `alignAssessmentForPreview(data, { sceneId, itemOffset })`; the Adapter applies
  the skip once from `__loomPreview.startSceneId` so previewed scenes consume the
  correct item.
- Do not hand-roll assessment queues in `src/sequence.js`.
- Do not publish assessment responses directly through unguarded `data.pubSub`; the helper owns pubSub resolution and validation.
- Do not hardcode generated assessment questions or choices into static JavaScript arrays.

For corrective choice interactions, keep the first response, disabled choices,
and retry count as durable round data while representing the input policy as
machine states. For example, use explicit `first-choice`, `second-choice`, and
`guided-choice` states when those policies differ. After retries are exhausted,
disable every incorrect option and reject any unexpected `CHOICE.SELECTED`
event without advancing. Do not hide this policy in a generic evaluation action.

## Item Coverage

Generate one assessment item for every learner answer or selection screen unless the screen is explicitly marked instructional-only.

This includes:

- Intermediate syllable or freight-box loading selections.
- Speaker or choice selections.
- Final word or answer selections.

For loading-box screens, the visible box labels come from the runtime assessment item's choice `value.text` values. Module-local code may keep presentation-only feedback, audio, and animation configuration keyed by choice text, but it must not keep the generated answer set as the source of truth in a static JavaScript array.

## Item Naming

Name items in order:

```text
<product>-<refNum>-1
<product>-<refNum>-2
<product>-<refNum>-3
```

Keep these titles stable. Module configuration can use assessment item titles as lookup keys.

## SIMPLE_CHOICE

Use `SIMPLE_CHOICE` for one selected answer.

```json
{
  "title": "<product>-<refNum>-1",
  "interactionKey": "SIMPLE_CHOICE",
  "configuration": {
    "shuffle": false,
    "question": {
      "text": "Question text"
    },
    "simpleChoice": [
      {
        "id": "0",
        "isCorrect": true,
        "score": 1,
        "value": {
          "text": "Correct answer"
        }
      },
      {
        "id": "1",
        "isCorrect": false,
        "score": 0,
        "value": {
          "text": "Distractor"
        }
      }
    ]
  }
}
```

Rules:

- Provide at least two choices.
- Mark exactly one choice with `isCorrect: true`.
- Use string `id` values.
- Use string `value.text` values.
- Set correct choice `score` to `1`; set all other scores to `0`.
- Store the learner's first selected choice, not the correct choice after remediation. Submit the stored choice once the UI flow for that item completes; a later correct choice may complete that flow but must not replace the stored assessment response.
- Match every input type to its callback: use `inputEventTypes.CLICK` with
  `onClick` for taps such as student replay or review stickers, and use
  `inputEventTypes.SELECT` with `onSelect` for press-and-hold choices. Never
  assign only `onSelect` to a `CLICK` interactable; timeout automation calls
  `onClick` directly.

```ts
const studentInteractable = new Interactable(student, inputEventTypes.CLICK);
studentInteractable.onClick = replayStudent;

const starInteractable = new Interactable(star, inputEventTypes.SELECT);
starInteractable.onSelect = submitAssessmentChoice;
```

- When a review/input arming action finds no eligible targets, defer its
  semantic “none available” event with `queueMicrotask(...)` and guard it with
  `onCancel(...)`. Do not send that transition event synchronously from state
  entry; it may arrive before the newly entered state can consume it.
- Every `interactable.onSelect` that records a choice MUST publish `activity:answerSubmitted` with `{ answer: { id, isCorrect, value } }` inside the handler, immediately after recording the answer and before `next()`. This event
  feeds telemetry at selection time — do **not** move it into `submitSimpleChoiceResponse` / `submitSimpleChoiceAssessmentResponse`, which runs later (or not at all, on early exit).

Submit responses as:

```json
{
  "item_score_id": "<runtime itemScoreId>",
  "choice_id": "<selected choice id>",
  "choice_value": "<selected value.text>"
}
```

## MULTIPLE_RESPONSE_CHOICE

Use `MULTIPLE_RESPONSE_CHOICE` when more than one choice may be correct.

```json
{
  "title": "<product>-<refNum>-1",
  "interactionKey": "MULTIPLE_RESPONSE_CHOICE",
  "configuration": {
    "shuffle": false,
    "question": {
      "text": "Question text"
    },
    "multipleResponseChoice": [
      {
        "id": "0",
        "isCorrect": true,
        "score": 1,
        "value": {
          "text": "Correct answer"
        }
      },
      {
        "id": "1",
        "isCorrect": true,
        "score": 1,
        "value": {
          "text": "Another correct answer"
        }
      },
      {
        "id": "2",
        "isCorrect": false,
        "score": 0,
        "value": {
          "text": "Distractor"
        }
      }
    ]
  }
}
```

Rules:

- Provide at least two choices.
- Mark at least one choice with `isCorrect: true`.
- Use string `id` values.
- Use string `value.text` values.
- Set correct choice scores to `1`; set all other scores to `0`.

Submit responses as:

```json
{
  "item_score_id": "<runtime itemScoreId>",
  "choices": [
    {
      "choice_id": "<selected choice id>",
      "choice_value": "<selected value.text>"
    }
  ]
}
```

## Runtime Behavior

For assessed sequence modules:

1. Wait for assessment items before rendering the question.
2. Read question and choice content from `data.assessmentItem.itemConfiguration`.
3. Create and attach the choice DOM before querying or populating those
   elements. Avoid duplicating `question.text` as prominent question text when
   narration already speaks it, but always provide an equivalent accessible
   instruction. Use a concise visible caption by default; when the activity
   explicitly requires a non-visual prompt, provide semantically associated
   screen-reader text instead.
4. When choices sit on top of scene media (a backdrop video or image with
   authored hotspots such as rocks), position each choice inside the same
   media-plane coordinate system as the media using percentage-based hotspot
   classes, per the waf-style-guardrails skill. Never position choices against
   the stage or lay them out in a flow grid over an `object-fit: cover` video,
   and do not invent decorative backgrounds (circles, stones, cards) behind
   choices that the description does not call for — display only the choice
   text/letter.
5. Use the runtime-provided `data.assessmentItem.itemScoreId` as `item_score_id`.
   Framework payloads may provide it as either a string or number; accept both
   forms and normalize with `String(...)` only when submitting the response.
6. Submit responses through the scaffolded assessment helper.
7. Continue until the assessment service reports completion.

Do not invent `item_score_id` in assessment JSON. The framework injects `itemScoreId` at runtime.

## Implementation preflight

For an State machine module, verify each top-level scene has the idempotent
`{ type: "initializeAssessment", params: { sceneId } }` entry descriptor
before concluding. Keep queue consumption in the scaffolded adapter: wait for
each item before rendering, consume items in order, and submit exactly one
stored first response per item. Run `npm run buildDebug` after review.
