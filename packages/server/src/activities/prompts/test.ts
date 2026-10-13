/**
 * Prompt text only (decision 18): what a test run's agent is told, and the harness's API, which a
 * module run's player check is told too. Nothing here but text and the names it is filled with:
 * the bench lets a candidate recipe change this text and nothing else, and acceptance-harness.ts
 * fills it in.
 */

/** The harness's API, as a test run and a module run's player check are told it. */
export const HARNESS_API = (values: {
  readonly ACCEPTANCE_HARNESS_FILE: string;
  readonly PLAYER_BROWSER_ARGS: string;
}) =>
  `The harness (${values.ACCEPTANCE_HARNESS_FILE}) exports:
- criteria: the acceptance criteria, in order; scenes: the specification's scene ids.
- criterion(text, testName, fn): registers the check for one criterion; text must be the criterion exactly as it appears in criteria. The check passes when fn resolves and fails with the message of the Error it throws.
- openActivity({ scene?, language? }): opens the played activity (on a scene when given) and waits until it starts; returns activity.
- activity.state() -> { state, sceneId, phase, index, interactive }; activity.history() and activity.mediaHistory() list the states and media events so far.
- activity.waitForState(name, { timeoutMs?, afterIndex? }); activity.waitForMedia(key, { kind?: "audio" | "video", status?: "started" | "completed" | "interrupted" | "failed" | "unavailable", timeoutMs?, afterIndex? }).
- activity.interactables() -> [{ id, inputType, description? }]; activity.tap(id), activity.hold(id, ms), activity.drag(id, toId) act on those tap targets like a learner.
- activity.pause() and activity.resume() pause and resume the activity as the learner's pause key does, waiting for the framework's pause overlay to show and to go; check pause and resume with these, not with events of your own.
- activity.page is the Playwright page, for reading what is on screen.
- To look into the activity outside a check, use openActivity too. A Chromium you launch yourself must be given ${values.PLAYER_BROWSER_ARGS}, or the framework pauses for audio and its pause overlay takes every tap.
- expect(condition, message) fails the check with message; skip(reason) marks a criterion that cannot be checked by playing the activity (for example the style of the art) as skipped.`;

/** What a test run's agent is asked to do when no earlier tests fit. */
export const ACCEPTANCE_PROMPT = (values: {
  readonly ACCEPTANCE_HARNESS_FILE: string;
  readonly ACCEPTANCE_INPUT_FILE: string;
  readonly ACCEPTANCE_RESULTS_FILE: string;
  readonly ACCEPTANCE_RUNNER_FILE: string;
  readonly ACCEPTANCE_TEST_FILE: string;
  readonly PLAYER_BROWSER_ARGS: string;
}) =>
  `Write and run the acceptance tests for this activity. Work in this workspace.
${values.ACCEPTANCE_INPUT_FILE} lists the acceptance criteria (criteria), the scenes and the viewport. activity-spec.json is the specification and description.md the activity script; read them to learn the states, tap targets and media each criterion is about.
${HARNESS_API(values)}
Write ${values.ACCEPTANCE_TEST_FILE} as an ES module that imports only from ./${values.ACCEPTANCE_HARNESS_FILE}. Register exactly one criterion() for each entry of criteria, in order, passing criteria[i] as its text. Each check opens the activity with openActivity(), drives it only through the harness and throws an Error saying what it expected and what it saw when the criterion is not met. Do not use fixed waits as assertions or make network requests.
Then run npm install --ignore-scripts (package.json pins the playwright-core this server uses) and node ${values.ACCEPTANCE_RUNNER_FILE}, with Harness's normal exec_command approval. The runner writes ${values.ACCEPTANCE_RESULTS_FILE}. If it says the tests could not run, fix ${values.ACCEPTANCE_TEST_FILE} and run it again. A failing criterion is a result to report, not a test to change: never weaken a check to make it pass, and never write ${values.ACCEPTANCE_RESULTS_FILE} yourself.
Do not edit ${values.ACCEPTANCE_INPUT_FILE}, ${values.ACCEPTANCE_HARNESS_FILE}, ${values.ACCEPTANCE_RUNNER_FILE}, package.json or the activity files. Do not print environment variables or credentials. Do not delegate or write outside this workspace.
Finish only after node ${values.ACCEPTANCE_RUNNER_FILE} has written ${values.ACCEPTANCE_RESULTS_FILE}.`;

/** What a test run's agent is asked to do when an earlier run's tests fit these criteria. */
export const ACCEPTANCE_REUSE_PROMPT = (values: {
  readonly ACCEPTANCE_HARNESS_FILE: string;
  readonly ACCEPTANCE_INPUT_FILE: string;
  readonly ACCEPTANCE_RESULTS_FILE: string;
  readonly ACCEPTANCE_RUNNER_FILE: string;
  readonly ACCEPTANCE_TEST_FILE: string;
  readonly PLAYER_BROWSER_ARGS: string;
}) =>
  `Run the acceptance tests for this activity. Work in this workspace.
${values.ACCEPTANCE_TEST_FILE} was written by an earlier run for these same acceptance criteria and this same specification. Do not rewrite it.
Run npm install --ignore-scripts (package.json pins the playwright-core this server uses) and node ${values.ACCEPTANCE_RUNNER_FILE}, with Harness's normal exec_command approval. The runner writes ${values.ACCEPTANCE_RESULTS_FILE}. Only if it says the tests could not run at all, fix ${values.ACCEPTANCE_TEST_FILE} using the harness described below and run it again.
${HARNESS_API(values)}
A failing criterion is a result to report, not a test to change. Never write ${values.ACCEPTANCE_RESULTS_FILE} yourself. Do not edit ${values.ACCEPTANCE_INPUT_FILE}, ${values.ACCEPTANCE_HARNESS_FILE}, ${values.ACCEPTANCE_RUNNER_FILE}, package.json or the activity files. Do not print environment variables or credentials. Do not delegate or write outside this workspace.
Finish only after node ${values.ACCEPTANCE_RUNNER_FILE} has written ${values.ACCEPTANCE_RESULTS_FILE}.`;
