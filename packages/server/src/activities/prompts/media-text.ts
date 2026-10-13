/**
 * Prompt text only (decision 18): what a media-text run's agent is told, to translate a
 * narration or to improve one image prompt or spoken script. Nothing here but text and the
 * names it is filled with: the bench lets a candidate recipe change this text and nothing
 * else, and media-text.ts fills it in.
 */

/** A translation of a default-language narration. The language and key come JSON-quoted. */
export const MEDIA_TEXT_TRANSLATION_PROMPT = (values: {
  readonly languageName: string;
  readonly language: string;
  readonly assetKey: string;
}) => `Read input.json for the saved activity context and media-text-input.json for the selected target.
Translate the spoken script in media-text-input.json's translation.from into ${values.languageName}, for young learners hearing it read aloud. Keep its meaning, tone and length; translate every word that will be spoken, and leave anything a learner must find or say (a letter, a sound, a word being taught) as the activity needs it.
Write only spoken words: no SSML, markup, stage directions or notes.
Do not change the activity structure, scene ids, asset key, media type, usages, or any other asset. Do not run media generators, delegate, or change any other files.
Write exactly one JSON object to media-text.json using normal Harness tools, with no markdown or extra fields:
{"language":${values.language},"assetKey":${values.assetKey},"type":"audio","text":"the translated script, non-empty and at most 5000 characters"}`;

/** What the field being improved is called, for an image and for audio. */
export const MEDIA_TEXT_IMAGE_FIELD = "image prompt";
export const MEDIA_TEXT_AUDIO_FIELD = "spoken script";

/**
 * How to improve an image prompt: describe what to draw and leave the drawing style, the house
 * style (media-style.ts), to the image run.
 */
export const MEDIA_TEXT_IMAGE_GUIDANCE = (values: { readonly IMAGE_STYLE: string }) =>
  `For an image, describe what the picture shows using the activity and scene context: the subject, what it is doing, and anything the learner must notice. Every image is drawn in this house style, so do not restate it or ask for a different one:\n${values.IMAGE_STYLE}`;

/** How to improve a spoken script: written to be spoken, in the house style. */
export const MEDIA_TEXT_AUDIO_GUIDANCE = (values: { readonly NARRATION_WRITING: string }) =>
  `For audio, improve only the spoken script; do not add SSML, markup, or stage directions. Write it in this house style:\n${values.NARRATION_WRITING}`;

/** Improving one image prompt or spoken script. The language, key and type come JSON-quoted. */
export const MEDIA_TEXT_PROMPT = (values: {
  readonly field: string;
  readonly guidance: string;
  readonly language: string;
  readonly assetKey: string;
  readonly type: string;
}) => `Read input.json for the saved activity context and media-text-input.json for the selected target.
Improve only the selected ${values.field} for the existing media asset, preserving its source intent and language.
${values.guidance}
Do not change the activity structure, scene ids, asset key, media type, usages, or any other asset. Do not run media generators, delegate, or change any other files.
Write exactly one JSON object to media-text.json using normal Harness tools, with no markdown or extra fields:
{"language":${values.language},"assetKey":${values.assetKey},"type":${values.type},"text":"a non-empty replacement text of at most 5000 characters"}
Read the current ${values.field} from media-text-input.json before writing the candidate.`;
