---
name: waf-activity-states
description: Use when implementing or reviewing pipeline-generated WAF activity behavior. Publishes semantic scene behavior phases through the scaffolded zero-dependency activity-state contract so tests can observe readiness and media lifecycle without controlling the sequence.
---

# WAF Activity Behavior States

Machine-driven activities use the observation contract exported by
`waf-state-machine`. Legacy `waf-sequence` activities retain the scaffolded
`src/activity-state.js` adapter. Observation never replaces the behavior's
control-flow authority.

## State Names

Publish a state as `<scene-id>.<phase>` using the real scene id from the activity
spec and a semantic lowercase kebab-case phase:

- `scene-1.preparing`
- `scene-1.prompting`
- `scene-1.awaiting-choice`
- `scene-1.incorrect-feedback`
- `scene-1.showing-hint`
- `scene-1.success`
- `activity.complete`

Do not use numbered phases such as `scene-1.state-1`. A phase names what the
activity is doing or what learner action it is ready to accept.

State is reserved for mutually exclusive behavior phases where tests need a
stable wait or the set of legal next learner actions changes. Attempts, scores,
selected ids, and cached handles remain ordinary `data` context. DOM updates,
audio, animation, input locking, and cleanup remain effects owned by middleware.

Do not create states for element construction, CSS class assignment, asset
resolution, or other implementation details.

## Runtime Boundary

Machine activities are initialized by `bootstrapStateMachine`. The runtime
publishes each active leaf automatically; machine implementations must not call
`enterActivityState` or otherwise publish a second state:

```ts
bootstrapStateMachine({
  rootId: 'module-example',
  createImplementations,
});
```

Make behavior truth match the declarative graph. Entry actions receive an
`AbortSignal` and an `onCancel` cleanup registrar. Prompt playback must stop or
be ignored when its state exits, and an interactive action declares readiness
only after real input has been armed:

```ts
async function promptScene1({ context, send, signal }) {
  await playAudioKey(context, 'scene-1-prompt', { signal });
  if (!signal.aborted) send('PROMPT.COMPLETED');
}

function awaitScene1Choice({ context, onCancel }) {
  const interactable = armLearnerChoice(context, (choiceId) => {
    runtime.setInteractive(false);
    inputManager.lock();
    runtime.send({ type: 'CHOICE.SELECTED', choiceId });
  });
  onCancel(() => interactable.dispose());
  inputManager.unlock();
  runtime.setInteractive(true);
}
```

`runtime.setInteractive(true)` publishes readiness for the currently active
leaf. Call it only after the state's `Interactable` instances are registered
and `inputManager` is unlocked. In an accepted interaction callback, publish
`false` and call `inputManager.lock()` synchronously before sending the semantic
machine event. Keep input locked throughout feedback, media transitions, and
scene cleanup. State cancellation must dispose every registered handler.

Legacy sequence activities preserve `src/activity-state.js`, initialize it
after binding the real root, and use `enterActivityState` at truthful behavior
boundaries. That manual API is a compatibility path, not part of a machine
implementation.

Every scene needs at least one scene-prefixed leaf. The machine must reach its
explicit `activity.complete` final state through a legal transition.

## History And Repeated States

The runtime records a bounded ordered history with a monotonically increasing
index. Retry flows may revisit a state such as `scene-1.awaiting-choice`; this is
expected. Tests use a cursor captured before an interaction and wait for a
matching history entry after that cursor, rather than matching an older visit.

Do not clear, replace, or mutate the runtime history from activity code.

## Media Observability

Use scaffolded media helpers instead of manually claiming that media played.
`playAudioKey`, `playTimedAudioKey`, `playTimedAudioOperation`,
`runInterruptibleAudioKey`, and `playVideoOperation` publish actual lifecycle
observations such as `started`, `completed`, `interrupted`, `failed`, and
`unavailable`.

A behavior state such as `prompting` describes the intended phase. It does not
by itself prove that audio started. Tests that care about playback should assert
the shared media lifecycle using the real logical asset key.

Pass `data` and the logical key when playing a pre-created timed operation:

```js
await playTimedAudioOperation(operation, data, audioKey);
```

Use `playVideoOperation(data, videoKey, operation)` for observable video
readiness, start, completion, and failure instead of calling
`operation.playAsync()` directly.

## Test Boundary

Generated acceptance tests drive real DOM interactions and observe the read-only
debug API at `window.Activity.Inspection`. They do not dispatch state events or advance
`waf-sequence` directly. Activity code must not add mutation methods to the
browser API.

The root attributes `data-activity-state`, `data-activity-scene`,
`data-activity-phase`, `data-activity-state-index`, and
`data-activity-interactive` are stable observability hooks. Do not rename or
remove them.

## Review Checklist

- Machine modules use the observation contract built into
  `waf-state-machine`; legacy modules keep `src/activity-state.js`
  unmodified unless the shared scaffold contract itself is being changed.
- Initialization occurs after the real activity root is available.
- State ids use real spec scene ids and semantic phase names.
- Machine source contains no manual state publication.
- Every interactive action calls `runtime.setInteractive(true)` only after
  registering its `Interactable` instances and unlocking `inputManager`.
- Accepted input publishes non-readiness and locks synchronously before sending
  its semantic event; state cancellation disposes handlers and asynchronous work.
- Retry paths publish a new history entry when they revisit a phase.
- Media claims come from scaffolded lifecycle helpers.
- Completion reaches the declared `activity.complete` final state.
- State publication never calls `next()`, changes sequence branching, or becomes
  a second orchestration engine.
