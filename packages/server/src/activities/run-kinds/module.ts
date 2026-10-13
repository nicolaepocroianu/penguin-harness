/**
 * Module assembly: an agent builds the product's WAF module from the saved specification, in
 * a scaffold copied from the shared checkout, and checks it in the real player.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ProtectedRoot } from "@prismshadow/penguin-core";
import { HttpError } from "../../http/errors.js";
import { readArtifactBytes, readCandidate } from "../artifact.js";
import { validateBookSpec } from "../book.js";
import { compileBookConfiguration, type BookMode } from "../book-configuration.js";
import {
  contentRevision,
  validateActivitySpec,
  type ActivityDetail,
  type ActivityRunFields,
  type ModuleRun,
} from "../domain.js";
import {
  ACCEPTANCE_HARNESS_FILE,
  ACCEPTANCE_INPUT_FILE,
  ACCEPTANCE_REPORT_DIR,
  ACCEPTANCE_REPORT_FILE,
  ACCEPTANCE_RESULTS_FILE,
  ACCEPTANCE_RUNNER_FILE,
  ACCEPTANCE_TEST_FILE,
  TEST_FILE_MAX_BYTES,
  activityHarnessSource,
  runAcceptanceSource,
} from "../acceptance-harness.js";
import {
  acceptanceCriteria,
  failedChecks,
  readAcceptanceReport,
  specSceneIds,
  testFileHash,
} from "../acceptance-collect.js";
import { playwrightVersion } from "../acceptance-service.js";
import {
  RUN_FEATURES_FILE,
  featureClause,
  type ImplementationFeature,
} from "../implementation-features.js";
import { linkModuleDependencies } from "../media-helper-runner.js";
import { viewportOf } from "../quality-check.js";
import type { RunRequestOf } from "../run-request.js";
import { moduleDocumentPath, refSpecPath } from "../waf-layout.js";
import { atomicJson } from "../service.js";
import { playwrightCoreDir } from "../test-browser.js";
import {
  PLAYER_CHECK_DIR,
  REPAIR_DIR,
  REPAIR_FILE,
  collectModule,
  modulePrompt,
  moduleRepairClause,
  prepareModule,
  restoreApprovedManifest,
  syncAssembledStateMachine,
  verifyMediaArtifacts,
} from "../waf-module.js";
import {
  hasValidSpec,
  requireCompleted,
  type RunKindServices,
  type SessionRunKind,
} from "./contract.js";
import { MODULE_BOOK_CLAUSE, MODULE_PACKAGES_CLAUSE } from "../prompts/module.js";

/** What an assembly writes: the files it built, listed. */
export const MODULE_OUTPUT = "module-result.json";

/** Where a WAF module scaffold's packages are installed once and linked into each run. */
export function modulePackagesRoot(root: string): string {
  return path.join(root, "module-packages-cache");
}

/** What a repair round starts from and answers. */
interface ModuleRepair {
  fromRunId: string;
  testRunId: string;
  /** The checks that ran and saw the module do something wrong, as `REPAIR_FILE` lists them. */
  failed: { criterion: string; testName: string; saw: string | null }[];
  /** The test file those checks are in. */
  testFile: string;
}

interface ModulePrepared {
  wafRoot: string;
  bookMode?: BookMode;
  repair?: ModuleRepair;
}

/** What a repair starts from: the tested build's sources over the scaffold, never its output. */
const REPAIRED_SOURCES = ["src", "res", "configurations", "definition.json"] as const;

interface ModuleStaged {
  packagesLinked: boolean;
  features: ImplementationFeature[];
}

