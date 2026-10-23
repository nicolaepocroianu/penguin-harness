/**
 * Prompt text only (decision 18): what a module run's agent is told. Nothing here but text and
 * the names it is filled with: the bench lets a candidate recipe change this text and nothing
 * else, and waf-module.ts and implementation-features.ts fill it in.
 */

/**
 * What a module run is asked to do: implement the specification as a WAF module, and check
 * it in the player.
 */
export const MODULE_PROMPT = (values: {
  readonly ACCEPTANCE_HARNESS_FILE: string;
  readonly ACCEPTANCE_INPUT_FILE: string;
  readonly ACCEPTANCE_RESULTS_FILE: string;
  readonly ACCEPTANCE_RUNNER_FILE: string;
  readonly ACCEPTANCE_TEST_FILE: string;
  readonly HARNESS_API: string;
  readonly PLAYER_CHECK_DIR: string;
}) =>
  `Implement the saved activity specification in input.json as a real WAF HTML module.
The module/ directory contains the native WAF scaffold. Read waf-context.json for the local framework, navbar and media checkout. Read that framework's contracts before implementing.
Before implementing, read the WAF skills in skills/, in the order skills/README.md lists them, and follow them. Where a skill and this message disagree, this message wins. Do not copy skills/ into module/.
If input.json contains draft.mediaPlan, its manifest and language-specific configuration are approved inputs. Preserve their keys, scripts and paths; do not invent replacements. Paths are relative to wafRoot except assets carrying generatedAudio, generatedImage or generatedVideo and uploaded assets (a path containing /uploads/): their approved bytes have already been copied into this Session's workspace at the same path. Verify bound files and keep the {{MEDIA}} token in the configuration: WAF Harness's player resolves it to this draft's accepted media and the checkout's media. Assets without paths remain unbound: report them explicitly and do not claim complete media. A binding is a reference, not proof of file availability.
Work only in this Session workspace. Treat the shared WAF checkout as read-only. Do not modify shared modules or run Loom's pipeline/server. Do not delegate.
Implement the actual learning interactions and feedback in module/src, preserving waf-state-machine, WAF lifecycle, Interactable input and cleanup. Complete the ref configuration and state machine for the input productCode/refNum. When input.json has draft.mediaPlan, the ref's asset_manifest.json is already written from it in WAF's format and is restored as written after you finish: read it, do not rewrite it. Use existing media when available; report missing media explicitly, never invent successful generation. A video or sound that fails to play is reported through the media lifecycle and the activity moves on; it never leaves a state waiting forever.
Use normal Harness approvals for installing dependencies and running commands. Run module typecheck and buildDebug in module/; record real command output in module/build.log. Do not publish or deploy packages.
This workspace is not a git repository. module/package.json declares "type": "module", so a script run inside module/ uses import, not require (or is named .cjs). The typed contracts you implement against are module/node_modules/waf-state-machine/dist/index.d.ts and the files it re-exports, and module/node_modules/input-manager-system/README.md; read them rather than listing whole package or framework trees.
Check the built module in WAF Harness's player, which runs module/dist/debug in the real WAF framework with the navbar, this draft's media and an emulated configuration and assessment backend, and rebuilds the module first when module/src, module/res or module/generated changed. Do not write a preview page or a stand-in WAF runtime of your own. ${values.PLAYER_CHECK_DIR}/ holds the check: ${values.ACCEPTANCE_INPUT_FILE} (the play link for this run's module, the viewport, the scene ids and the acceptance criteria), the harness ${values.ACCEPTANCE_HARNESS_FILE}, the runner ${values.ACCEPTANCE_RUNNER_FILE} and a package.json pinning playwright-core. Do not edit them.
${values.HARNESS_API}
Write ${values.PLAYER_CHECK_DIR}/${values.ACCEPTANCE_TEST_FILE} as an ES module that imports only from ./${values.ACCEPTANCE_HARNESS_FILE}, with one criterion() for each scenario you exercise: every scene starting (openActivity({ scene })), each interaction with its correct and incorrect feedback, pause and resume, and completion. Use an acceptance criterion's exact text where a check covers it. Then, in ${values.PLAYER_CHECK_DIR}/, run npm install --ignore-scripts and node ${values.ACCEPTANCE_RUNNER_FILE}; it prints each check's result and writes ${values.ACCEPTANCE_RESULTS_FILE}. Fix the module until the checks pass, rebuilding after each change; never weaken a check to make it pass. The test browser cannot decode some video formats (H.264 among them): a check that fails only for that reason is a capability to report, not a module failure.
If ${values.PLAYER_CHECK_DIR}/ is absent, the test browser is not installed: build and typecheck the module, and say in your final message that it was not checked in the player because an admin has not installed the test browser in System settings.
If dependencies, the typecheck, the build or the player checks fail and you cannot fix them, explain the failure and do not write module-result.json.
Then write module-result.json as { "files": ["module/package.json", "module/definition.json", "module/src/index.ts", "module/res/layout.html", "module/build.log", ...] }. Include source, configuration and built JavaScript under module/dist, excluding node_modules and binary files. At most 200 text files, 8 MiB each, 32 MiB total. Finish after writing the manifest.`;

