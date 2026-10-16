/**
 * An image for one asset of the media plan, made with no agent: the server runs the image
 * helper in the run's workspace, with the Media Agent's Vault, as it runs speech's and sound's,
 * and keeps the picture it wrote.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../http/errors.js";
import { readArtifactBytes } from "../artifact.js";
import type { ImageRun } from "../domain.js";
import {
  GENERATED_IMAGE_MAX_BYTES,
  imageTarget,
  type ImageResult,
  type ImageTarget,
} from "../generated-image.js";
import { MEDIA_HELPER_TIMEOUT_MS } from "../media-helper-runner.js";
import { IMAGE_STYLE } from "../media-style.js";
import type { RunRequestOf } from "../run-request.js";
import { atomicJson } from "../service.js";
import { AGENTHUB_VERSION } from "../sound-models.js";
import { RunRefusal, bundledMediaHelper, type ServerRunKind } from "./contract.js";

/** What an image run writes. */
export const IMAGE_OUTPUT = "image.png";

export const imageKind: ServerRunKind<RunRequestOf<"image">, ImageTarget, ImageRun> = {
  run: "image",
  runner: "server",
  mediaAgent: true,
  needsScript: true,
  // The helper's install and the helper itself each stop at MEDIA_HELPER_TIMEOUT_MS: the limit
  // leaves them that and as long again, so a slow provider meets the helper's own words first.
  limits: { wallClockMs: 4 * MEDIA_HELPER_TIMEOUT_MS },
  check: async (_services, request, activity) => imageTarget(activity, request.image),
  async authorize(services, _image, { projectId, agentId }) {
    if (!(await services.vaultKeys(projectId, agentId)).includes("GEMINI_API_KEY"))
      throw new RunRefusal(
        400,
        "image_credential_missing",
        "Add GEMINI_API_KEY to the Media Agent's Vault before generating an image.",
        "providerUnavailable",
      );
  },
  record: (image) => ({ image }),
  async stage({ prepared: image, workspace }) {
    const helper = bundledMediaHelper("generate-image.mjs", "image_helper_missing");
    // The house style travels with the request, not the run: an image is drawn in it.
    await atomicJson(path.join(workspace, "image-input.json"), { ...image, style: IMAGE_STYLE });
    // The same agenthub a Gemini narration installs, so both link the one cached install.
    await atomicJson(path.join(workspace, "package.json"), {
      private: true,
      type: "module",
      dependencies: { "@prismshadow/agenthub": AGENTHUB_VERSION },
    });
    await fs.writeFile(path.join(workspace, "generate-image.mjs"), helper, { flag: "wx" });
  },
  helper: () => ({ script: "generate-image.mjs", install: true }),
  missing: () => IMAGE_OUTPUT,
  async collect({ services, run, workspace, save }) {
    const bytes = await readArtifactBytes(
      path.join(workspace, IMAGE_OUTPUT),
      GENERATED_IMAGE_MAX_BYTES,
    );
    const result = await services.activities.storeImage(
      run.projectId,
      run.activityId,
      run.runId,
      bytes,
    );
    run.candidate = JSON.stringify(result);
    save(run);
    return { draftChanged: "The draft changed during image generation." };
  },
  accept: {
    changed: {
      code: "image_changed",
      message: "Only a successful image candidate can be accepted.",
    },
    ready: (run) => !!run.image,
    draftChanged: async () =>
      new HttpError(
        409,
        "draft_conflict",
        "The draft changed since image generation. Generate a new candidate.",
      ),
    apply(services, run, expectedRevision) {
      const result = JSON.parse(run.candidate) as ImageResult;
      if (result.runId !== run.runId)
        throw new HttpError(409, "image_changed", "Image candidate metadata changed.");
      return services.activities.applyImage(
        run.projectId,
        run.activityId,
        run.image,
        result,
        expectedRevision,
      );
    },
  },
};
