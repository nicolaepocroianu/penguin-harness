/**
 * An author's edit of a module document: the configuration a ref's module reads, or the
 * assessment and the module definition every ref of a product shares.
 *
 * Loom wrote these straight into the module folder of the WAF checkout. WAF Harness keeps them in
 * the draft instead, as an override the preview and every assembly use until the author
 * discards it. It is never overwritten by a later plan or assembly; when what it was derived
 * from changes, it is reported stale instead.
 *
 * Pure: no filesystem, no services.
 */
import { HttpError } from "../http/errors.js";
import { assessmentProblems, type AssessmentItem } from "./assessment-session.js";
import {
  contentRevision,
  type ActivityDraft,
  type ModuleDocumentKind,
  type ModuleDocumentOverride,
} from "./domain.js";
import { interactionType, isAssessmentData } from "./sandbox-assessment.js";
import { checkStateMachine, machineSceneIds } from "./state-machine-validation.js";

/** The largest document an author may save, serialized. */
export const MODULE_DOCUMENT_MAX_BYTES = 1_000_000;

/**
 * What a configuration is derived from: the media plan's manifest, or nothing yet. The ref's
 * number is left out: it is the manifest's address, not its media, so renumbering a ref does
 * not make its edit stale.
 */
export function configurationBasis(draft: Pick<ActivityDraft, "mediaPlan">): string | null {
  return draft.mediaPlan ? contentRevision({ ...draft.mediaPlan.manifest, refNum: 0 }) : null;
}

/** What an assessment is derived from: the specification, or nothing yet. */
export function assessmentBasis(draft: Pick<ActivityDraft, "spec">): string | null {
  return draft.spec ? contentRevision(draft.spec) : null;
}

/**
 * What a state machine is derived from: the specification's scenes, each of which it must
 * name. A change to a scene's words or media leaves it as it is.
 */
export function machineBasis(draft: Pick<ActivityDraft, "spec">): string | null {
  return draft.spec ? contentRevision([...machineSceneIds(draft.spec)].sort()) : null;
}

/**
 * What a document of `kind` is derived from. The definition, like the assessment, follows the
 * specification: its id, title and theme come from there.
 */
export function documentBasis(
  kind: ModuleDocumentKind,
  draft: Pick<ActivityDraft, "spec" | "mediaPlan">,
): string | null {
  if (kind === "configuration") return configurationBasis(draft);
  if (kind === "stateMachine") return machineBasis(draft);
  return assessmentBasis(draft);
}

/**
 * Whether every ref of a product shares the document, so only the canonical ref, which owns
 * the module code, may edit it: the assessment, the module definition and the product's state
 * machine.
 */
export function isSharedDocument(kind: ModuleDocumentKind): boolean {
  return kind !== "configuration";
}

/** Whether what the edit was derived from has changed since. */
export function isStale(override: ModuleDocumentOverride, currentBasis: string | null): boolean {
  return override.basis !== currentBasis;
}

function invalid(message: string): HttpError {
  return new HttpError(422, "document_invalid", message);
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid("The document must be a JSON object.");
  return value as Record<string, unknown>;
}

function withinSize(value: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MODULE_DOCUMENT_MAX_BYTES)
    throw invalid(`The document must be ${MODULE_DOCUMENT_MAX_BYTES} bytes or smaller.`);
}

/**
 * Validate a module definition an author saves: what an assembly checks it produced, a WAF 2
 * HTML module whose entry is `entry.js`, so a save never makes the next assembly fail.
 */
export function validateDefinition(value: unknown): Record<string, unknown> {
  const document = plainObject(value);
  withinSize(document);
  const require = document.require as { entry?: { url?: unknown } } | undefined;
  if (
    document.engine !== "html" ||
    document.schemaVersion !== "2.0.0" ||
    require?.entry?.url !== "entry.js"
  )
    throw invalid(
      'A module definition needs engine "html", schemaVersion "2.0.0" and require.entry.url "entry.js".',
    );
  return document;
}

/** How many problems a refused state machine's message names, as Loom's does. */
const MACHINE_PROBLEMS_SHOWN = 5;

