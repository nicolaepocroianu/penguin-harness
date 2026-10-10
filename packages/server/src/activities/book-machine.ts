import { interpretBookScenes, type BookScene } from "./book.js";

export const BOOK_COMPLETE_EVENT = "BOOK.COMPLETED";
export const BOOK_READING_STATE = "reading";
/**
 * The reader's one phase. waf-state-machine reports every state as <scene-id>.<phase> and
 * refuses a bare "reading", so the reader's scene is a compound state with this leaf.
 */
export const BOOK_READING_PHASE = "ready";
export const INTRO_VIDEO_KEY = "book-intro-video";

/**
 * The one book machine, shared by the ref specification and the product
 * configuration so a generated module cannot present two different lifecycles.
 * The reader owns the `reading.ready` state for its whole lifetime; completion sends
 * `BOOK.COMPLETED` once, and the final action must not remove the reader view
 * because Previous and rereading survive activity completion.
 */
export function bookStateMachineDefinition(activityId: string): Record<string, unknown> {
  return {
    $schema: "https://waterford.org/schemas/activity-state-machine-1.1.json",
    version: "1.1",
    id: activityId,
    initial: BOOK_READING_STATE,
    states: {
      [BOOK_READING_STATE]: {
        description:
          "Native book reader: optional intro video, artwork and story narration, page navigation, reading delays and word taps.",
        initial: BOOK_READING_PHASE,
        states: { [BOOK_READING_PHASE]: { entry: { type: "enterReader" } } },
        on: {
          [BOOK_COMPLETE_EVENT]: { target: `#${activityId}.activity.complete` },
        },
      },
      activity: {
        initial: "complete",
        states: { complete: { entry: { type: "bookFinalize" }, type: "final" } },
      },
    },
  };
}

/**
 * The reader is one WAF scene covering every book page, so the runtime scene
 * catalog sees a single scene whose metadata lists all book media.
 */
export function bookActivityScenes(
  scenes: BookScene[],
  options: { introVideoKey?: string } = {},
): Record<string, unknown>[] {
  return [
    {
      id: BOOK_READING_STATE,
      description: "Book reader",
      imageKeys: scenes.map((scene) => scene.image.key).filter(Boolean),
      videoKeys: options.introVideoKey ? [options.introVideoKey] : [],
      animationKeys: [],
      audioKeys: scenes.flatMap((scene) => scene.audioCues.map((cue) => cue.key)).filter(Boolean),
    },
  ];
}
