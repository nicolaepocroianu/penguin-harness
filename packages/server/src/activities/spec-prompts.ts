/**
 * The two specification passes' prompts, Loom's (`activity_spec_prompts.py`) adapted to how
 * a WAF Harness run works: the agent reads its inputs from the workspace and writes
 * `activity-spec.json`, rather than answering with the JSON. Their text is in prompts/spec.ts;
 * this module picks the parts a description calls for and fills them in.
 *
 * The first pass writes the scenes and keeps each description's media tags verbatim; the
 * second, `generate_media_spec`, lists the media those tags ask for in the exact places the
 * media plan reads (`scene.media.images`, `scene.media.video`, `scene.media.animations`,
 * `scene.audio.tracks`).
 */
import {
  MEDIA_SPEC_BOOK_PROMPT,
  MEDIA_SPEC_KEY_PRESERVATION,
  MEDIA_SPEC_PROMPT,
  MEDIA_SPEC_REPAIR_HEAD,
  SPEC_GENERAL_SCENE,
  SPEC_GENERATE_TASK,
  SPEC_NO_GENERAL_SCENE,
  SPEC_PROMPT,
  SPEC_REPAIR_HEAD,
  SPEC_REPAIR_PROMPT,
  SPEC_SCENE_COUNT,
  SPEC_SCENE_COUNT_GENERAL,
  SPEC_SHARED,
  SPEC_UPDATE_TASK,
} from "./prompts/spec.js";
import {
  GENERAL_SCENE_ID,
  GENERAL_SCENE_ROLE,
  expectedPrimarySceneCount,
  hasGeneralMediaSection,
} from "./spec-normalization.js";

/** The specification a first pass fills in, Loom's `activity_spec_template.json`. */
export const SPEC_TEMPLATE_FILE = "activity-spec-template.json";
export const SPEC_TEMPLATE = {
  id: "",
  title: "",
  runtime: {
    engine: "html",
    layout: "mainOnly",
    theme: "park",
    resolution: "640x480",
    usesAssessment: false,
  },
  activityDescription: "",
  scenes: [
    {
      id: "",
      description: "",
      media: { images: [], video: [], animations: [] },
      audio: { tracks: [] },
    },
  ],
  acceptance_criterias: [],
};

/** The specification a pass starts from, when there is one. */
export const CURRENT_SPEC_FILE = "current-activity-spec.json";

function generalSceneClause(description: string): string {
  return hasGeneralMediaSection(description)
    ? SPEC_GENERAL_SCENE({ GENERAL_SCENE_ID, GENERAL_SCENE_ROLE })
    : SPEC_NO_GENERAL_SCENE({ GENERAL_SCENE_ID });
}

function sceneCountClause(description: string): string {
  const expected = expectedPrimarySceneCount(description);
  if (expected === null) return "";
  return SPEC_SCENE_COUNT({
    expected,
    withGeneralScene: hasGeneralMediaSection(description)
      ? SPEC_SCENE_COUNT_GENERAL({ GENERAL_SCENE_ID })
      : "",
  });
}

/**
 * The first pass. With no specification yet it fills in the template; with one, it updates
 * it to the changed description, keeping scene ids and asset keys.
 */
export function activitySpecPrompt(description: string, hasCurrentSpec: boolean): string {
  const shared = SPEC_SHARED({
    sceneCount: sceneCountClause(description),
    generalScene: generalSceneClause(description),
  });
  const task = hasCurrentSpec
    ? SPEC_UPDATE_TASK({ CURRENT_SPEC_FILE, shared })
    : SPEC_GENERATE_TASK({ SPEC_TEMPLATE_FILE, shared });
  return SPEC_PROMPT({ task });
}

/** The media pass: list the media each scene's tags ask for, changing nothing else. */
export function mediaSpecPrompt(
  expectedSceneIds: string[],
  hasExistingMedia: boolean,
  book = false,
): string {
  const ids = JSON.stringify(expectedSceneIds);
  if (book) return MEDIA_SPEC_BOOK_PROMPT({ CURRENT_SPEC_FILE, expectedSceneIds: ids });
  return MEDIA_SPEC_PROMPT({
    CURRENT_SPEC_FILE,
    expectedSceneIds: ids,
    GENERAL_SCENE_ID,
    GENERAL_SCENE_ROLE,
    keyPreservation: hasExistingMedia ? MEDIA_SPEC_KEY_PRESERVATION : "",
  });
}

/**
 * Loom's repair prompts: the previous attempt's failure, then the original request. The
 * media pass's reminds it of the scene list it has to keep.
 */
export function repairPrompt(original: string, reason: string, expectedSceneIds?: string[]) {
  const head = expectedSceneIds
    ? MEDIA_SPEC_REPAIR_HEAD({ reason, expectedSceneIds: JSON.stringify(expectedSceneIds) })
    : SPEC_REPAIR_HEAD({ reason });
  return SPEC_REPAIR_PROMPT({ head, original });
}