/**
 * What a module run is told beside `MODULE_PROMPT` when the scaffold's packages were linked in
 * from the shared install, so it does not spend minutes installing its own.
 */
export const MODULE_PACKAGES_CLAUSE = `
module/node_modules is already installed: every package module/package.json names, linked in from an install shared by every run. Do not run npm install in module/, do not add or change dependencies, and do not write into module/node_modules. Start with the typecheck and build as they are.`;

/** What a book's module run is told beside `MODULE_PROMPT`: the reader the scaffold ships. */
export const MODULE_BOOK_CLAUSE = `
input.bookMode is the user's explicit reading-mode choice. The scaffolded product configuration contains the selected book policy, the book state machine, the scene catalog, and complete localized scenes. Preserve the policy, scene order, roles, derived page numbers, image alt text, and ordered audio cues. Cover/title pages show only artwork. Story visible text is primary narration; supplemental cues remain hidden. Read-along autoplays on first visit without advancing; Decodable waits the configured reading delay for manual narration and unlocks Next only after all cues complete. Keep backward navigation and rereading available after completion. Missing word timings or pronunciation assets are missing capabilities to report, not timings to invent. Empty timing arrays must not be presented as verified synchronized highlighting.
The scaffold ships the complete native reader under module/src: src/index.ts boots the waf-state-machine with enterReader/bookFinalize actions; src/book-reader holds the model, controller, view and adapter. Use them as shipped. The entry wires the intro video, framework pause/resume, pagehide teardown (controller.dispose plus stateMachine.stop), keyboard navigation, and completion via BOOK.COMPLETED while keeping the view interactive. The adapter compiles word highlight events only from timings present in the configuration; with the currently empty timing arrays narration must play without highlighting, and synchronized highlighting must be reported as unavailable. Supply native timed-audio operations through the port with channel vocals; a missing cue must reject as failed narration, never resolve as success. Keep the reader's Interactables scene-owned so they survive the final state. Exercise the real reading scenarios in the player check: delay, pause/resume, interrupted narration, follow-up cues, quiet revisits, and post-completion navigation. Report any capability the data cannot support (word audio, timings, intro video) instead of claiming it. Include all reader source files in module-result.json.`;

/**
 * What a module run that repairs a tested build is told beside `MODULE_PROMPT`: it starts from
 * that build's sources, with the checks it failed.
 */
export const MODULE_REPAIR_CLAUSE = (values: {
  readonly ACCEPTANCE_TEST_FILE: string;
  readonly REPAIR_DIR: string;
  readonly REPAIR_FILE: string;
}) =>
  `
This run repairs a module build the acceptance tests played. module/src, module/res, module/configurations and module/definition.json are that build's files as they were tested. ${values.REPAIR_DIR}/${values.REPAIR_FILE} lists each check that ran and saw the module do something wrong: its criterion, the check's name and what it saw. ${values.REPAIR_DIR}/${values.ACCEPTANCE_TEST_FILE} is the test file those checks are in; read it to see what each check does, and do not change it: the same file is run again against your build. Fix the module so it behaves as the specification in input.json says, then build it and check it in the player as above. Where a check asks for something the specification does not say, leave the module as the specification has it and name that check in your final message instead.`;

/**
 * The part of the assembly prompt that asks for the selected implementation features, Loom's
 * wording adapted to where WAF Harness puts things. `names` lists them as "label (id)".
 */
export const MODULE_FEATURES_CLAUSE = (values: {
  readonly names: string;
  readonly RUN_FEATURES_FILE: string;
}) => `

Selected implementation features: ${values.names}. Read ${values.RUN_FEATURES_FILE} in this workspace, and each feature's source files under modules/<sourceModule>/ in the WAF checkout. Bake each selected feature into the module using the exact required symbols, selectors, DOM structure, styling, positioning, and interaction pattern from its source module. Activity-specific data may be adapted, but parallel renamed implementations do not satisfy a selected feature. The selected feature contract takes precedence over generic implementation guidance when the two conflict. Required selectors must be emitted by the runtime DOM and styled in res/style.scss; copying unused selectors or helper declarations does not bake in the feature. Required symbols must be called by the implemented behavior, not merely left as unused definitions. Preserve all required style fragments exactly, including their animation durations, easing, keyframe stops, transforms, and other motion values.`;
