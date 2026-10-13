/**
 * What a settled run's checks found, as numbers: read once, when the run ends, from its record
 * and the reports in its folder, so a later change to the folder changes nothing. Reports are
 * read bounded and tolerantly: a report that is missing, too large or not what it should be
 * gives no numbers rather than an error.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ACCEPTANCE_REPORT_DIR,
  ACCEPTANCE_REPORT_FILE,
  ACCEPTANCE_RESULTS_FILE,
} from "./acceptance-harness.js";
import type { ActivityRun } from "./domain.js";
import { ACCESSIBILITY_REPORT, READABILITY_REPORT, REPORTS_DIR } from "./quality-check.js";
import { PLAYER_CHECK_DIR } from "./waf-module.js";

/** The largest report read; one past it is left unread. */
const REPORT_MAX_BYTES = 4 * 1024 * 1024;

export type Metrics = Record<string, number>;

function readJson(file: string): unknown {
  try {
    const size = fs.statSync(file, { throwIfNoEntry: false })?.size;
    if (size === undefined || size > REPORT_MAX_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function list(value: unknown, key: string): Record<string, unknown>[] {
  const items =
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return Array.isArray(items)
    ? items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function parsed(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** How many criteria passed and failed, from a report's or a results file's list. */
function criteriaCounts(results: Record<string, unknown>[], prefix: string): Metrics {
  const metrics: Metrics = {};
  for (const result of results) {
    let name: string;
    if (result.code === "not_run") name = "notRun";
    else if (
      result.status === "passed" ||
      result.status === "failed" ||
      result.status === "skipped"
    )
      name = result.status;
    else continue;
    metrics[`${prefix}.${name}`] = (metrics[`${prefix}.${name}`] ?? 0) + 1;
  }
  return metrics;
}

/** An acceptance test run's report, counted: criteria by how they ended, and whether reused. */
function testMetrics(workspace: string): Metrics {
  const report = readJson(path.join(workspace, ACCEPTANCE_REPORT_DIR, ACCEPTANCE_REPORT_FILE));
  if (!report || typeof report !== "object") return {};
  const metrics = criteriaCounts(list(report, "results"), "tests");
  if ((report as { reused?: unknown }).reused === true) metrics["tests.reused"] = 1;
  return metrics;
}

/** A quality run's two reports, counted: blocking findings, and each check that failed. */
function qualityMetrics(workspace: string): Metrics {
  const metrics: Metrics = {};
  for (const [check, file] of [
    ["accessibility", ACCESSIBILITY_REPORT],
    ["readability", READABILITY_REPORT],
  ] as const) {
    const report = readJson(path.join(workspace, REPORTS_DIR, file));
    if (!report || typeof report !== "object") continue;
    metrics[`${check}.blocking`] = list(report, "findings").filter(
      (finding) => finding.blocking === true,
    ).length;
    if ((report as { status?: unknown }).status === "failed") metrics[`${check}.failed`] = 1;
  }
  return metrics;
}

/**
 * The numbers a settled run's checks give, by kind: an acceptance test run's report, a module
 * run's player check, a quality run's findings, a recording's video check, a composition's lint,
 * a critique's score, and whether a specification pass may be repaired.
 */
export function checkMetrics(run: ActivityRun, workspace: string): Metrics {
  switch (run.kind) {
    case "test":
      return testMetrics(workspace);
    case "quality":
      return qualityMetrics(workspace);
    case "module": {
      const results = readJson(path.join(workspace, PLAYER_CHECK_DIR, ACCEPTANCE_RESULTS_FILE));
      return {
        ...criteriaCounts(list(results, "results"), "playerCheck"),
        ...(run.unchecked ? { [`unchecked.${run.unchecked}`]: 1 } : {}),
      };
    }
    case "video": {
      const metrics: Metrics = {};
      if (run.video?.check) {
        metrics["video.findings"] = run.video.check.findings.length;
        metrics[`video.${run.video.check.status}`] = 1;
      }
      if (run.video?.problem) metrics["video.problem"] = 1;
      return metrics;
    }
    case "composition": {
      const lint = parsed(run.candidate)?.lint;
      return {
        ...(Array.isArray(lint) ? { "composition.lint": lint.length } : {}),
        ...(run.composition?.problem ? { "composition.problem": 1 } : {}),
      };
    }
    case "critique": {
      const critique = parsed(run.candidate);
      if (typeof critique?.score === "number") return { "critique.score": critique.score };
      return critique?.unseen === true ? { "critique.unseen": 1 } : {};
    }
    case "spec":
    case "media-spec":
      return run.repairable ? { repairable: 1 } : {};
    default:
      return {};
  }
}

/**
 * What a run is for within its kind, when one activity has several: the asset, or the language
 * of a book's words. Null when the kind has one target per activity.
 */
export function targetOf(run: ActivityRun): string | null {
  const asset =
    run.audio ??
    run.image ??
    run.mediaText ??
    run.composition ??
    run.video ??
    run.timelineEdit ??
    run.critique;
  if (asset) return `${asset.language}/${asset.assetKey}`;
  if (run.phonemes) return run.phonemes.language;
  return null;
}
