/**
 * The languages an activity can be authored in, and where each one's media lives.
 *
 * Penguin's manifest has always been keyed by language and has always held exactly one
 * key. The validator accepts a hundred; nothing ever created a second. The rail's language
 * selector has one option, permanently.
 *
 * This is the data half. The table is Loom's, out of `activity-languages.json`: English as
 * the default, Spanish and Romanian as translation targets, each with the folder name its
 * media sits under. A closed table rather than an open regex, because a language is not
 * just a code — it needs a folder, a label, and a name a translator will recognise.
 */

export interface ActivityLanguage {
  code: string;
  /** What an author sees. */
  label: string;
  /** The directory media for this language sits in. */
  folder: string;
  /** How a translation request names it; absent for the language everything starts in. */
  translationName?: string;
}

export const DEFAULT_LANGUAGE_CODE = "en-US";

/** Loom's table, unchanged. Adding a language is adding a row here and nowhere else. */
export const ACTIVITY_LANGUAGES: readonly ActivityLanguage[] = [
  { code: "en-US", label: "English", folder: "english" },
  { code: "es-MX", label: "Spanish", folder: "spanish", translationName: "Mexican Spanish" },
  { code: "ro-RO", label: "Romanian", folder: "romanian", translationName: "Romanian" },
];

export function findLanguage(code: string): ActivityLanguage | undefined {
  return ACTIVITY_LANGUAGES.find((language) => language.code === code);
}

/** The languages an activity may be translated into: everything but the default. */
export function translationTargets(): ActivityLanguage[] {
  return ACTIVITY_LANGUAGES.filter((language) => language.code !== DEFAULT_LANGUAGE_CODE);
}

/**
 * The languages that could still be added to a manifest.
 *
 * What the "add a language" control offers. A language already present is not offered
 * again, and the default is never offered because it is always there.
 */
export function addableLanguages(present: readonly string[]): ActivityLanguage[] {
  const have = new Set(present);
  return translationTargets().filter((language) => !have.has(language.code));
}

export type AddLanguageRefusal =
  | { kind: "unknown"; message: string }
  | { kind: "already_present"; message: string }
  | { kind: "is_default"; message: string }
  | { kind: "default_missing"; message: string };

/**
 * Whether a language may be added, or why not.
 *
 * The default has to be there first. A manifest translated into Spanish with no English to
 * translate *from* is not a multi-language activity — it is a Spanish activity with the
 * default group missing, and every later stage would look for a source that is not there.
 */
export function canAddLanguage(
  present: readonly string[],
  code: string,
): AddLanguageRefusal | null {
  const language = findLanguage(code);
  if (!language)
    return {
      kind: "unknown",
      message: `"${code}" is not a language this product supports. Supported: ${ACTIVITY_LANGUAGES.map((entry) => entry.code).join(", ")}.`,
    };
  if (code === DEFAULT_LANGUAGE_CODE)
    return {
      kind: "is_default",
      message: `${language.label} is the language activities are authored in; it is always present.`,
    };
  if (present.includes(code))
    return { kind: "already_present", message: `${language.label} has already been added.` };
  if (!present.includes(DEFAULT_LANGUAGE_CODE))
    return {
      kind: "default_missing",
      message: `There is no ${DEFAULT_LANGUAGE_CODE} content to translate from.`,
    };
  return null;
}

/** Media directory names, by asset type. Loom's, and the plural forms matter. */
const MEDIA_FOLDERS: Record<string, string> = {
  image: "images",
  video: "videos",
  animation: "animations",
  audio: "audios",
};

/** Where one asset's file belongs, relative to the media root. */
export function mediaTargetPath(input: {
  productCode: string;
  refNum: number;
  type: string;
  assetKey: string;
  extension: string;
  language?: string;
}): string | null {
  const folder = MEDIA_FOLDERS[input.type];
  if (!folder) return null;
  const language = findLanguage(input.language ?? DEFAULT_LANGUAGE_CODE);
  if (!language) return null;
  const extension = input.extension.replace(/^\.+/, "");
  if (!extension) return null;
  return (
    `media/loom/${input.productCode}/${input.productCode}-${input.refNum}` +
    `/${folder}/${language.folder}/${input.assetKey}.${extension}`
  );
}

/**
 * Whether a manifest's language groups are coherent.
 *
 * Reported rather than thrown, because a manifest arriving from an import may be odd in
 * several ways at once and an author wants the whole list.
 */
export function languageProblems(languages: readonly string[]): string[] {
  const problems: string[] = [];
  if (!languages.includes(DEFAULT_LANGUAGE_CODE))
    problems.push(`The manifest has no ${DEFAULT_LANGUAGE_CODE} group to translate from.`);
  const seen = new Set<string>();
  for (const code of languages) {
    if (seen.has(code)) problems.push(`The manifest repeats the language "${code}".`);
    seen.add(code);
    if (!findLanguage(code))
      problems.push(`The manifest holds "${code}", which this product does not support.`);
  }
  return problems;
}
