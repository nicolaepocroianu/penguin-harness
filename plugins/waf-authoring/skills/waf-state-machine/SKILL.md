---
name: waf-state-machine
description: Implement generated WAF activity behavior with the Nexus-published XState-backed state machine.
---

# WAF state machine

Treat the product-owned `generated/<productCode>/spec/state-machine.json` as
the editable control-flow authority. Implement Behavior synchronizes that exact
file into `configuration.stateMachine` for the selected ref; do not create or
edit a ref-local `generated/<productCode>/refs/<ref>/spec/state-machine.json`.
Let `bootstrapStateMachine` read the delivered configuration instead of
fetching a file. Do not add `waf-sequence`, `Sequence`, `next`, `exit`, or a
second state variable that duplicates the active machine state.

Edit behavior under `src/activity/` and the declarative graph in
`generated/<productCode>/spec/state-machine.json`. Preserve that file as a JSON
object whose root is the machine definition; do not wrap it in a `machine`
property. The installed
`waf-state-machine` package owns the XState adapter, WAF lifecycle, schema,
and observation harness. Do not import XState directly or copy or replace the
package implementation in the generated module.

Use the vendored `xstate-v5` skill to review statechart modeling, event design,
guards, actions, and actor boundaries. Apply its XState v5 guidance through the
WAF State machine dialect described here: generated modules must not import
`xstate`, call `setup(...)` or `createMachine(...)`, or bypass the package-owned
adapter. When generic XState guidance conflicts with this generated-module
boundary, this WAF-specific contract takes precedence.

Keep `src/activity/index.ts` as the narrow `createStateMachineImplementations`
Interface. Put event types, builders, and correlation guards in
`src/activity/events.ts`; group presentation and assessment behavior into
focused activity modules; keep WAF, media, asset, telemetry, and assessment
Adapters under `src/adapters/`. Do not collapse the implementation back into a
single large file.

Type every generated action, guard, and service against `ActivityContext`
from `src/activity/context.js` using the package's `StateMachineAction`,
`StateMachineGuard`, and `StateMachineService` types.
`createStateMachineImplementations` declares its parameters and return as
`StateMachineRuntime<ActivityContext>` and
`StateMachineImplementations<ActivityContext>`, so names added to its
`actions`, `guards`, and `services` records must conform, and `npm run
typecheck` fails on any drift. `ActivityContext` is owned by the installed
`waf-state-machine` package; when behavior needs a new durable context field,
augment it in `src/activity/context.ts` with a `declare module
'waf-state-machine'` interface-merging block instead of introducing ad-hoc
context shapes, and initialize the field in `initializeActivityContext`.
Never edit the installed package. Keep `stageState` entries open only for
per-scene facts such as attempt counts or disabled choice ids.

Author schema `1.1` machines in the WAF State machine dialect. It is inspired
by XState, but it is not native XState JSON and must never be passed directly to
`createMachine`. The package alone compiles it to its internal XState actor. Use
serializable implementation descriptors such as `{ "type": "scene.present",
"params": { "sceneId": "scene-1" } }`; descriptor parameters belong under
`params`, never `input`. Keep implementations in generated TypeScript.

Treat `data.sceneCatalog` as the only scene-metadata Interface available to
behavior code. Resolve a scene with `data.sceneCatalog.scene(sceneId)`. Never
copy scene descriptions or image, animation, video, or audio key arrays into
TypeScript constants. `configuration.activityScenes` is a generated projection
of the canonical activity spec and must not be edited by behavior generation.
Machine descriptors may carry a `sceneId` and behavior-specific parameters,
but they must not duplicate scene metadata.

Hydrate every asset before using it. `hydrateStageAssets` covers the active
scene only; if an effect deliberately reuses an asset declared by another
scene, hydrate a metadata copy containing only that referenced asset before
creating its media operation. Do not assume an earlier scene ran, because Loom
preview may start directly at any top-level scene.

