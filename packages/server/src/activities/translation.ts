/**
 * Translating narration scripts, and knowing which translations are still true.
 *
 * Loom translates the SCRIPT, then records the new script against the language and speaks
 * it. That ordering is the whole design: a translation is a piece of text an author can
 * read and correct, not an opaque audio file. Somebody who speaks Spanish can look at what
 * the activity will say before a single clip is recorded.
 *
 * It also means a translation carries the source it came from, which is what lets a
 * rewritten English line invalidate exactly the translations made from it — the rule the
 * narration planner already relies on.
 */
import { DEFAULT_LANGUAGE_CODE, findLanguage, translationTargets } from "./languages.js";

export interface SourceScript {
  key: string;
  /** The default-language text. */
  script: string;
}

export interface ExistingTranslation {
  key: string;
  language: string;
  script: string;
  /** The default-language text this was translated from. */
  translatedFrom?: string;
}

export type TranslationNeed =
  /** Never translated into this language. */
  | { kind: "missing"; key: string; language: string }
  /** Translated, but from a line that has since been rewritten. */
  | { kind: "stale"; key: string; language: string; was: string; now: string };

export interface TranslationPlan {
  needed: TranslationNeed[];
  /** Translations that are still true. */
  current: { key: string; language: string }[];
  /** Translations for scripts that no longer exist. */
  orphaned: { key: string; language: string }[];
}

/**
 * What translating into one language would involve.
 *
 * A source script with nothing in it is skipped rather than translated: an empty line
 * translates to an empty line, and asking a model to do it spends a call to learn nothing.
 */
export function planTranslation(
  sources: readonly SourceScript[],
  existing: readonly ExistingTranslation[],
  languages: readonly string[],
): TranslationPlan {
  const plan: TranslationPlan = { needed: [], current: [], orphaned: [] };
  const byKey = new Map(sources.map((source) => [source.key, source.script]));
  const wanted = languages.filter((code) => code !== DEFAULT_LANGUAGE_CODE && findLanguage(code));

  for (const translation of existing) {
    const source = byKey.get(translation.key);
    if (source === undefined) {
      plan.orphaned.push({ key: translation.key, language: translation.language });
      continue;
    }
    if (translation.translatedFrom !== undefined && translation.translatedFrom !== source)
      plan.needed.push({
        kind: "stale",
        key: translation.key,
        language: translation.language,
        was: translation.translatedFrom,
        now: source,
      });
    else plan.current.push({ key: translation.key, language: translation.language });
  }

  const have = new Set(existing.map((entry) => `${entry.key}\u0000${entry.language}`));
  for (const source of sources) {
    // An empty line translates to an empty line; asking a model spends a call to learn
    // nothing.
    if (!source.script.trim()) continue;
    for (const language of wanted)
      if (!have.has(`${source.key}\u0000${language}`))
        plan.needed.push({ kind: "missing", key: source.key, language });
  }
  return plan;
}

export interface TranslationRequest {
  key: string;
  language: string;
  /** The name a translator recognises, not the code. */
  languageName: string;
  script: string;
}

/**
 * The requests a plan turns into, in a stable order.
 *
 * Ordered by key then language so a run is reproducible and a partial run can be resumed
 * without guessing where it stopped.
 */
export function translationRequests(
  sources: readonly SourceScript[],
  plan: TranslationPlan,
): TranslationRequest[] {
  const byKey = new Map(sources.map((source) => [source.key, source.script]));
  return plan.needed
    .map((need) => {
      const language = findLanguage(need.language);
      const script = byKey.get(need.key);
      if (!language?.translationName || script === undefined) return null;
      return {
        key: need.key,
        language: need.language,
        languageName: language.translationName,
        script,
      };
    })
    .filter((request): request is TranslationRequest => request !== null)
    .sort((a, b) => a.key.localeCompare(b.key) || a.language.localeCompare(b.language));
}

/**
 * The record a completed translation leaves.
 *
 * `translatedFrom` is the point of it: without the source text, nothing can later tell a
 * translation that is still true from one whose English was rewritten, and the activity
 * ends up saying different things in different languages.
 */
export function translationRecord(
  request: TranslationRequest,
  translated: string,
): ExistingTranslation {
  return {
    key: request.key,
    language: request.language,
    script: translated,
    translatedFrom: request.script,
  };
}

/** One line about what translating would do, with the reasons kept apart. */
export function describeTranslationPlan(plan: TranslationPlan): string {
  const missing = plan.needed.filter((need) => need.kind === "missing").length;
  const stale = plan.needed.filter((need) => need.kind === "stale").length;
  const parts: string[] = [];
  if (!plan.needed.length) parts.push("Every script is translated.");
  else {
    const bits: string[] = [];
    if (missing) bits.push(`${missing} never translated`);
    // Kept apart from "missing" because they are different situations: one is work not
    // done, the other is work that has to be done again because the English moved.
    if (stale) bits.push(`${stale} whose source line changed`);
    parts.push(`Translating ${plan.needed.length}: ${bits.join(", ")}.`);
  }
  if (plan.current.length) parts.push(`${plan.current.length} already current.`);
  if (plan.orphaned.length)
    parts.push(
      `${plan.orphaned.length} ${plan.orphaned.length === 1 ? "translation has" : "translations have"} no script left to match.`,
    );
  return parts.join(" ");
}

/** Every language a plan would translate into, for a progress display. */
export function languagesInPlan(plan: TranslationPlan): string[] {
  return [...new Set(plan.needed.map((need) => need.language))].sort();
}

/** The targets offered when an author asks to translate everything. */
export function allTranslationTargets(): string[] {
  return translationTargets().map((language) => language.code);
}
