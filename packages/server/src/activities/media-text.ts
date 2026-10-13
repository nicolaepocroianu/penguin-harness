import { contentRevision, type ActivityDetail } from "./domain.js";
import type { MediaAsset } from "./media.js";
import { HttpError } from "../http/errors.js";
import { DEFAULT_LANGUAGE_CODE, findLanguage } from "./languages.js";
import { IMAGE_STYLE, NARRATION_WRITING } from "./media-style.js";
import {
  MEDIA_TEXT_AUDIO_FIELD,
  MEDIA_TEXT_AUDIO_GUIDANCE,
  MEDIA_TEXT_IMAGE_FIELD,
  MEDIA_TEXT_IMAGE_GUIDANCE,
  MEDIA_TEXT_PROMPT,
  MEDIA_TEXT_TRANSLATION_PROMPT,
} from "./prompts/media-text.js";

export interface MediaTextTarget {
  language: string;
  assetKey: string;
  type: "image" | "audio";
  /** The asset's text when the run started; accepting checks it has not moved since. */
  text: string;
  /**
   * Present on a translation: the default-language script it translates, and the name a
   * translator knows the target language by. Accepting records the source on the asset.
   */
  translation?: { from: string; languageName: string };
}

export function mediaTextTarget(
  activity: ActivityDetail,
  input: { language: string; assetKey: string; translate?: boolean },
): MediaTextTarget {
  const plan = activity.draft.mediaPlan;
  if (
    activity.draft.status !== "valid" ||
    !plan ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(409, "media_stale", "Rebuild the media plan before improving media text.");
  const asset = plan.manifest.assets[input.language]?.find((item) => item.key === input.assetKey);
  if (!asset || (asset.type !== "image" && asset.type !== "audio"))
    throw new HttpError(422, "media_text_invalid", "Select an image or audio asset.");
  if (input.translate) {
    const language = findLanguage(input.language);
    const source = plan.manifest.assets[DEFAULT_LANGUAGE_CODE]?.find(
      (item) => item.key === input.assetKey,
    );
    if (asset.type !== "audio" || !language?.translationName || !source?.script?.trim())
      throw new HttpError(
        422,
        "media_text_invalid",
        `Only a narration with a ${DEFAULT_LANGUAGE_CODE} script can be translated, into a language other than ${DEFAULT_LANGUAGE_CODE}.`,
      );
    return {
      language: input.language,
      assetKey: input.assetKey,
      type: "audio",
      text: asset.script ?? "",
      translation: { from: source.script, languageName: language.translationName },
    };
  }
  return {
    language: input.language,
    assetKey: input.assetKey,
    type: asset.type,
    text: asset.type === "image" ? asset.description : (asset.script ?? ""),
  };
}

/** The prompt for one media-text run; its text is in prompts/media-text.ts. */
export function mediaTextPrompt(target: MediaTextTarget): string {
  const language = JSON.stringify(target.language);
  const assetKey = JSON.stringify(target.assetKey);
  if (target.translation)
    return MEDIA_TEXT_TRANSLATION_PROMPT({
      languageName: target.translation.languageName,
      language,
      assetKey,
    });
  const image = target.type === "image";
  return MEDIA_TEXT_PROMPT({
    field: image ? MEDIA_TEXT_IMAGE_FIELD : MEDIA_TEXT_AUDIO_FIELD,
    // The house style the media is made in (media-style.ts).
    guidance: image
      ? MEDIA_TEXT_IMAGE_GUIDANCE({ IMAGE_STYLE })
      : MEDIA_TEXT_AUDIO_GUIDANCE({ NARRATION_WRITING }),
    language,
    assetKey,
    type: JSON.stringify(target.type),
  });
}

export function parseMediaTextCandidate(value: string, target: MediaTextTarget): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Media text candidate is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Media text candidate must be an object.");
  const candidate = parsed as Record<string, unknown>;
  if (
    Object.keys(candidate).some((key) => !["language", "assetKey", "type", "text"].includes(key)) ||
    candidate.language !== target.language ||
    candidate.assetKey !== target.assetKey ||
    candidate.type !== target.type ||
    typeof candidate.text !== "string" ||
    !candidate.text.trim() ||
    candidate.text.length > 5000
  )
    throw new Error("Media text candidate does not match the selected asset.");
  return candidate.text;
}

export function mediaTextField(asset: MediaAsset): string {
  return asset.type === "image" ? asset.description : (asset.script ?? "");
}
