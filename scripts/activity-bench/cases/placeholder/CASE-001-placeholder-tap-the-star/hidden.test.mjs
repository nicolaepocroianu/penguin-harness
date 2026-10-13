// PLACEHOLDER hidden checks, to build and test the activity bench with: not a real case.
// canary: PLACEHOLDER-BENCH-CANARY-3f9a7c215e8b4d06
import { criteria, criterion, expect, openActivity } from "./activity-harness.mjs";

const ENDED = /end|complete|finish/i;

criterion(criteria[0], "starts with a tap target", async () => {
  const activity = await openActivity();
  const targets = await activity.interactables();
  expect(targets.length > 0, "Expected something to tap at the start; saw nothing.");
});

criterion(criteria[1], "a tap moves the activity on", async () => {
  const activity = await openActivity();
  const before = await activity.history();
  const [first] = await activity.interactables();
  expect(first, "Expected a tap target at the start.");
  await activity.tap(first.id);
  const after = await activity.history();
  expect(after.length > before.length, "Expected a new state after the tap; saw none.");
});

criterion(criteria[2], "ends after the tap", async () => {
  const activity = await openActivity();
  const [first] = await activity.interactables();
  expect(first, "Expected a tap target at the start.");
  await activity.tap(first.id);
  const state = await activity.state();
  expect(ENDED.test(String(state.state)), `Expected the end; saw ${state.state}.`);
});

criterion(criteria[3], "narration at the start", async () => {
  const activity = await openActivity();
  const media = await activity.mediaHistory();
  expect(
    media.some((event) => event.kind === "audio"),
    "Expected narration to start; heard none.",
  );
});
