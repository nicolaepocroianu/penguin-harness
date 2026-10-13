/**
 * Prompt text only (decision 18): what a composition run's agent is told. Nothing here but text and
 * the names it is filled with: the bench lets a candidate recipe change this text and nothing
 * else, and composition.ts fills it in.
 */

export const COMPOSITION_PROMPT = (values: {
  readonly COMPOSITION_BRIDGE_FILE: string;
  readonly COMPOSITION_FILE: string;
  readonly COMPOSITION_FRAMES_FILE: string;
  readonly COMPOSITION_GSAP_FILE: string;
  readonly COMPOSITION_IMAGE_DIR: string;
  readonly COMPOSITION_INPUT_FILE: string;
  readonly COMPOSITION_LOOK_FILE: string;
  readonly COMPOSITION_LOOK_GUIDE: string;
  readonly COMPOSITION_PREVIOUS_FILE: string;
  readonly COMPOSITION_PREVIOUS_FRAMES_FILE: string;
  readonly COMPOSITION_SKILL_FILE: string;
  readonly COMPOSITION_TEMPLATE_FILE: string;
  readonly FRAME_SECONDS: string | number;
  readonly MAX_SECONDS: string | number;
  readonly MIN_SECONDS: string | number;
}) =>
  `Compose a short animated scene for this activity. Work in this workspace.
Read ${values.COMPOSITION_INPUT_FILE}: the scene's description, the description of the video or animation asset, the canvas size, and the scene's images (each a file under ${values.COMPOSITION_IMAGE_DIR}/). description.md and input.json describe the whole activity.
Write two files:
1. ${values.COMPOSITION_FILE}: start from ${values.COMPOSITION_TEMPLATE_FILE} and keep its head as it is (the Content-Security-Policy meta tag, ${values.COMPOSITION_GSAP_FILE} and ${values.COMPOSITION_BRIDGE_FILE}) and the #stage element at the canvas size. Build the scene inside #stage from the staged images, when there are any, and plain HTML, CSS and inline SVG; a scene with no images is drawn entirely with HTML, CSS and inline SVG. Animate it with one GSAP timeline created paused, gsap.timeline({ paused: true }), and assign it to window.__composition.timeline; drive every change from that timeline, with no timers or event handlers of your own. It must be deterministic: no Math.random or other randomness. Use only the staged files, referenced by their relative paths (${values.COMPOSITION_IMAGE_DIR}/<file>, ${values.COMPOSITION_GSAP_FILE}, ${values.COMPOSITION_BRIDGE_FILE}); never load anything from the network (no http or https URLs, fonts, CDNs or fetch). Keep it under 512 KB.
2. ${values.COMPOSITION_FRAMES_FILE}: {"frames": [{"id": "frame-1", "description": "what this frame shows", "seconds": 3}]} describing each storyboard frame in order, about ${values.FRAME_SECONDS} seconds each, ${values.MIN_SECONDS} to ${values.MAX_SECONDS} seconds in total, matching the timeline.
Read ${values.COMPOSITION_SKILL_FILE} and follow it: how to plan the frames, lay out the stage, write text and motion for young learners, mark the main objects with data-focal, time the timeline to the frames, and check the scene before finishing.
When ${values.COMPOSITION_INPUT_FILE} names a look, the scene is made in it: read ${values.COMPOSITION_LOOK_GUIDE}, link <link rel="stylesheet" href="${values.COMPOSITION_LOOK_FILE}"> in the head, and take every main colour, the font and the corner radius from its variables (var(--look-...)).
When ${values.COMPOSITION_PREVIOUS_FILE} is staged, it is the best version of this scene so far: start ${values.COMPOSITION_FILE} from it rather than from the template, keep what works, and change only what previousRecordingFindings ask for; keep its frames (${values.COMPOSITION_PREVIOUS_FRAMES_FILE}) unless a finding is about them.
When ${values.COMPOSITION_INPUT_FILE} lists previousRecordingFindings, the last recording of this scene had those problems: fix every one of them.
Do not edit the staged files. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing both files.`;
