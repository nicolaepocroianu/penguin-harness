/**
 * A scene's recording (experimental). The server records it itself (see video-render-service),
 * so it is no kind a start makes; this is how a successful one is kept on its asset.
 */
import { HttpError } from "../../http/errors.js";
import type { VideoRun } from "../domain.js";
import type { VideoResult } from "../video-types.js";
import type { Acceptance } from "./contract.js";

export const videoKind: { run: "video"; experimental: true; accept: Acceptance<VideoRun> } = {
  run: "video",
  experimental: true,
  accept: {
    changed: { code: "video_changed", message: "Only a successful video recording can be kept." },
    ready: (run) => !!run.video,
    draftChanged: async () =>
      new HttpError(
        409,
        "draft_conflict",
        "The draft changed since the video was recorded. Record it again.",
      ),
    apply(services, run, expectedRevision) {
      const result = JSON.parse(run.candidate) as VideoResult;
      if (result.runId !== run.runId)
        throw new HttpError(409, "video_changed", "Video candidate metadata changed.");
      return services.activities.applyVideo(
        run.projectId,
        run.activityId,
        run.video!,
        result,
        expectedRevision,
      );
    },
  },
};
