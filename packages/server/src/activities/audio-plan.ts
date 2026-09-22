/**
 * What a narration run generates, and what it does to the translations.
 *
 * The audio stage is deterministic — it calls providers over HTTP, with no workspace, no
 * tools and no approvals. That matters for who uses this: most of the people driving the
 * pipeline are not engineers, and approving tool calls to get narration would be absurd.
 *
 * The rule that carries the weight is Loom's handling of translated audio when a source
 * script changes. A Spanish clip recorded from an English line that has since been
 * rewritten is not stale in a way anyone can hear — it is fluent, confident and no longer
 * what the activity says.
 */

/** The default language everything is authored in before translation. */
export const DEFAULT_LANGUAGE = "en-US";

export interface NarrationClip {
  key: string;
  /** The script this clip speaks. */
  script: string;
  /** Where the audio is bound, or undefined when nothing has been recorded. */
  path?: string;
  fileExists: boolean;
  /** The script the existing recording was made from, when it recorded one. */
  recordedFrom?: string;
}

export interface TranslatedClip {
  key: string;
  language: string;
  /** The default-language script this translation was made from. */
  translatedFrom?: string;
}

export type ClipDecision =
  { action: "record"; reason: string } | { action: "keep"; reason: string };

/**
 * Whether a clip needs recording.
 *
 * A recording with no remembered script is kept rather than redone: it may be a file an
 * author uploaded or accepted, and replacing it would discard a deliberate choice.
 */
export function clipDecision(clip: NarrationClip): ClipDecision {
  if (!clip.script.trim()) return { action: "keep", reason: "there is no script to speak" };
  if (!clip.path) return { action: "record", reason: "nothing has been recorded yet" };
  if (!clip.fileExists) return { action: "record", reason: "the recording is not there" };
  if (clip.recordedFrom === undefined)
    return { action: "keep", reason: "the recording remembers no script, so it is left alone" };
  if (clip.recordedFrom !== clip.script)
    return { action: "record", reason: "the script changed since this was recorded" };
  return { action: "keep", reason: "the recording already matches its script" };
}

export interface AudioPlan {
  record: string[];
  keep: string[];
  /** Translations dropped because the line they were made from was rewritten. */
  dropped: { key: string; language: string }[];
  /** Translations kept because their source line did not change. */
  preserved: { key: string; language: string }[];
}

/**
 * What a run over one activity's narration would do.
 *
 * A translation's fate follows its source. If the English line was rewritten, every
 * translation of it is dropped — keeping one would leave the activity saying different
 * things in different languages, and nothing in the product would notice.
 *
 * A translation whose source is unchanged is preserved explicitly rather than by accident,
 * so re-recording one clip does not silently discard the work of translating it.
 */
export function planNarration(
  clips: readonly NarrationClip[],
  translations: readonly TranslatedClip[],
): AudioPlan {
  const plan: AudioPlan = { record: [], keep: [], dropped: [], preserved: [] };
  const rewritten = new Set<string>();

  for (const clip of clips) {
    const decision = clipDecision(clip);
    if (decision.action === "record") {
      plan.record.push(clip.key);
      // Only a CHANGED script invalidates a translation. A clip being recorded because
      // its file went missing is the same words, so its translations still stand.
      if (decision.reason.startsWith("the script changed")) rewritten.add(clip.key);
    } else plan.keep.push(clip.key);
  }

  const scripts = new Map(clips.map((clip) => [clip.key, clip.script]));
  for (const translation of translations) {
    const source = scripts.get(translation.key);
    const stale =
      rewritten.has(translation.key) ||
      (translation.translatedFrom !== undefined &&
        source !== undefined &&
        translation.translatedFrom !== source);
    const entry = { key: translation.key, language: translation.language };
    if (stale) plan.dropped.push(entry);
    else plan.preserved.push(entry);
  }
  return plan;
}

/** Translations that will be dropped, grouped by clip, for a warning worth reading. */
export function droppedByClip(plan: AudioPlan): { key: string; languages: string[] }[] {
  const grouped = new Map<string, string[]>();
  for (const entry of plan.dropped) {
    const languages = grouped.get(entry.key) ?? [];
    languages.push(entry.language);
    grouped.set(entry.key, languages);
  }
  return [...grouped]
    .map(([key, languages]) => ({ key, languages: [...languages].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * One line about what a run will do.
 *
 * Dropped translations are stated as loudly as recordings, because that is the part an
 * author did not ask for. Somebody rewriting one English line should learn here that two
 * Spanish clips are about to disappear, not afterwards.
 */
export function describeNarrationPlan(plan: AudioPlan): string {
  const parts: string[] = [];
  parts.push(
    plan.record.length === 0
      ? "No narration needs recording."
      : `Recording ${plan.record.length} ${plan.record.length === 1 ? "clip" : "clips"}.`,
  );
  if (plan.keep.length) parts.push(`${plan.keep.length} already current.`);
  const dropped = droppedByClip(plan);
  if (dropped.length) {
    const detail = dropped
      .map((entry) => `${entry.key} (${entry.languages.join(", ")})`)
      .join(", ");
    const count = plan.dropped.length;
    parts.push(
      `Dropping ${count} stale ${count === 1 ? "translation" : "translations"} whose source line changed: ${detail}.`,
    );
  }
  if (plan.preserved.length)
    parts.push(
      `Keeping ${plan.preserved.length} ${plan.preserved.length === 1 ? "translation" : "translations"}.`,
    );
  return parts.join(" ");
}