Use semantic compound states such as `scene-1.presenting`,
`scene-1.first-choice`, and `scene-1.first-incorrect-feedback`. A state is
justified when the learner or host can observe a different behavior, input
policy, wait, branch, or completion boundary. Do not create states merely for
helpers such as preparing data, rendering DOM, evaluating a selection, or
cleaning up.

Start asynchronous presentation and feedback work from named entry actions.
When the work completes, send a semantic event such as `SCENE.PRESENTED`,
`PROMPT.COMPLETED`, `FEEDBACK.COMPLETED`, or `SCENE.COMPLETED`. Learner handlers
send events such as `CHOICE.SELECTED`. Transitions under `on` are the only way
to advance the graph. Legacy `invoke` remains runtime-compatible for existing
modules, but new generated behavior must not use `invoke`/`onDone` as a chain
of implementation steps.

Every scene-owned event carries `sceneId`. Every transition for a scene-owned
event uses a guard descriptor with `params.sceneId` matching the owning
top-level scene, even when another guard also checks correctness or retry count.
An event from a stale scene must be ignored. Wrap state-owned async effects so a
non-abort failure sends a correlated `EFFECT.FAILED` event; logging alone must
never leave the machine stranded.

When an async-effect wrapper catches an error before sending `EFFECT.FAILED`,
log the error with the scene id. Never silently convert an implementation
error into terminal completion; the error must remain visible in the player
console for diagnosis.

Route correlated `EFFECT.FAILED` transitions to an observable, non-final
failure state such as `activity.failed`; never target `activity.complete` for
an error. The validator permits exactly one final state: `activity.complete`.
Therefore `activity.failed` must not have `type: "final"` and must not be used
as an alternate terminal state.

Entry actions own their asynchronous work for exactly as long as their state is
active. Use the action's `signal` for abort-aware helpers and register media,
timers, listeners, and interactable cleanup with `onCancel`. Check
`signal.aborted` before sending a completion event. A promise resolving after
its state exits must never advance the current state.

Put scene resource cleanup on the top-level scene compound state's `exit`, not
on a successful completion transition, so it runs for successful completion,
effect failures, preview changes, and all future exit paths. When advancing to
the next scene, target that top-level compound state rather than an internal
leaf such as `.presenting`; its declared `initial` state owns normal entry.

Do not hide behaviorally meaningful decisions inside a service or collapse them
into a generic `evaluating -> prompting` loop. When the activity spec describes
different outcomes or retry stages—such as correct, first incorrect, second
incorrect, guided or hint mode, timeout, and retry exhaustion—give those paths
explicit semantic leaf states connected by named guards. The JSON graph must let
Loom visualize every meaningful branch and let tests start from or wait for it.

## Runtime interactable registration

Register every armed Interactable with the runtime so test harnesses can
discover live targets. Immediately after constructing each `new Interactable`
and arming its handlers, register it through the entry action's scoped
`interactables` argument:

```ts
function armAppleChoice({ interactables }) {
const choiceInteractable = new Interactable(
  document.getElementById('choice-apple'),
  inputEventTypes.SELECT_CLICK,
);
choiceInteractable.onSelect = handleAppleSelected;
interactables?.register(choiceInteractable.element, {
  id: 'choice-apple',
  inputType: 'SELECT_CLICK',
  event: 'CHOICE.SELECTED',
  params: { choiceId: 'apple', isCorrect: true },
});
}
```

Rules for registration:

- Register exactly what is really armed, at arm time, inside the entry action
  of the state that accepts input. Scenes without learner input register
  nothing.
- Use the action's `interactables` argument so registrations made after an
  `await` remain owned by the state and are disposed when it exits.
- `id` must be the exact DOM element id passed to `new Interactable(...)`.
  The runtime warns when a descriptor id does not match its element.
- `inputType` is one of `CLICK`, `SELECT`, `SELECT_CLICK`, or `DRAG` and must
  match the `inputEventTypes` value used at construction.
- A pure `inputEventTypes.CLICK` interactable must assign `onClick`, never
  `onSelect`. Timeout automation invokes `onClick` directly, so pairing
  `CLICK` with only `onSelect` fails at runtime even if TypeScript compiles.
