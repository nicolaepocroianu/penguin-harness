/**
 * A model run that proposes sounds for the words espeak-ng could not sound out.
 *
 * The run is an ordinary traced activity run: it is handed the words in
 * `phonemes-input.json`, writes `phonemes.json`, and what it wrote is checked here before it
 * becomes a candidate. Accepting the candidate fills only words that still have no sounds, so
 * nothing espeak-ng or the author gave a word is replaced by a guess.
 */
import { HttpError } from "../http/errors.js";
import { contentRevision, type ActivityDetail } from "./domain.js";
import { BOOK_WORD_MAX, cleanPhonemes, isBookWord, normalizeWord } from "./book-words.js";
import type { PhonemesCandidate, PhonemesTarget } from "./book-word-types.js";
import { PHONEMES_PROMPT } from "./prompts/phonemes.js";

export const PHONEMES_INPUT_FILE = "phonemes-input.json";
export const PHONEMES_FILE = "phonemes.json";
/** The most words one run is asked for. */
export const PHONEMES_RUN_MAX_WORDS = 200;

/** The phonemes prompt: its text is in prompts/phonemes.ts. */
export const phonemesPrompt = PHONEMES_PROMPT({ PHONEMES_FILE, PHONEMES_INPUT_FILE });

/** The words a run is asked for: normalized, known, unique, and a bounded number. */
export function phonemesTarget(
  activity: ActivityDetail,
  input: { language: string; words: unknown },
): PhonemesTarget {
  const plan = activity.draft.mediaPlan;
  if (
    !plan ||
    activity.draft.status !== "valid" ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(409, "media_stale", "Plan media from the saved specification first.");
  const group = plan.manifest.assets[input.language];
  if (!group)
    throw new HttpError(422, "phonemes_invalid", "The media plan has no such language group.");
  if (
    !Array.isArray(input.words) ||
    input.words.length < 1 ||
    input.words.length > PHONEMES_RUN_MAX_WORDS
  )
    throw new HttpError(
      400,
      "phonemes_invalid",
      `Ask for between 1 and ${PHONEMES_RUN_MAX_WORDS} words.`,
    );
  const known = new Set(
    group.filter((asset) => isBookWord(asset)).map((asset) => asset.normalizedWord),
  );
  const words: string[] = [];
  for (const raw of input.words) {
    const word = typeof raw === "string" ? normalizeWord(raw) : "";
    if (!word || word.length > BOOK_WORD_MAX || !known.has(word))
      throw new HttpError(
        422,
        "phonemes_invalid",
        "Every word must be one of the book's word pronunciations. Refresh the words first.",
      );
    if (!words.includes(word)) words.push(word);
  }
  return { language: input.language, words };
}

/**
 * What a run wrote, as a candidate: sounds for words it was asked about, each passing the
 * word asset's check. A word it left out stays without sounds; one it was not asked about, or
 * sounds that are not sounds, fail the run.
 */
export function parsePhonemesCandidate(text: string, target: PhonemesTarget): PhonemesCandidate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${PHONEMES_FILE} is not JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${PHONEMES_FILE} must be an object of words and their sounds.`);
  const asked = new Set(target.words);
  const phonemes: Record<string, string[]> = {};
  for (const [word, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!asked.has(word))
      throw new Error(`${PHONEMES_FILE} sounds out "${word}", which was not asked for.`);
    const sounds = cleanPhonemes(value);
    if (!sounds)
      throw new Error(
        `${PHONEMES_FILE} gives "${word}" sounds that are not 1 to 32 IPA segments of at most 8 characters.`,
      );
    phonemes[word] = sounds;
  }
  if (!Object.keys(phonemes).length) throw new Error(`${PHONEMES_FILE} sounds out no word.`);
  return { language: target.language, phonemes };
}
