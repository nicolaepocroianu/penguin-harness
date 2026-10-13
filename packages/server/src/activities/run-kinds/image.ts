/** An image for one asset of the media plan, drawn by the Media Agent with the image helper. */
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
import { IMAGE_STYLE } from "../media-style.js";
import type { RunRequestOf } from "../run-request.js";
import { atomicJson } from "../service.js";
import { AGENTHUB_VERSION } from "../sound-models.js";
import {
  RunRefusal,
  bundledMediaHelper,
  requireCompleted,
  type SessionRunKind,
} from "./contract.js";
import { IMAGE_PROMPT } from "../prompts/image.js";

/** What an image run writes. */
export const IMAGE_OUTPUT = "image.png";

export const imageKind: SessionRunKind<RunRequestOf<"image">, ImageTarget, ImageRun> = {
  run: "image",
  runner: "session",
  mediaAgent: true,
  needsScript: true,
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
    await atomicJson(path.join(workspace, "package.json"), {
      private: true,
      type: "module",
      dependencies: { "@prismshadow/agenthub": AGENTHUB_VERSION },
    });
    await fs.writeFile(path.join(workspace, "generate-image.mjs"), helper, { flag: "wx" });
  },
  prompt: () => IMAGE_PROMPT,
  outputs: [IMAGE_OUTPUT],
  async collect({ services, run, workspace, observed, save }) {
    requireCompleted(observed, "Image Session did not complete.");
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
    return { kept: true, draftChanged: "The draft changed during image generation." };
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
