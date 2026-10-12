/** An image prompt or a narration for one asset, written by an agent, or a translation of one. */
import path from "node:path";
import { HttpError } from "../../http/errors.js";
import { readCandidate } from "../artifact.js";
import type { MediaTextRun } from "../domain.js";
import {
  mediaTextPrompt,
  mediaTextTarget,
  parseMediaTextCandidate,
  type MediaTextTarget,
} from "../media-text.js";
import type { RunRequestOf } from "../run-request.js";
import { atomicJson } from "../service.js";
import { requireCompleted, type SessionRunKind } from "./contract.js";

/** What a media text run writes. */
export const MEDIA_TEXT_OUTPUT = "media-text.json";

export const mediaTextKind: SessionRunKind<
  RunRequestOf<"media-text">,
  MediaTextTarget,
  MediaTextRun
> = {
  run: "media-text",
  runner: "session",
  needsScript: true,
  check: async (_services, request, activity) => mediaTextTarget(activity, request.mediaText),
  record: (mediaText) => ({ mediaText }),
  async stage({ prepared, workspace }) {
    await atomicJson(path.join(workspace, "media-text-input.json"), prepared);
  },
  prompt: ({ prepared }) => mediaTextPrompt(prepared),
  outputs: [MEDIA_TEXT_OUTPUT],
  async collect({ run, workspace, observed, save }) {
    requireCompleted(observed, "Media text Session did not complete.");
    const text = parseMediaTextCandidate(
      await readCandidate(path.join(workspace, MEDIA_TEXT_OUTPUT), 64 * 1024),
      run.mediaText,
    );
    // The candidate's own four fields, not the target: a translation's target also carries
    // its source, which a candidate does not.
    run.candidate = JSON.stringify({
      language: run.mediaText.language,
      assetKey: run.mediaText.assetKey,
      type: run.mediaText.type,
      text,
    });
    save(run);
    return { kept: true, draftChanged: "The draft changed during media text generation." };
  },
  accept: {
    changed: {
      code: "media_text_changed",
      message: "Only a successful media text candidate can be accepted.",
    },
    ready: (run) => !!run.mediaText,
    draftChanged: async () =>
      new HttpError(
        409,
        "draft_conflict",
        "The draft changed since media text generation. Generate a new candidate.",
      ),
    apply(services, run, expectedRevision) {
      let text: string;
      try {
        text = parseMediaTextCandidate(run.candidate, run.mediaText);
      } catch {
        throw new HttpError(
          409,
          "media_text_changed",
          "The media text candidate is invalid. Generate a new candidate.",
        );
      }
      return services.activities.applyMediaText(
        run.projectId,
        run.activityId,
        run.mediaText,
        text,
        expectedRevision,
      );
    },
  },
};
