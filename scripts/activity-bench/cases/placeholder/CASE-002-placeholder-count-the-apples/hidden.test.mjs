// PLACEHOLDER hidden checks, to build and test the activity bench with: not a real case.
// canary: PLACEHOLDER-BENCH-CANARY-3f9a7c215e8b4d06
import { criteria, criterion, expect, openActivity } from "./activity-harness.mjs";

const ENDED = /end|complete|finish/i;
const choice = (targets, label) =>
  targets.find((target) => label.test(`${target.id} ${target.description ?? ""}`));

criterion(criteria[0], "offers the numbers", async () => {
  const activity = await openActivity();
  const targets = await activity.interactables();
  expect(targets.length >= 3, `Expected three numbers to choose from; saw ${targets.length}.`);
});

criterion(criteria[1], "a wrong number keeps the question", async () => {
  const activity = await openActivity();
  const wrong = choice(await activity.interactables(), /\b(2|two|4|four)\b/i);
  expect(wrong, "Expected a wrong number to choose.");
  const before = await activity.state();
  await activity.tap(wrong.id);
  const after = await activity.state();
  expect(
    after.sceneId === before.sceneId,
    "Expected to stay on the question after a wrong number.",
  );
});

criterion(criteria[2], "three moves on", async () => {
  const activity = await openActivity();
  const right = choice(await activity.interactables(), /\b(3|three)\b/i);
  expect(right, "Expected the number three to choose.");
  const before = await activity.history();
  await activity.tap(right.id);
  const after = await activity.history();
  expect(after.length > before.length, "Expected the activity to move on after three.");
});

criterion(criteria[3], "ends after the right answer", async () => {
  const activity = await openActivity();
  const right = choice(await activity.interactables(), /\b(3|three)\b/i);
  expect(right, "Expected the number three to choose.");
  await activity.tap(right.id);
  const state = await activity.state();
  expect(ENDED.test(String(state.state)), `Expected the end; saw ${state.state}.`);
});
