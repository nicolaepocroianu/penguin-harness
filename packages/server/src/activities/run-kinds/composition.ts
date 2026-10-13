/**
 * A scene composition (experimental): an agent writes an animated HTML page for one scene of a
 * video or animation asset, from its description and its bound images, building on the best
 * version so far.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../http/errors.js";
import { readArtifactBytes, readCandidate } from "../artifact.js";
import {
  COMPOSITION_BRIDGE,
  COMPOSITION_BRIDGE_FILE,
  COMPOSITION_FILE,
  COMPOSITION_FRAMES_FILE,
  COMPOSITION_FRAMES_MAX_BYTES,
  COMPOSITION_GSAP_FILE,
  COMPOSITION_IMAGE_DIR,
  COMPOSITION_INPUT_FILE,
  COMPOSITION_MAX_BYTES,
  COMPOSITION_PREVIOUS_FILE,
  COMPOSITION_PREVIOUS_FRAMES_FILE,
  COMPOSITION_SKILL,
  COMPOSITION_SKILL_FILE,
  COMPOSITION_TEMPLATE_FILE,
  CompositionProblem,
  compositionInput,
  compositionProblem,
  compositionPrompt,
  compositionScene,
  compositionTemplate,
  findingForAgent,
  gsapSource,
  imageExtension,
  parseFrames,
  sha256,
  stagedFiles,
  type CompositionScene,
} from "../composition.js";
import { lintComposition, lintForAgent } from "../composition-lint.js";
import type {
  CompositionCandidate,
  CompositionTarget,
  SceneCritique,
} from "../composition-types.js";
import type { ActivityDetail, ActivityRunSummary, CompositionRun } from "../domain.js";
import { IMAGE_MAX_BYTES as COMPOSITION_IMAGE_MAX_BYTES } from "../image.js";
import type { RunRequestOf } from "../run-request.js";
import { COMPOSITION_LOOK_FILE, COMPOSITION_LOOK_GUIDE, sceneLook } from "../scene-looks.js";
import { critiqueForAgent } from "../scene-critique.js";
import { atomicJson } from "../service.js";
import {
  authoringSkill,
  experimentOff,
  requireCompleted,
  type RunKindServices,
  type SessionRunKind,
} from "./contract.js";

/** What a composition run stages, read and checked before the run is recorded. */
interface CompositionStage {
  scene: CompositionScene;
  target: CompositionTarget;
  bytes: Uint8Array[];
  /** What the version built on was found to get wrong, as instructions to the agent. */
  previous: string[];
  /** The version built on: its page and frames, for the agent to start from. */
  previousPage?: { html: string; frames: CompositionCandidate["frames"] };
}

/**
 * Everything a composition run stages, read before the run is recorded so a refusal leaves
 * no run behind: the scene, and the bytes of each of its bound images. A scene with no image
 * is composed from HTML, CSS and SVG alone. 403 while the experiment is off.
 */
