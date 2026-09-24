/**
 * Whether an activity is ready to assemble, as a list of checks an author can read before
 * pressing Assemble: the facts only the server can establish (is the media plan current
 * for the saved specification, does this ref own the module code), and the counts behind
 * "all speech bound" and "every language covers the default one".
 *
 * Checks carry codes and numbers, never sentences; the App words them. A check that fails
 * is one the assembly route itself refuses; a warning is one it allows, but that leaves the
 * module short of something an author would want.
 */
import { contentRevision, type ActivityDetail } from "./domain.js";

export type ReadinessLevel = "ok" | "warn" | "fail";

export type ReadinessCheck =
  | { id: "script"; level: ReadinessLevel }
  | { id: "spec"; level: ReadinessLevel }
  | { id: "plan"; level: ReadinessLevel; state: "missing" | "stale" | "current" }
  | { id: "speech"; level: ReadinessLevel; language: string; bound: number; total: number }
  | { id: "media"; level: ReadinessLevel; bound: number; total: number }
  | { id: "coverage"; level: ReadinessLevel; language: string; covered: number; total: number }
  | { id: "canonical"; level: ReadinessLevel }
  | { id: "checkout"; level: ReadinessLevel; found: boolean };

const DEFAULT_LANGUAGE = "en-US";

export function buildReadiness(
  activity: ActivityDetail,
  context: { canonical: boolean; checkoutFound: boolean },
): ReadinessCheck[] {
  const { draft } = activity;
  const checks: ReadinessCheck[] = [
    { id: "script", level: draft.description.trim() ? "ok" : "warn" },
    { id: "spec", level: draft.spec && draft.status === "valid" ? "ok" : "fail" },
  ];
  const plan = draft.mediaPlan;
  const planState = !plan
    ? "missing"
    : draft.spec && plan.specRevision === contentRevision(draft.spec)
      ? "current"
      : "stale";
  // Assembly without a plan is allowed and simply carries no media; a stale plan is not.
  checks.push({
    id: "plan",
    level: planState === "current" ? "ok" : planState === "stale" ? "fail" : "warn",
    state: planState,
  });
  if (plan) {
    const languages = Object.keys(plan.manifest.assets).sort((a, b) =>
      a === DEFAULT_LANGUAGE ? -1 : b === DEFAULT_LANGUAGE ? 1 : a.localeCompare(b),
    );
    const defaults = plan.manifest.assets[DEFAULT_LANGUAGE] ?? [];
    // What a language has to say differently: the default's scripted narration. Music and
    // effects carry no script and fall back to the default, as in Loom.
    const defaultSpeech = new Set(
      defaults
        .filter((asset) => asset.type === "audio" && !asset.kind && !!asset.script?.trim())
        .map((asset) => asset.key),
    );
    for (const language of languages) {
      const audio = plan.manifest.assets[language]!.filter((asset) => asset.type === "audio");
      const bound = audio.filter((asset) => asset.path).length;
      if (audio.length)
        checks.push({
          id: "speech",
          level: bound === audio.length ? "ok" : "warn",
          language,
          bound,
          total: audio.length,
        });
      if (language !== DEFAULT_LANGUAGE && defaultSpeech.size) {
        const keys = new Set(audio.map((asset) => asset.key));
        const covered = [...defaultSpeech].filter((key) => keys.has(key)).length;
        checks.push({
          id: "coverage",
          level: covered === defaultSpeech.size ? "ok" : "warn",
          language,
          covered,
          total: defaultSpeech.size,
        });
      }
    }
    const visual = defaults.filter((asset) => asset.type !== "audio");
    if (visual.length) {
      const bound = visual.filter((asset) => asset.path).length;
      checks.push({
        id: "media",
        level: bound === visual.length ? "ok" : "warn",
        bound,
        total: visual.length,
      });
    }
  }
  checks.push({ id: "canonical", level: context.canonical ? "ok" : "fail" });
  checks.push({
    id: "checkout",
    level: context.checkoutFound ? "ok" : "fail",
    found: context.checkoutFound,
  });
  return checks;
}
