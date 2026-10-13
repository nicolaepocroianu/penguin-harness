// PLACEHOLDER hidden checks, to build and test the activity bench with: not a real case.
// canary: PLACEHOLDER-BENCH-CANARY-3f9a7c215e8b4d06
import { criteria, criterion, expect, openActivity } from "./activity-harness.mjs";

const ENDED = /end|complete|finish/i;
const animal = (targets, name) =>
  targets.find((target) => name.test(`${target.id} ${target.description ?? ""}`));

criterion(criteria[0], "plays a sound at the start", async () => {
  const activity = await openActivity();
  const media = await activity.mediaHistory();
  expect(
    media.some((event) => event.kind === "audio"),
    "Expected a sound at the start; heard none.",
  );
});

criterion(criteria[1], "offers the animals", async () => {
  const activity = await openActivity();
  const targets = await activity.interactables();
  expect(targets.length >= 3, `Expected three animals to choose from; saw ${targets.length}.`);
});

criterion(criteria[2], "the dog moves on", async () => {
  const activity = await openActivity();
  const dog = animal(await activity.interactables(), /dog/i);
  expect(dog, "Expected the dog to choose.");
  const before = await activity.history();
  await activity.tap(dog.id);
  const after = await activity.history();
  expect(after.length > before.length, "Expected the activity to move on after the dog.");
});

criterion(criteria[3], "ends after the dog", async () => {
  const activity = await openActivity();
  const dog = animal(await activity.interactables(), /dog/i);
  expect(dog, "Expected the dog to choose.");
  await activity.tap(dog.id);
  const state = await activity.state();
  expect(ENDED.test(String(state.state)), `Expected the end; saw ${state.state}.`);
});