async function compositionStage(
  services: RunKindServices,
  projectId: string,
  activity: ActivityDetail,
  input: { language: string; assetKey: string; look?: string },
): Promise<CompositionStage> {
  if (!services.videoExperiment()) throw experimentOff();
  const activityId = activity.id;
  const scene = compositionScene(activity, input);
  if (input.look !== undefined && !sceneLook(input.look))
    throw new HttpError(400, "scene_look_unknown", "There is no such scene look.");
  const images: CompositionTarget["images"] = [];
  const bytes: Uint8Array[] = [];
  for (const image of scene.images) {
    // An image that cannot be read now is refused, never left out of the scene quietly.
    const content = await services.activities.imageContent(projectId, activityId, {
      language: input.language,
      assetKey: image.key,
      expectedRevision: activity.draft.contentRevision,
    });
    // Staged images are served back only up to this size, so a larger one is refused now
    // rather than missing from the composition later.
    if (content.bytes.byteLength > COMPOSITION_IMAGE_MAX_BYTES)
      throw new HttpError(
        409,
        "composition_image_too_large",
        "A scene image is larger than 8 MB. Bind a smaller image before composing.",
      );
    images.push({
      key: image.key,
      file: `${COMPOSITION_IMAGE_DIR}/${image.key}.${imageExtension(content.mimeType)}`,
      sha256: sha256(content.bytes),
    });
    bytes.push(content.bytes);
  }
  // Compose again builds on the best version so far, as open-design's critique loop keeps its
  // best round (a ratchet): the composition whose recording a critique scored highest, or else
  // the newest, with what its recording, its source and that critique found to fix.
  const runs = await services.list(projectId, activityId);
  const ofAsset = (target: { language: string; assetKey: string } | undefined) =>
    target?.language === input.language && target.assetKey === input.assetKey;
  const succeeded = (run: ActivityRunSummary) => run.status === "succeeded" && run.hasCandidate;
  const compositions = runs.filter(
    (run) => run.kind === "composition" && succeeded(run) && ofAsset(run.composition),
  );
  const recordings = runs.filter(
    (run) =>
      run.kind === "video" && succeeded(run) && ofAsset(run.video) && !run.video?.fromTimeline,
  );
  // Runs are listed newest first, so a tie keeps the newer critique.
  const best = runs
    .filter(
      (run) =>
        run.kind === "critique" &&
        succeeded(run) &&
        ofAsset(run.critique) &&
        run.critique?.score !== undefined,
    )
    .reduce<ActivityRunSummary | null>(
      (top, run) => (!top || run.critique!.score! > top.critique!.score! ? run : top),
      null,
    );
  const base = best
    ? compositions.find((run) => run.runId === best.critique!.compositionRunId)
    : compositions[0];
  const recording = best
    ? recordings.find((run) => run.runId === best.critique!.recordingRunId)
    : recordings.find((run) => run.video!.compositionRunId === base?.runId);
  const check = recording?.video?.check;
  const kept = base
    ? (JSON.parse(
        (await services.run(projectId, activityId, base.runId)).candidate ?? "null",
      ) as CompositionCandidate | null)
    : null;
  const critique = best
    ? (JSON.parse(
        (await services.run(projectId, activityId, best.runId)).candidate ?? "null",
      ) as SceneCritique | null)
    : null;
  // The page itself, while it is still the one that was kept.
  let previousPage: CompositionStage["previousPage"];
  if (base && kept) {
    const html = await readArtifactBytes(
      path.join(
        services.workspace((await services.run(projectId, activityId, base.runId)).runId),
        COMPOSITION_FILE,
      ),
      COMPOSITION_MAX_BYTES,
    ).catch(() => null);
    if (html && sha256(html) === kept.sha256)
      previousPage = { html: html.toString("utf8"), frames: kept.frames };
  }
  const previous = [
    ...(check ? check.findings.flatMap((finding) => findingForAgent(finding, check) ?? []) : []),
    ...(kept?.lint ?? []).map(lintForAgent),
    // The most important few: a long list of fixes at once tends to break what worked.
    ...(critique ? critiqueForAgent({ ...critique, fixes: critique.fixes.slice(0, 4) }) : []),
  ];
  return {
    scene,
    target: {
      language: input.language,
      assetKey: input.assetKey,
      sceneId: scene.sceneId,
      width: scene.width,
      height: scene.height,
      images,
      ...(input.look ? { look: input.look } : {}),
    },
    bytes,
    previous,
    ...(previousPage ? { previousPage } : {}),
  };
}

