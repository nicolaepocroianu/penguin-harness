/** Sounds proposed for a decodable book's words that espeak-ng could not sound out. */
import path from "node:path";
import { HttpError } from "../../http/errors.js";
import { readCandidate } from "../artifact.js";
import type { PhonemesCandidate, PhonemesTarget } from "../book-word-types.js";
import type { PhonemesRun } from "../domain.js";
import {
  PHONEMES_FILE,
  PHONEMES_INPUT_FILE,
  parsePhonemesCandidate,
  phonemesPrompt,
  phonemesTarget,
} from "../phonemes-run.js";
import type { RunRequestOf } from "../run-request.js";
import { atomicJson } from "../service.js";
import { MINUTE_MS, requireCompleted, type SessionRunKind } from "./contract.js";

export const phonemesKind: SessionRunKind<RunRequestOf<"phonemes">, PhonemesTarget, PhonemesRun> = {
  run: "phonemes",
  runner: "session",
  // The words come from the book's plan, not its script.
  needsScript: false,
  // It writes the sounds of a book's words, one short document, and runs no program.
  limits: { wallClockMs: 15 * MINUTE_MS },
  check: async (_services, request, activity) => phonemesTarget(activity, request.phonemes),
  record: (phonemes) => ({ phonemes }),
  async stage({ prepared, workspace }) {
    await atomicJson(path.join(workspace, PHONEMES_INPUT_FILE), prepared);
  },
  prompt: () => phonemesPrompt,
  outputs: [PHONEMES_FILE],
  async collect({ run, workspace, observed, save }) {
    requireCompleted(observed, "Phonemes Session did not complete.");
    const candidate = parsePhonemesCandidate(
      await readCandidate(path.join(workspace, PHONEMES_FILE), 256 * 1024),
      run.phonemes,
    );
    run.candidate = JSON.stringify(candidate);
    save(run);
    return {
      kept: true,
      draftChanged: "The draft changed while the sounds were being proposed.",
    };
  },
  /**
   * The book words still without sounds get the sounds the run proposed: only a successful
   * run, and only on the draft it was run against.
   */
  accept: {
    changed: {
      code: "phonemes_changed",
      message: "Only a successful phonemes candidate can be accepted.",
    },
    draftChanged: async () =>
      new HttpError(
        409,
        "draft_conflict",
        "The draft changed since the sounds were proposed. Ask again.",
      ),
    apply: (services, run, expectedRevision) =>
      services.activities.applyPhonemes(
        run.projectId,
        run.activityId,
        JSON.parse(run.candidate) as PhonemesCandidate,
        expectedRevision,
      ),
  },
};
