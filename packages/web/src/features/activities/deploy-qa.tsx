/**
 * The QA card, beside the PROD one: where the activity stands on QA, the link to it once a QA
 * deploy finished and the module version it went with, and otherwise what a QA deploy does.
 */
import type { DeployRun, DeployStageState } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { qaResult, qaStatus } from "./deploy-model";
import { DeployStatePill } from "./deploy-state-pill";

export function DeployQa({
  run,
  stages,
}: {
  run: DeployRun | null;
  stages: readonly DeployStageState[];
}) {
  const words = S.activities.deploy;
  const status = qaStatus(run, stages);
  const onQa = qaResult(stages);
  return (
    <section
      className="min-w-0 space-y-2 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
      aria-labelledby="activity-deploy-qa-title"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 id="activity-deploy-qa-title" className="text-sm font-semibold">
          {words.qaTitle}
        </h4>
        <DeployStatePill tone={status.tone} text={status.text} testId="deploy-qa-state" />
      </div>
      {onQa ? (
        <p className="flex flex-wrap items-center gap-x-3 text-sm" data-testid="deploy-qa-result">
          <a
            href={onQa.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            {words.openQa}
          </a>
          {onQa.version && <span>{words.qaVersion(onQa.version)}</span>}
        </p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">{words.qaExplain}</p>
      )}
    </section>
  );
}
