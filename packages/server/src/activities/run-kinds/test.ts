/**
 * Acceptance tests of the played activity: an agent writes (or reuses) tests of the
 * specification's criteria and runs them in the test browser; the report is the result.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../http/errors.js";
import { readArtifactBytes, readCandidate } from "../artifact.js";
import {
  ACCEPTANCE_HARNESS_FILE,
  ACCEPTANCE_INPUT_FILE,
  ACCEPTANCE_REPORT_DIR,
  ACCEPTANCE_REPORT_FILE,
  ACCEPTANCE_RESULTS_FILE,
  ACCEPTANCE_RUNNER_FILE,
  ACCEPTANCE_TEST_FILE,
  HARNESS_VERSION,
  TEST_FILE_MAX_BYTES,
  acceptancePrompt,
  acceptanceReusePrompt,
  activityHarnessSource,
  runAcceptanceSource,
} from "../acceptance-harness.js";
import {
  RESULTS_MAX_BYTES,
  acceptanceReport,
  parseAcceptanceResults,
  testFileHash,
} from "../acceptance-collect.js";
import type { AcceptanceStage } from "../acceptance-types.js";
import type { TestRun } from "../domain.js";
import type { RunRequestOf } from "../run-request.js";
import { atomicJson } from "../service.js";
import { hasValidSpec, requireCompleted, type SessionRunKind } from "./contract.js";

/**
 * Whether a test run left the test file it was handed as it was: only then did it reuse the
 * earlier checks. False when it was handed none, or the file is gone or changed.
 */
async function testFileUnchanged(workspace: string, hash: string | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    const bytes = await readArtifactBytes(
      path.join(workspace, ACCEPTANCE_TEST_FILE),
      TEST_FILE_MAX_BYTES,
    );
    return testFileHash(bytes) === hash;
  } catch {
    return false;
  }
}

export const testKind: SessionRunKind<RunRequestOf<"test">, AcceptanceStage, TestRun> = {
  run: "test",
  runner: "session",
  // Tests are written from the specification's acceptance criteria.
  needsScript: false,
  async check(_services, request, activity) {
    if (!hasValidSpec(activity))
      throw new HttpError(
        400,
        "test_spec_required",
        "Save a valid specification before running the acceptance tests.",
      );
    return request.test;
  },
  record: (test) => ({
    test: {
      criteria: test.input.criteria,
      specRevision: test.input.specRevision,
      harnessVersion: HARNESS_VERSION,
      reused: test.cachedTest !== null,
      ...(test.cachedTest !== null ? { cachedTestHash: testFileHash(test.cachedTest) } : {}),
    },
  }),
  async stage({ services, activity, prepared: test, run, workspace, confined }) {
    await atomicJson(path.join(workspace, "activity-spec.json"), activity.draft.spec);
    const browserEndpoint = confined ? await services.serveBrowser(run.runId) : undefined;
    await atomicJson(path.join(workspace, ACCEPTANCE_INPUT_FILE), {
      ...test.input,
      ...(browserEndpoint ? { browserEndpoint } : {}),
    });
    await atomicJson(path.join(workspace, "package.json"), {
      private: true,
      type: "module",
      dependencies: { "playwright-core": test.playwrightVersion },
    });
    await fs.writeFile(path.join(workspace, ACCEPTANCE_HARNESS_FILE), activityHarnessSource, {
      flag: "wx",
    });
    await fs.writeFile(path.join(workspace, ACCEPTANCE_RUNNER_FILE), runAcceptanceSource, {
      flag: "wx",
    });
    // The same criteria as a run that already wrote their tests: reuse them as they are.
    if (test.cachedTest !== null)
      await fs.writeFile(path.join(workspace, ACCEPTANCE_TEST_FILE), test.cachedTest, {
        flag: "wx",
      });
  },
  prompt: ({ prepared }) =>
    prepared.cachedTest !== null ? acceptanceReusePrompt : acceptancePrompt,
  outputs: [ACCEPTANCE_RESULTS_FILE],
  async collect({ run, workspace, observed }) {
    requireCompleted(observed, "Test Session did not complete.");
    if (!run.test) throw new Error("The test run has no criteria recorded.");
    const reported = parseAcceptanceResults(
      await readCandidate(path.join(workspace, ACCEPTANCE_RESULTS_FILE), RESULTS_MAX_BYTES),
    );
    const report = acceptanceReport(run.test.criteria, reported, {
      checkedAt: new Date().toISOString(),
      specRevision: run.test.specRevision,
      reused: await testFileUnchanged(workspace, run.test.cachedTestHash),
    });
    const reports = path.join(workspace, ACCEPTANCE_REPORT_DIR);
    await fs.mkdir(reports, { recursive: true });
    await atomicJson(path.join(reports, ACCEPTANCE_REPORT_FILE), report);
    return { kept: true };
  },
};
