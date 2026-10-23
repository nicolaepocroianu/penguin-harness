/**
 * A sandbox service wired to stand-ins, as the kernel would wire it: the real module source
 * over the same authoring and generation stand-ins, and a module builder that builds nothing
 * and records what it was asked to build.
 */
import { wire } from "@waterford/waf-harness-core/kernel";
import type { ModuleBuilder } from "../src/activities/module-builder.js";
import { ActivityModuleSourceService } from "../src/activities/module-source.js";
import { ActivityRunStore, type ActivityRuns } from "../src/activities/run-store.js";
import type { CheckoutBuildJob } from "../src/activities/sandbox-checkout-build.js";
import { ActivitySandboxService } from "../src/activities/sandbox-service.js";

/** A module builder whose builds succeed (or answer as told) and are recorded, never run. */
export function fakeModuleBuilder(
  answer: { ok: boolean; log: string } = { ok: true, log: "compiled" },
) {
  const runs: string[] = [];
  const checkouts: CheckoutBuildJob[] = [];
  const builder: ModuleBuilder = {
    compileStyle: async () => ({ code: 0, tail: "" }),
    buildRun: async (workspace) => {
      runs.push(workspace);
      return answer;
    },
    buildCheckout: async (job) => {
      checkouts.push(job);
      return answer;
    },
    buildPlayer: async () => ({ ok: false, log: "No player is built in a test." }),
  };
  return { builder, runs, checkouts };
}

export function wiredSandbox(deps: {
  /** The authoring service's stand-in, shared by the sandbox and its module source. */
  activities: object;
  /** The generation service's stand-in, read by the module source. */
  generation: object;
  /** WAF Harness's root. */
  root: string;
  /** The WAF checkout, or null when there is none. */
  wafRoot: string | null;
  /** Where runs keep their folders; a run store over WAF Harness's root by default. */
  runs?: ActivityRuns;
  builder?: ModuleBuilder;
  /** Whether activity agents are confined, as the admin switch says when read; on by default. */
  confineActivityAgents?: boolean | (() => boolean);
  /** Why nothing could confine a run's build right now; null (it could) by default. */
  confinementProblem?: string | null;
}): ActivitySandboxService {
  const config = { root: deps.root };
  const wafWorkspace = { root: async () => deps.wafRoot };
  const runs = deps.runs ?? wire(ActivityRunStore, { config });
  const moduleSources = wire(ActivityModuleSourceService, {
    activities: deps.activities,
    generation: deps.generation,
    runs,
    config,
    wafWorkspace,
  });
  return wire(ActivitySandboxService, {
    activities: deps.activities,
    config,
    wafWorkspace,
    moduleSources,
    moduleBuilder: deps.builder ?? fakeModuleBuilder().builder,
    settings: {
      getConfineActivityAgents: () =>
        typeof deps.confineActivityAgents === "function"
          ? deps.confineActivityAgents()
          : (deps.confineActivityAgents ?? true),
    },
    sessionSandbox: {
      confinementProblem: () => deps.confinementProblem ?? null,
      confiner: () => (argv: readonly string[]) => argv,
    },
    runs,
    // No Project is ever deleted here: a run's build is admitted as it is asked for.
    projectWork: { run: <T>(_projectId: string, operation: () => Promise<T>) => operation() },
  });
}
