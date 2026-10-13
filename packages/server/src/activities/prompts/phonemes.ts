/**
 * Prompt text only (decision 18): what a phonemes run's agent is told. Nothing here but text and
 * the names it is filled with: the bench lets a candidate recipe change this text and nothing
 * else, and phonemes-run.ts fills it in.
 */

export const PHONEMES_PROMPT = (values: {
  readonly PHONEMES_FILE: string;
  readonly PHONEMES_INPUT_FILE: string;
}) =>
  `Propose how each word in ${values.PHONEMES_INPUT_FILE} is sounded out, for a decodable reading book for young learners. Work in this workspace.
${values.PHONEMES_INPUT_FILE} holds {"language": "<language code>", "words": [...]}: lower-case words of that language.
Write exactly one JSON object to ${values.PHONEMES_FILE} using normal Harness tools, with no markdown: {"<word>": ["<sound>", ...], ...}, one key per word you can sound out, spelled exactly as listed.
Each sound is one IPA segment, the way the word is said in that language (American English for en-US): one segment per sound, in order, without stress marks, spaces or slashes, at most 8 characters each and at most 32 per word. Leave out a word you cannot sound out rather than guess.`;