/**
 * Validate a state machine an author saves, with Loom's checks: a 400 naming its first
 * problems. `spec` names the scenes. `baseline` is the machine the author was editing, when
 * there is one: a problem it already had is let through, as an assessment's is, because real
 * Loom machines predate some of Loom's own rules (an `activity` entered at `running`) and
 * still play. Only the problems the edit introduces refuse it.
 */
export function validateStateMachineDocument(
  value: unknown,
  spec: unknown,
  baseline?: unknown,
): Record<string, unknown> {
  const document = plainObject(value);
  withinSize(document);
  const issues = checkStateMachine(document, spec, baseline).issues.filter(
    (issue) => !issue.inherited,
  );
  if (issues.length)
    throw new HttpError(
      400,
      "state_machine_invalid",
      `Invalid activity state machine: ${issues
        .slice(0, MACHINE_PROBLEMS_SHOWN)
        .map((issue) => issue.message)
        .join("; ")}${
        issues.length > MACHINE_PROBLEMS_SHOWN
          ? `; and ${issues.length - MACHINE_PROBLEMS_SHOWN} more`
          : ""
      }`,
    );
  return document;
}

export function validateConfiguration(value: unknown): Record<string, unknown> {
  const document = plainObject(value);
  withinSize(document);
  return document;
}

/**
 * The choice items of an assessment file, in the shape the assessment rules read, each with
 * its position in the file. Only single- and multiple-response choice items are checked;
 * other interaction kinds are passed through as they are.
 */
function checkedItems(value: unknown): { index: number; item: AssessmentItem }[] {
  if (!isAssessmentData(value)) return [];
  const checked: { index: number; item: AssessmentItem }[] = [];
  value.items.forEach((raw, index) => {
    const interaction = interactionType(raw);
    if (interaction !== "SIMPLE_CHOICE" && interaction !== "MULTIPLE_RESPONSE_CHOICE") return;
    const record = (raw ?? {}) as Record<string, unknown>;
    const configuration =
      record.configuration && typeof record.configuration === "object"
        ? (record.configuration as Record<string, unknown>)
        : {};
    const list =
      configuration[interaction === "SIMPLE_CHOICE" ? "simpleChoice" : "multipleResponseChoice"];
    const choices = (Array.isArray(list) ? list : []).map((choice) => {
      const entry = choice && typeof choice === "object" ? (choice as Record<string, unknown>) : {};
      return {
        id: entry.id === undefined || entry.id === null ? "" : String(entry.id),
        isCorrect: entry.isCorrect === true,
      };
    });
    checked.push({
      index,
      item: {
        id: typeof record.title === "string" ? record.title : "",
        interaction,
        choices,
      },
    });
  });
  return checked;
}

/** The choice items the assessment rules check, as they read them. */
export function assessmentItems(value: unknown): AssessmentItem[] {
  return checkedItems(value).map((entry) => entry.item);
}

/** How many problems a refusal names before it says how many more there are. */
const PROBLEMS_SHOWN = 5;

/**
 * An assessment's problems, each named by its place in the file and keyed by the item's id
 * rather than its place, so the same problem is recognised when items move.
 */
function namedProblems(value: unknown): { message: string; key: string }[] {
  const checked = checkedItems(value);
  // The rules number items within the list they are given; name them by their place in
  // the file instead, which is where an author will look.
  return assessmentProblems(checked.map((entry) => entry.item)).map((problem) => {
    const match = /^Item (\d+)/.exec(problem);
    const entry = match ? checked[Number(match[1]) - 1] : undefined;
    if (!match || !entry) return { message: problem, key: problem };
    const rest = problem.slice(match[0].length);
    return {
      message: `Item ${entry.index + 1}${rest}`,
      key: JSON.stringify([entry.item.id, rest]),
    };
  });
}

/**
 * The problems of `value` that `baseline` did not already have, matched by item id so that
 * moving an item does not make its problem new.
 */
function introducedProblems(value: unknown, baseline: unknown): { message: string; key: string }[] {
  const known = new Map<string, number>();
  if (baseline !== undefined && baseline !== null)
    for (const { key } of namedProblems(baseline)) known.set(key, (known.get(key) ?? 0) + 1);
  return namedProblems(value).filter(({ key }) => {
    const left = known.get(key) ?? 0;
    if (left > 0) {
      known.set(key, left - 1);
      return false;
    }
    return true;
  });
}