/** Stages a composition run's input, template, scripts and images into its workspace. */
async function stageComposition(workspace: string, stage: CompositionStage): Promise<void> {
  const { scene, target } = stage;
  await atomicJson(
    path.join(workspace, COMPOSITION_INPUT_FILE),
    compositionInput(scene, target, stage.previous),
  );
  await fs.writeFile(
    path.join(workspace, COMPOSITION_TEMPLATE_FILE),
    compositionTemplate(target.width, target.height),
    { flag: "wx" },
  );
  // Copies for the agent to read; the preview serves the scripts from Penguin, not these.
  await fs.writeFile(path.join(workspace, COMPOSITION_GSAP_FILE), await gsapSource(), {
    flag: "wx",
  });
  await fs.writeFile(path.join(workspace, COMPOSITION_BRIDGE_FILE), COMPOSITION_BRIDGE, {
    flag: "wx",
  });
  if (stage.previousPage) {
    await fs.writeFile(path.join(workspace, COMPOSITION_PREVIOUS_FILE), stage.previousPage.html, {
      flag: "wx",
    });
    await atomicJson(path.join(workspace, COMPOSITION_PREVIOUS_FRAMES_FILE), {
      frames: stage.previousPage.frames,
    });
  }
  const look = target.look ? sceneLook(target.look) : null;
  if (look) {
    // Copies for the agent to read; the preview serves look.css from the plugin, not this.
    await fs.writeFile(path.join(workspace, COMPOSITION_LOOK_GUIDE), look.design, { flag: "wx" });
    await fs.writeFile(path.join(workspace, COMPOSITION_LOOK_FILE), look.css, { flag: "wx" });
  }
  await fs.mkdir(path.join(workspace, COMPOSITION_IMAGE_DIR), { recursive: true });
  for (const [index, image] of target.images.entries())
    await fs.writeFile(path.join(workspace, ...image.file.split("/")), stage.bytes[index]!, {
      flag: "wx",
    });
}

/**
 * What a composition run wrote, checked: the page (512 KB at most, only staged files, no
 * network, no randomness, one timeline) and its frames. Throws a `CompositionProblem` naming
 * the first thing wrong; a missing page stays ENOENT, which names both files.
 */
async function collectComposition(
  workspace: string,
  target: CompositionTarget,
): Promise<CompositionCandidate> {
  let html: Buffer;
  try {
    html = await readArtifactBytes(path.join(workspace, COMPOSITION_FILE), COMPOSITION_MAX_BYTES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new CompositionProblem("composition_size", `${COMPOSITION_FILE} is larger than 512 KB.`);
  }
  let frames: string;
  try {
    frames = await readCandidate(
      path.join(workspace, COMPOSITION_FRAMES_FILE),
      COMPOSITION_FRAMES_MAX_BYTES,
    );
  } catch (error) {
    throw new CompositionProblem(
      "composition_frames",
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? `The session ended without ${COMPOSITION_FRAMES_FILE}.`
        : `${COMPOSITION_FRAMES_FILE} is larger than 64 KB.`,
    );
  }
  const problem = compositionProblem(html.toString("utf8"), stagedFiles(target));
  if (problem) throw problem;
  const parsed = parseFrames(frames);
  const lint = lintComposition(html.toString("utf8"));
  return { ...parsed, sha256: sha256(html), bytes: html.length, ...(lint.length ? { lint } : {}) };
}

export const compositionKind: SessionRunKind<
  RunRequestOf<"composition">,
  CompositionStage,
  CompositionRun
> = {
  run: "composition",
  runner: "session",
  experimental: true,
  needsScript: true,
  check: (services, request, activity, projectId) =>
    compositionStage(services, projectId, activity, request.composition),
  record: ({ target }) => ({ composition: target }),
  async stage({ prepared, workspace }) {
    await stageComposition(workspace, prepared);
    // How to compose a scene, from the waf-authoring plugin (see its skill).
    const skill = authoringSkill(
      COMPOSITION_SKILL,
      "composition_skill_missing",
      "scene composition skill",
    );
    await fs.writeFile(path.join(workspace, COMPOSITION_SKILL_FILE), skill, "utf8");
  },
  prompt: () => compositionPrompt,
  outputs: [COMPOSITION_FILE, COMPOSITION_FRAMES_FILE],
  async collect({ run, workspace, observed, save }) {
    requireCompleted(observed, "Composition Session did not complete.");
    const candidate = await collectComposition(workspace, run.composition);
    run.candidate = JSON.stringify(candidate);
    save(run);
    return { kept: true, draftChanged: "The draft changed while the scene was being composed." };
  },
  // The App words a failed check by its code; the message stays for the trace.
  failed(run, error) {
    if (error instanceof CompositionProblem && run.composition)
      run.composition = { ...run.composition, problem: error.code };
  },
};