async function isPresent(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

/**
 * Why a module run's module was not checked in the player, if it was not: no player check was
 * staged (the test browser is not installed), or the agent never ran the one it was given.
 */
async function playerCheckGap(
  workspace: string,
): Promise<ActivityRunFields["unchecked"] | undefined> {
  const dir = path.join(workspace, PLAYER_CHECK_DIR);
  if (!(await isPresent(dir))) return "noBrowser";
  if (!(await isPresent(path.join(dir, ACCEPTANCE_RESULTS_FILE)))) return "notRun";
  return undefined;
}

/**
 * Stages a module run's player check in `PLAYER_CHECK_DIR`: the acceptance harness and its
 * runner, over a play link for this run's own module, so the agent checks what it built in
 * the real framework rather than a page of its own. Nothing without the test browser or a
 * Playwright to drive it; the prompt says what the agent does then.
 */
async function stagePlayerCheck(
  services: RunKindServices,
  workspace: string,
  run: ModuleRun,
  confined: boolean,
): Promise<void> {
  const browserPath = await services.browser.executablePath();
  if (!browserPath) return;
  const version = await playwrightVersion(playwrightCoreDir());
  if (!version) return;
  const browserEndpoint = confined ? await services.serveBrowser(run.runId) : undefined;
  const spec = (await services.activities.getActivity(run.projectId, run.activityId)).draft.spec;
  const dir = path.join(workspace, PLAYER_CHECK_DIR);
  await fs.mkdir(dir, { recursive: true });
  await atomicJson(path.join(dir, ACCEPTANCE_INPUT_FILE), {
    playUrl: await services.browser.playUrl(run.projectId, run.activityId, { runId: run.runId }),
    viewport: viewportOf(spec),
    criteria: acceptanceCriteria(spec),
    browserPath,
    ...(browserEndpoint ? { browserEndpoint } : {}),
    scenes: specSceneIds(spec),
  });
  await atomicJson(path.join(dir, "package.json"), {
    private: true,
    type: "module",
    dependencies: { "playwright-core": version },
  });
  await fs.writeFile(path.join(dir, ACCEPTANCE_HARNESS_FILE), activityHarnessSource, {
    flag: "wx",
  });
  await fs.writeFile(path.join(dir, ACCEPTANCE_RUNNER_FILE), runAcceptanceSource, {
    flag: "wx",
  });
}

/**
 * A repair round's inputs, checked: a succeeded module build of this activity, a finished test
 * run that played it, and the checks of that run that ran and failed, with its test file.
 */
async function repairOf(
  services: RunKindServices,
  activity: ActivityDetail,
  projectId: string,
  asked: { fromRunId: string; testRunId: string },
): Promise<{ repair: ModuleRepair; bookMode?: string }> {
  const activityId = activity.id;
  const run = (runId: string) => services.run(projectId, activityId, runId).catch(() => null);
  const built = await run(asked.fromRunId);
  if (
    built?.kind !== "module" ||
    built.status !== "succeeded" ||
    !(await isPresent(path.join(services.workspace(built.runId), "module", "definition.json")))
  )
    throw new HttpError(
      409,
      "repair_build_missing",
      "A repair starts from a module build of this activity that succeeded.",
    );
  // A build of another draft carries that draft's configuration: assemble it again instead.
  if (built.inputRevision !== activity.draft.contentRevision)
    throw new HttpError(
      409,
      "repair_build_stale",
      "The draft changed since that build was assembled. Assemble the module again.",
    );
  const tested = await run(asked.testRunId);
  if (tested?.kind !== "test" || tested.status !== "succeeded")
    throw new HttpError(
      409,
      "repair_tests_missing",
      "A repair answers a test run of this activity that finished.",
    );
  if (tested.test?.moduleRunId !== built.runId)
    throw new HttpError(
      409,
      "repair_tests_mismatch",
      "Those tests did not play that module build.",
    );
  const workspace = services.workspace(tested.runId);
  const report = await fs
    .readFile(path.join(workspace, ACCEPTANCE_REPORT_DIR, ACCEPTANCE_REPORT_FILE), "utf8")
    .then((text) => readAcceptanceReport(JSON.parse(text)))
    .catch(() => null);
  const failed = report ? failedChecks(report) : [];
  if (!failed.length)
    throw new HttpError(
      409,
      "repair_nothing_failed",
      "Those tests saw nothing the module does wrong.",
    );
  const testFile = await readArtifactBytes(
    path.join(workspace, ACCEPTANCE_TEST_FILE),
    TEST_FILE_MAX_BYTES,
  )
    .then((bytes) => bytes.toString("utf8"))
    .catch(() => null);
  if (!testFile) throw new HttpError(409, "repair_tests_missing", "Those tests left no test file.");
  return {
    repair: {
      ...asked,
      failed: failed.map((result) => ({
        criterion: result.criterion,
        testName: result.testName,
        saw: result.error,
      })),
      testFile,
    },
    ...(built.bookMode ? { bookMode: built.bookMode } : {}),
  };
}

/**
 * Stages a repair round over the scaffold: the tested build's sources in place of the
 * scaffold's, the checks it failed, and a read-only copy of their test file. Links are not
 * copied.
 */
async function stageRepair(
  services: RunKindServices,
  workspace: string,
  repair: ModuleRepair,
): Promise<void> {
  const from = path.join(services.workspace(repair.fromRunId), "module");
  const to = path.join(workspace, "module");
  for (const name of REPAIRED_SOURCES) {
    const source = path.join(from, name);
    const stat = await fs.lstat(source).catch(() => null);
    if (!stat || stat.isSymbolicLink()) continue;
    await fs.rm(path.join(to, name), { recursive: true, force: true });
    await fs.cp(source, path.join(to, name), {
      recursive: true,
      filter: async (file) => !(await fs.lstat(file)).isSymbolicLink(),
    });
  }
  const dir = path.join(workspace, REPAIR_DIR);
  await fs.mkdir(dir, { recursive: true });
  await atomicJson(path.join(dir, REPAIR_FILE), { failed: repair.failed });
  await fs.writeFile(path.join(dir, ACCEPTANCE_TEST_FILE), repair.testFile, {
    flag: "wx",
    mode: 0o444,
  });
}

export const moduleKind: SessionRunKind<
  RunRequestOf<"module">,
  ModulePrepared,
  ModuleRun,
  ModuleStaged
> = {
  run: "module",
  runner: "session",
  needsScript: true,
  async check(services, request, activity, projectId) {
    if (!hasValidSpec(activity))
      throw new HttpError(
        400,
        "module_spec_required",
        "Save a valid specification before assembling a module.",
      );
    const repair = request.repair
      ? await repairOf(services, activity, projectId, request.repair)
      : undefined;
    // A repair keeps the reading mode the build it repairs was assembled in.
    const requested = request.bookMode ?? repair?.bookMode;
    let bookMode: BookMode | undefined;
    if (activity.activityType === "book") {
      try {
        validateBookSpec(validateActivitySpec(activity.draft.spec));
        if (requested !== "readAlong" && requested !== "decodable")
          throw new Error("Choose Read-along or Decodable before assembling a book.");
        bookMode = requested;
        if (
          !activity.draft.mediaPlan ||
          activity.draft.mediaPlan.specRevision !== contentRevision(activity.draft.spec)
        )
          throw new Error("Rebuild the media plan before assembling a book.");
        compileBookConfiguration(activity, bookMode, activity.draft.mediaPlan.manifest);
      } catch (error) {
        throw new HttpError(422, "spec_invalid", (error as Error).message);
      }
    }
    if (activity.activityType !== "book" && requested !== undefined)
      throw new HttpError(400, "book_mode_invalid", "Reading mode only applies to books.");
    // Module code belongs to the product, and only its canonical ref may change it.
    // A non-canonical ref is configuration on top of a module someone else owns, so
    // assembling from it would quietly rewrite that shared module.
    if (!services.activities.isCanonicalRef(activity)) {
      const product = services.activities.productOf(activity);
      throw new HttpError(
        409,
        "ref_not_canonical",
        `This activity shares its module with ref ${product?.canonicalRefNum}, which owns the module code. Assemble from that ref instead.`,
      );
    }
    return {
      wafRoot: await services.wafWorkspace.requireRoot(),
      bookMode,
      ...(repair ? { repair: repair.repair } : {}),
    };
  },
  record: ({ bookMode, repair }) => ({
    ...(bookMode ? { bookMode } : {}),
    // The test file the repair was handed, which the tests run again must still be.
    ...(repair
      ? {
          repair: {
            fromRunId: repair.fromRunId,
            testRunId: repair.testRunId,
            testSha256: testFileHash(repair.testFile),
          },
        }
      : {}),
  }),
  input: ({ bookMode }) => (bookMode ? { bookMode } : {}),
  async stage({ services, activity, prepared, run, workspace, confined, expectedRevision }) {
    const { projectId, activityId } = run;
    const activities = services.activities;
    await activities.prepareAudioMedia(projectId, activityId, workspace, expectedRevision);
    await activities.prepareImageMedia(projectId, activityId, workspace, expectedRevision);
    await activities.prepareVideoMedia(projectId, activityId, workspace, expectedRevision);
    await activities.prepareUploadedMedia(projectId, activityId, workspace, expectedRevision);
    await prepareModule(workspace, activity, prepared.wafRoot, prepared.bookMode);
    // Over the scaffold, so what an assembly's collect restores and checks is still there.
    if (prepared.repair) await stageRepair(services, workspace, prepared.repair);
    // The packages the first stages started installing, linked in rather than installed again
    // by the agent.
    const linkModule = services.mediaHelper.linkModuleDependencies ?? linkModuleDependencies;
    const packagesLinked = await linkModule(
      path.join(workspace, "module"),
      modulePackagesRoot(services.root),
    );
    await stagePlayerCheck(services, workspace, run, confined);
    // An assembly is handed the implementation features its ref selected.
    const chosen = await activities.implementationFeatures(projectId, activityId);
    const features = chosen.features.filter((feature) => chosen.selectedIds.includes(feature.id));
    if (features.length) await atomicJson(path.join(workspace, RUN_FEATURES_FILE), features);
    return { packagesLinked, features };
  },
  prompt: ({ prepared }, { packagesLinked, features }) =>
    modulePrompt +
    (packagesLinked ? MODULE_PACKAGES_CLAUSE : "") +
    (prepared.bookMode ? MODULE_BOOK_CLAUSE : "") +
    featureClause(features) +
    (prepared.repair ? moduleRepairClause : ""),
  // The shared checkout is the module's source of truth and belongs to whoever cloned it. An
  // assembly Session reads the framework, navbar and media out of it and must leave it exactly
  // as it found it — a refusal rather than an instruction, because an instruction is not a
  // permission system and the people approving these Sessions are not all engineers. The
  // linked packages are shared by every run, so they are refused the same way.
  protectedRoots: ({ services, prepared, workspace }): ProtectedRoot[] => [
    { root: prepared.wafRoot, label: "the shared WAF checkout" },
    { root: modulePackagesRoot(services.root), label: "the shared module packages" },
    // The checks a repair answers are run again as they are.
    ...(prepared.repair
      ? [{ root: path.join(workspace, REPAIR_DIR), label: "the checks this repair answers" }]
      : []),
  ],
  outputs: [MODULE_OUTPUT],
  missing: `${MODULE_OUTPUT} or a required artifact`,
  async collect({ services, run, workspace, observed, stopping, save }) {
    run.candidate = await readCandidate(path.join(workspace, MODULE_OUTPUT));
    save(run);
    if (stopping()) return null;
    requireCompleted(observed, "The session ended without a confirmed completed request.");
    const input = await services.activities.getActivity(run.projectId, run.activityId);
    const requiredMediaFiles =
      input.draft.mediaPlan && input.draft.contentRevision === run.inputRevision
        ? [
            `module/${refSpecPath(input.productCode, input.refNum)}/asset_manifest.json`,
            `module/${moduleDocumentPath("configuration", input.productCode, input.refNum)}`,
          ]
        : [];
    if (run.bookMode)
      requiredMediaFiles.push(
        "module/src/book-reader/model.ts",
        "module/src/book-reader/controller.ts",
      );
    // Only the plan the run was given: a later one is a conflict, refused below.
    if (input.draft.contentRevision === run.inputRevision)
      await restoreApprovedManifest(workspace, input);
    await syncAssembledStateMachine(workspace, input, run.bookMode);
    const result = await collectModule(workspace, readCandidate, requiredMediaFiles);
    const unchecked = await playerCheckGap(workspace);
    if (unchecked) run.unchecked = unchecked;
    run.candidate = JSON.stringify(result);
    save(run);
    return {
      kept: true,
      draftChanged: "The specification changed during assembly.",
      verify: async () => {
        if (input.draft.contentRevision === run.inputRevision)
          await verifyMediaArtifacts(workspace, input, readCandidate, run.bookMode);
      },
    };
  },
};