/**
 * How many problems an assessment has, and how many of them `baseline` (the module's own
 * file, when it has one) did not already have. A document that is not an assessment at all
 * is one problem, and a new one unless the baseline is not an assessment either.
 */
export function assessmentProblemCounts(
  value: unknown,
  baseline?: unknown,
): { total: number; introduced: number } {
  if (!isAssessmentData(value)) {
    const inherited = baseline !== undefined && baseline !== null && !isAssessmentData(baseline);
    return { total: 1, introduced: inherited ? 0 : 1 };
  }
  return {
    total: namedProblems(value).length,
    introduced: introducedProblems(value, isAssessmentData(baseline) ? baseline : null).length,
  };
}

/**
 * Validate an assessment an author saves. `baseline` is the document they were editing, when
 * there is one: many real modules already break a rule (a single choice with two correct
 * answers, a repeated title), and Loom never checked, so a problem the baseline already had is
 * let through. Only the problems the edit introduces refuse it.
 */
export function validateAssessment(value: unknown, baseline?: unknown): Record<string, unknown> {
  const document = plainObject(value);
  if (!isAssessmentData(document)) throw invalid("An assessment needs an items list.");
  withinSize(document);
  const introduced = introducedProblems(document, baseline);
  if (introduced.length) {
    const shown = introduced.slice(0, PROBLEMS_SHOWN).map((problem) => problem.message);
    const more = introduced.length - shown.length;
    throw invalid(
      [
        ...shown,
        ...(more > 0 ? [`And ${more} more ${more === 1 ? "problem" : "problems"}.`] : []),
      ].join(" "),
    );
  }
  return document;
}

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Every key path in `value`, through objects only, each as a JSON array of keys. */
function keyPaths(value: unknown, prefix: string[] = []): string[] {
  if (!isJson(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const at = [...prefix, key];
    return [JSON.stringify(at), ...keyPaths(item, at)];
  });
}

function hasPath(value: unknown, path: readonly string[]): boolean {
  let current = value;
  for (const key of path) {
    if (!isJson(current) || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

/**
 * The key paths an author has removed from the machine: those of `baseline`, the machine they
 * edited, that `value` lacks, with what they removed before (`earlier`), less what `value`
 * has again. Each is a JSON array of keys.
 */
export function removedKeys(
  baseline: unknown,
  value: unknown,
  earlier: readonly string[] = [],
): string[] {
  const removed = new Set(earlier);
  for (const path of keyPaths(baseline)) removed.add(path);
  return (
    [...removed]
      .filter((path) => !hasPath(value, JSON.parse(path) as string[]))
      // A removed key's own keys go with it; only the outermost is kept.
      .filter((path, _, all) => {
        const keys = JSON.parse(path) as string[];
        return !all.some((other) => {
          const outer = JSON.parse(other) as string[];
          return outer.length < keys.length && outer.every((key, index) => keys[index] === key);
        });
      })
      .sort()
  );
}

/**
 * Whether an assembled machine kept the author's edit: everything the edit says, nothing the
 * author removed put back, though the assembly may add to it as Loom's implement step does.
 * A scene the specification no longer has may go, with everything in it.
 */
export function keepsMachineEdit(
  written: unknown,
  edit: ModuleDocumentOverride,
  spec: unknown,
): boolean {
  const scenes = machineSceneIds(spec);
  const kept = structuredClone(edit.value) as Json;
  const states = isJson(kept.states) ? kept.states : {};
  for (const name of Object.keys(states))
    if (name !== "activity" && !scenes.has(name)) delete states[name];
  return (
    keepsEdit(written, kept) &&
    (edit.removed ?? []).every((path) => !hasPath(written, JSON.parse(path) as string[]))
  );
}

/**
 * Whether an assembled document kept everything the author's edit says. An assembly may add
 * to it (a key the module needs), but may not change or drop what the author wrote.
 */
export function keepsEdit(written: unknown, edit: unknown): boolean {
  if (edit && typeof edit === "object" && !Array.isArray(edit)) {
    if (!written || typeof written !== "object" || Array.isArray(written)) return false;
    return Object.entries(edit).every(([key, value]) =>
      keepsEdit(
        Object.hasOwn(written, key) ? (written as Record<string, unknown>)[key] : undefined,
        value,
      ),
    );
  }
  return contentRevision(written ?? null) === contentRevision(edit ?? null);
}