- `event` names the semantic event the handler sends back to the machine.
- `params` optionally carries declarative facts such as `isCorrect` (a
  boolean), a stable `choiceId`, or grouping metadata.
  Acceptance tests read these to exercise the right path. For assessed scenes
  the generated assessment JSON remains the source of truth for answers —
  only mirror per-choice `isCorrect` into params when acceptance tests need
  it, and keep it consistent with the assessment items.
- Registration annotates the element with `data-interactable-id` and
  `data-interactable-input-type` and disposes automatically when the arming
  state exits (through the action's cancellation scope). Never register
  decorations, disabled choices, or elements that only some paths arm; never
  register the same id twice while armed.

Use the callback that matches the input type:

```ts
const replayTarget = new Interactable(studentElement, inputEventTypes.CLICK);
replayTarget.onClick = replayStudent;

const holdTarget = new Interactable(starElement, inputEventTypes.SELECT);
holdTarget.onSelect = submitChoice;
```

Do not use `replayTarget.onSelect` for the click target. Real taps and
timeout-driven cursor clicks both enter through `onClick`.

When an entry action discovers that there are no interactables to arm and
must send an event that leaves the newly entered state, defer that send until
the current transition finishes:

```ts
let cancelled = false;
onCancel(() => {
  cancelled = true;
});
queueMicrotask(() => {
  if (!cancelled) {
    runtime.send({ type: 'INPUT.NONE_AVAILABLE', sceneId });
  }
});
```

Do not synchronously call `runtime.send(...)` from that entry branch. The
event can arrive before the target state is ready to consume it. Keep the
deferred send cancellation-scoped so it cannot fire after the state exits.

## Watchdog timeouts

States that wait indefinitely on an external completion event must declare an
`after` watchdog so one dropped event cannot hang the activity:

```json
"scene-4.correct-feedback": {
  "entry": { "type": "playCorrectFeedback", "params": { "sceneId": "scene-4" } },
  "on": {
    "FEEDBACK.COMPLETED": {
      "guard": { "type": "isEventForScene", "params": { "sceneId": "scene-4" } },
      "target": "#machine3.scene-5"
    }
  },
  "after": {
    "30000": {
      "target": "#machine3.activity.failed"
    }
  }
}
```

Rules for watchdogs:

- The key is a positive-integer number of milliseconds; pick generous bounds
  that exceed the longest legitimate media playback plus interaction time.
- Watchdog transitions route to observable recovery, a retry of the wait, or
  the non-final `activity.failed` state — never to `activity.complete`, and
  never past unfinished learner input.
- Do not add watchdogs to states whose wait is intentionally unbounded (for
  example a state holding the final frame before host teardown).

## Choice retries and guided recovery

For a choice interaction that permits corrective attempts, model the learner's
input policy directly in the graph. A typical flow has `first-choice`,
`second-choice`, and `guided-choice` leaf states. The correct branch advances
to explicit feedback or completion; each incorrect branch advances to the next
policy state after its feedback. Do not hide attempt counting and policy changes
inside one `CHOICE.SELECTED` action.

Keep durable per-round facts in context—such as the first selected choice,
disabled choice ids, and incorrect-attempt count—but never duplicate the active
mode in context. Use named actions such as `round.captureFirstSelection`,
`round.disableSelected`, `round.incrementIncorrectAttempts`, and
`round.disableAllIncorrect`. For assessed interactions, preserve the first
selection for the eventual response even if a later guided selection is correct.

Every `CHOICE.SELECTED` transition array must start with the scene-correlation
staleness guard (`isEventForScene` with `params.sceneId`) so foreign-scene
events are filtered before any semantic branch runs. Semantic guards such as
`isCorrectChoiceForScene` must also reject events whose `sceneId` does not
match their params — never rely on branch order alone for scene ownership.
After the staleness guard, put the correct guarded branch before the
unguarded incorrect fallback. In guided mode, an unexpected or disabled
selection must use a targetless rejection action such as
`{ "type": "input.reject" }`; it must not advance the scene or re-enable input.
Do not add `NAVBAR.REPEAT` transitions or actions to the machine. The framework
audio service already handles `audioService.playRepeatAudio` and plays the clip
configured through `setRepeatAudio`. Replaying the prompt from the machine in
response to that same event plays Repeat twice.

DOM handlers must send semantic events through the runtime passed to
`createStateMachineImplementations`, for example `runtime.send({ type:
'CHOICE.SELECTED', choiceId })`. They must not directly enter another state.
Inside actions and guards, read and mutate the actor-owned `args.context` or
destructured `context`; never capture the pre-actor initialization data for
runtime state. The runtime shallow-copies its initial context, so replacing a
nested object on captured initialization data leaves guards and later actions
reading stale state.
After registering real input handlers and unlocking `inputManager`, call
`runtime.setInteractive(true)`. On accepted input, call
`runtime.setInteractive(false)` and lock input synchronously before sending the
event. Readiness is a live runtime fact, not a static list of state ids.

The machine owns when Repeat is configured or cleared, but it does not own
playback after the navbar button is pressed. Keep Repeat setup in the active
choice state's entry action and let the framework play the configured clip.

Every scene from the activity spec must appear as a top-level compound state.
The machine must reach the explicit final state `activity.complete`. Preview
starts may select a top-level scene, but setup remains owned by the runtime.

Keep the `waf-state-machine` harness as observation only. The runtime
publishes its active leaf state to that harness; behavior code must not call
`enterActivityState` manually.

## Behavior preflight

Before concluding an implementation or review, inspect the complete machine
and its TypeScript implementation in this order:

1. Confirm schema 1.1, top-level compound states for every scene, a reachable
   `#<id>.activity.complete`, no `invoke`/`onDone`, and scene-correlated
   transitions.
2. Perform a mechanical, case-sensitive registry audit over the complete JSON:
   - every `entry`, `exit`, and transition `actions` reference must be an exact
     key in `createStateMachineImplementations().actions`;
   - every transition `guard` reference must be an exact key in `.guards`;
   - every preserved legacy `invoke.src` reference must be an exact key in
     `.services`.
   Fix every mismatch in the files, not just in a review summary: implement and
   register the referenced name, rename both sides consistently, or remove an
   unnecessary descriptor. Entering `activity.failed` is already observable and
   does not require an entry action; never invent `failActivity`,
   `reportFailure`, or a similar descriptor unless that exact action is
   implemented and registered. Loom does not infer registrations from generated
   source, and `npm run buildDebug` cannot detect names stored only in the JSON.
   A name absent from all registries makes preview initialization fail before
   the activity starts. A name registered under the wrong category can pass
   startup and fail later when the action, guard, or service executes. Both
   cases are invalid generated behavior and must be repaired before finishing.
3. Confirm behavior reads canonical scene metadata through `sceneCatalog`,
  does not manually publish activity state, uses the actor-owned action or
  guard `context` for runtime state, leaves fixed adapters intact, and types
  every generated action, guard, and service against `ActivityContext`.
4. For assessed activities, confirm `createStateMachineImplementations` calls the
   idempotent assessment initializer immediately after activity-context
   initialization, before machine startup can race the first assessment-item
   publication. Also confirm every top-level scene has the idempotent
   `initializeAssessment` entry descriptor for direct preview starts.

   When an assessed scene first waits for an assessment item, call the same
   idempotent assessment initializer at that consumer before waiting. A direct
   top-level preview start may enter an initial child without running the parent
   entry descriptor first. Neither safeguard replaces startup initialization.

Then run `npm run buildDebug` and correct any compilation or bundle failures.
This preflight is centralized in the behavior-generation skills and review
prompt; generated modules do not carry a copy of the validation harness.

For guarded transition arrays, put specific guarded branches first. Scene-owned
events must not use an unguarded state-changing fallback; unmatched or stale
events remain ignored. Correct, first-incorrect, second-incorrect, retry,
guided-choice, correct-feedback, and terminal behavior must remain explicit
when present in the activity requirements. Do not begin accepting the next
choice while incorrect or correct feedback is still running.
