/**
 * Prompt text only (decision 18): what a timeline run's agent is told. Nothing here but text and
 * the names it is filled with: the bench lets a candidate recipe change this text and nothing
 * else, and timeline-edit.ts fills it in.
 */

export const TIMELINE_PROMPT = (values: {
  readonly TIMELINE_INPUT_FILE: string;
  readonly TIMELINE_OUTPUT_FILE: string;
}) =>
  `Refine the timeline of a scene video so its sound follows its picture. Work in this workspace.
Read ${values.TIMELINE_INPUT_FILE}: the scene, the video, its current timeline (every time in whole milliseconds), the storyboard frames the video shows and when each starts and ends, and the narration, music and sound effects the scene has, with each narration's script and length.
Write ${values.TIMELINE_OUTPUT_FILE}: the whole timeline again, in exactly the same shape as the current one.
- Keep version, width, height and fps as they are, and cut only from the recordings the current cuts use (the same source objects). You may change where cuts start and end and how each begins ("cut", "fade" or "fadeblack" with transitionMs; the first cut is always "cut" with 0).
- Start each narration over the frame it talks about, a moment after that frame begins. Never let two narrations overlap: one ends (its startMs plus its length) before the next starts, with a short gap. Every narration ends before the video does. Leave out a narration only when it plainly belongs to another part of the scene.
- Place a sound effect where a frame shows it happening, at volume 0 to 1.
- Use music only from the scene's list, at volume 0.2 to 0.4, with "duck": true so it lowers under narration, or "music": null when the scene has none.
- Keep captions on unless there is no narration.
Use only the asset keys listed in ${values.TIMELINE_INPUT_FILE}. Do not edit ${values.TIMELINE_INPUT_FILE}. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing ${values.TIMELINE_OUTPUT_FILE}.`;
