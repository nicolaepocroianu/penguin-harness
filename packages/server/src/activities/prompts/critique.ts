/**
 * Prompt text only (decision 18): what a scene critique run's agent is told. Nothing here but
 * text and the names it is filled with: the bench lets a candidate recipe change this text and
 * nothing else, and scene-critique.ts fills it in.
 */

export const CRITIQUE_PROMPT = (values: {
  readonly CRITIQUE_GOOD: string | number;
  readonly CRITIQUE_INPUT_FILE: string;
  readonly CRITIQUE_MAX_FIXES: string | number;
  readonly CRITIQUE_OUTPUT_FILE: string;
  readonly CRITIQUE_STILLS_DIR: string;
}) =>
  `Critique a scene video made for young learners. Work in this workspace.
Read ${values.CRITIQUE_INPUT_FILE}: the scene's description, the video's description, its storyboard frames (what each should show, and for how long), and the stills taken from the recording, each with the moment it was taken and the frame it shows. Look at every still under ${values.CRITIQUE_STILLS_DIR}/ with your file reading tool.
Score the video from 1 (poor) to 5 (excellent) on each of:
- story: the stills show what the storyboard and the video's description ask, in that order;
- layout: every object has its own space and stands on its ground, nothing floats, is cut off or covers something it should not;
- readability: any text is large, clear and stands out from what is behind it;
- motion: the stills suggest calm movement that shows what the narration is about rather than decorating, with a clear still picture at the start and the end, and nothing that would flash or pulse;
- learners: friendly, clear and right for young children, nothing confusing or frightening.
Write ${values.CRITIQUE_OUTPUT_FILE}: {"scores": {"story": 4, "layout": 3, "readability": 5, "motion": 4, "learners": 5}, "fixes": ["one concrete change to the scene, naming what to change and how"]} with at most ${values.CRITIQUE_MAX_FIXES} fixes, the most important first; leave fixes empty only when every score is ${values.CRITIQUE_GOOD} or more. Judge only what the stills show. If your tools cannot show you the stills (images cannot be read), do not guess: write {"unseen": true} to ${values.CRITIQUE_OUTPUT_FILE} instead.
Do not edit ${values.CRITIQUE_INPUT_FILE} or the stills. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing ${values.CRITIQUE_OUTPUT_FILE}.`;
