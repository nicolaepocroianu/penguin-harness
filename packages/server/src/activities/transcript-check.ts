/**
 * Narration heard against narration written (experimental, behind `activityVideoExperiment`):
 * what a finished scene video's sound says, transcribed (see `LocalAudio.transcribe`), compared
 * word by word with the scripts of the narration it plays. A voice that skips or mangles words,
 * or reads punctuation aloud ("dot", "comma"), teaches the wrong thing; this finds both.
 *
 * The idea is the transcript check in OpenMontage's final review of a render
 * (github.com/calesthio/OpenMontage), as an idea only: its thresholds and wording are Penguin's.
 */

/** Below this share of the script's words heard, the narration does not match its script. */
export const NARRATION_ACCURACY = 0.9;
/** Spoken names of punctuation a speech model may read aloud. */
const SPOKEN_PUNCTUATION = new Set([
  "dot",
  "period",
  "comma",
  "colon",
  "semicolon",
  "hyphen",
  "dash",
  "slash",
  "quote",
  "exclamation",
]);

/** A text's words, lowercased, letters and digits only. */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}']+/gu, "").replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export interface TranscriptComparison {
  /** The share of the script's words heard, in order, from 0 to 1. */
  accuracy: number;
  /** Script words not heard, in script order. */
  missing: string[];
  /** Punctuation read aloud: heard, and not in the script. */
  spokenPunctuation: string[];
}

/**
 * Compares what was heard with the scripts, in order: the longest run of script words heard in
 * the same order (a longest common subsequence) over the script's length.
 */
export function compareTranscript(heard: string, scripts: readonly string[]): TranscriptComparison {
  const script = scripts.flatMap(wordsOf);
  const said = wordsOf(heard);
  if (!script.length) return { accuracy: 1, missing: [], spokenPunctuation: [] };
  // table[i][j]: the longest common subsequence of script[i..] and said[j..].
  const table = Array.from({ length: script.length + 1 }, () =>
    new Array<number>(said.length + 1).fill(0),
  );
  for (let i = script.length - 1; i >= 0; i -= 1)
    for (let j = said.length - 1; j >= 0; j -= 1)
      table[i]![j] =
        script[i] === said[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const missing: string[] = [];
  const matched = new Set<number>();
  for (let i = 0, j = 0; i < script.length;) {
    if (j < said.length && script[i] === said[j]) {
      matched.add(j);
      i += 1;
      j += 1;
    } else if (j < said.length && table[i]![j + 1]! >= table[i + 1]![j]!) j += 1;
    else {
      missing.push(script[i]!);
      i += 1;
    }
  }
  const written = new Set(script);
  const spokenPunctuation = [
    ...new Set(
      said.filter(
        (word, index) => !matched.has(index) && SPOKEN_PUNCTUATION.has(word) && !written.has(word),
      ),
    ),
  ];
  return {
    accuracy: Math.round((table[0]![0]! / script.length) * 100) / 100,
    missing,
    spokenPunctuation,
  };
}
