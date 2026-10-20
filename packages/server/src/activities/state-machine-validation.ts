/**
 * Checks an author's `state-machine.json` before it is saved, as Loom does on its PUT: ported
 * from Loom's `app/services/state_machine/validation.py` (non-strict, as an edit is checked)
 * and its `config/schemas/state_machine.schema.json`.
 *
 * Loom's checks cover every one `waf-state-machine`'s own `validateStateMachineDefinition`
 * makes when the player boots, and more: the schema refuses unknown keys, and the machine must
 * name each scene of the specification and nothing else, end in a final `activity.complete`,
 * and enter `activity` at `complete`. A machine that passes here boots in the player.
 *
 * Pure: no filesystem, no services.
 */
import { isGeneralScene, SCAFFOLD_PLACEHOLDER_SCENE_ID } from "./state-machine-configuration.js";
import type { StateMachineCheck, StateMachineIssue } from "./state-machine-types.js";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(code: string, path: string, message: string): StateMachineIssue {
  return { code, path, message };
}

const join = (path: string, key: string | number) => (path ? `${path}.${key}` : String(key));

/** What a value is, in a refusal. */
function kind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/**
 * The schema's checks, each refusal naming where in the file it is. Unlike a generic JSON
 * Schema validator, a value that matches none of a `oneOf`'s shapes is refused once, in words.
 */
class SchemaCheck {
  readonly issues: StateMachineIssue[] = [];

  private fail(path: string, message: string) {
    this.issues.push(issue("schema.invalid", path, message));
  }

  private keys(value: Json, path: string, allowed: readonly string[], what: string) {
    for (const key of Object.keys(value))
      if (!allowed.includes(key))
        this.fail(join(path, key), `${what} does not allow the key "${key}".`);
  }

  private nonEmptyString(value: unknown, path: string, what: string) {
    if (typeof value !== "string" || value.length === 0)
      this.fail(path, `${what} must be a non-empty string.`);
  }

  private object(value: unknown, path: string, what: string): value is Json {
    if (isRecord(value)) return true;
    this.fail(path, `${what} must be an object, not ${kind(value)}.`);
    return false;
  }

  machine(value: Json) {
    for (const key of ["version", "id", "initial", "states"])
      if (!(key in value)) this.fail(key, `The machine must have "${key}".`);
    this.keys(
      value,
      "",
      ["$schema", "version", "id", "description", "metadata", "initial", "context", "states"],
      "The machine",
    );
    if ("$schema" in value && typeof value.$schema !== "string")
      this.fail("$schema", '"$schema" must be a string.');
    if ("version" in value && value.version !== "1.0" && value.version !== "1.1")
      this.fail("version", 'The version must be "1.0" or "1.1".');
    if ("id" in value) this.nonEmptyString(value.id, "id", "The machine id");
    if ("description" in value && typeof value.description !== "string")
      this.fail("description", "The description must be a string.");
    if ("metadata" in value) this.object(value.metadata, "metadata", "The metadata");
    if ("initial" in value) this.nonEmptyString(value.initial, "initial", "The initial state");
    if ("context" in value) this.object(value.context, "context", "The context");
    if ("states" in value) this.states(value.states, "states");
  }

  private states(value: unknown, path: string) {
    if (!this.object(value, path, `"${path}"`)) return;
    if (Object.keys(value).length === 0) this.fail(path, `"${path}" must name at least one state.`);
    for (const [name, state] of Object.entries(value)) this.state(state, join(path, name));
  }

  private state(value: unknown, path: string) {
    if (!this.object(value, path, `State "${path}"`)) return;
    this.keys(
      value,
      path,
      ["description", "type", "initial", "states", "entry", "exit", "after", "invoke", "on"],
      `State "${path}"`,
    );
    if ("description" in value && typeof value.description !== "string")
      this.fail(join(path, "description"), `The description of "${path}" must be a string.`);
    if ("type" in value && !["atomic", "compound", "final"].includes(value.type as string))
      this.fail(join(path, "type"), `The type of "${path}" must be atomic, compound or final.`);
    if ("initial" in value)
      this.nonEmptyString(value.initial, join(path, "initial"), `The initial child of "${path}"`);
    if ("states" in value) this.states(value.states, join(path, "states"));
    for (const key of ["entry", "exit"] as const)
      if (key in value) this.namedImplementation(value[key], join(path, key));
    if ("after" in value) {
      const after = join(path, "after");
      if (this.object(value.after, after, `"${after}"`)) {
        if (Object.keys(value.after).length === 0)
          this.fail(after, `"${after}" must name at least one delay.`);
        for (const [delay, transitions] of Object.entries(value.after))
          this.transitions(transitions, join(after, delay));
      }
    }
    if ("invoke" in value) this.invoke(value.invoke, join(path, "invoke"));
    if ("on" in value) {
      const on = join(path, "on");
      if (this.object(value.on, on, `"${on}"`))
        for (const [event, transitions] of Object.entries(value.on)) {
          if (event.length === 0) this.fail(on, `An event name in "${on}" is empty.`);
          this.transitions(transitions, join(on, event));
        }
    }
  }

  private invoke(value: unknown, path: string) {
    if (!this.object(value, path, `"${path}"`)) return;
    this.keys(value, path, ["id", "src", "onDone", "onError"], `"${path}"`);
    if (!("src" in value)) this.fail(path, `"${path}" must name its "src".`);
    else this.nonEmptyString(value.src, join(path, "src"), `"${join(path, "src")}"`);
    if ("id" in value) this.nonEmptyString(value.id, join(path, "id"), `"${join(path, "id")}"`);
    for (const outcome of ["onDone", "onError"] as const)
      if (outcome in value) this.transitions(value[outcome], join(path, outcome));
  }

  /** A string, or a descriptor `{ type, params? }`. */
  private implementationReference(value: unknown, path: string) {
    if (typeof value === "string") {
      if (value.length === 0) this.fail(path, `The implementation at "${path}" is empty.`);
      return;
    }
    if (!isRecord(value)) {
      this.fail(path, `The implementation at "${path}" must be a name or { "type", "params" }.`);
      return;
    }
    this.keys(value, path, ["type", "params"], `The implementation at "${path}"`);
    this.nonEmptyString(value.type, join(path, "type"), `The implementation type at "${path}"`);
    if ("params" in value)
      this.object(value.params, join(path, "params"), `The params at "${path}"`);
  }

  private namedImplementation(value: unknown, path: string) {
    if (!Array.isArray(value)) return this.implementationReference(value, path);
    if (value.length === 0) this.fail(path, `The implementation list at "${path}" is empty.`);
    value.forEach((entry, index) => this.implementationReference(entry, join(path, index)));
  }

  private transition(value: unknown, path: string) {
    if (typeof value === "string") {
      if (value.length === 0) this.fail(path, `The transition at "${path}" is empty.`);
      return;
    }
    if (!isRecord(value)) {
      this.fail(path, `The transition at "${path}" must be a target or an object.`);
      return;
    }
    if (Object.keys(value).length === 0) this.fail(path, `The transition at "${path}" is empty.`);
    this.keys(value, path, ["target", "guard", "actions"], `The transition at "${path}"`);
    if ("target" in value)
      this.nonEmptyString(value.target, join(path, "target"), `The target at "${path}"`);
    if ("guard" in value) this.implementationReference(value.guard, join(path, "guard"));
    if ("actions" in value) this.namedImplementation(value.actions, join(path, "actions"));
  }

  private transitions(value: unknown, path: string) {
    if (!Array.isArray(value)) return this.transition(value, path);
    if (value.length === 0) this.fail(path, `The transition list at "${path}" is empty.`);
    value.forEach((entry, index) => this.transition(entry, join(path, index)));
  }
}

/** Parallel and history states, which the player does not run; checked before the schema. */
function unsupportedStates(states: unknown, parent = ""): StateMachineIssue[] {
  if (!isRecord(states)) return [];
  return Object.entries(states).flatMap(([name, state]) => {
    if (!isRecord(state)) return [];
    const path = join(parent, name);
    const found =
      state.type === "parallel" || state.type === "history"
        ? [
            issue(
              "state.type.unsupported",
              `states.${path}.type`,
              `State "${path}" uses unsupported type "${String(state.type)}". Only atomic, compound, and final states are supported.`,
            ),
          ]
        : [];
    return [...found, ...unsupportedStates(state.states, path)];
  });
}

/** Every state by its dotted path. */
function collectNodes(states: Json, parent = ""): Map<string, Json> {
  const nodes = new Map<string, Json>();
  for (const [name, state] of Object.entries(states)) {
    const path = join(parent, name);
    nodes.set(path, state as Json);
    const children = (state as Json).states;
    if (isRecord(children))
      for (const [key, node] of collectNodes(children, path)) nodes.set(key, node);
  }
  return nodes;
}

/** A target as a node path: `#<id>.` is absolute, a sibling is looked up beside its source. */
function resolveTarget(id: string, nodes: Map<string, Json>, source: string, target: string) {
  const absolute = `#${id}.`;
  if (target.startsWith(absolute)) return target.slice(absolute.length);
  if (target.startsWith("#")) return "";
  if (nodes.has(target)) return target;
  const dot = source.lastIndexOf(".");
  return dot === -1 ? target : `${source.slice(0, dot)}.${target}`;
}

interface Target {
  source: string;
  target: string;
  path: string;
}

function inspectTransitions(
  value: unknown,
  source: string,
  path: string,
  issues: StateMachineIssue[],
  targets: Target[],
) {
  const entries = Array.isArray(value) ? value : [value];
  let fallback: number | null = null;
  entries.forEach((entry, index) => {
    const entryPath = `${path}.${index}`;
    const target = typeof entry === "string" ? entry : isRecord(entry) ? entry.target : undefined;
    if (typeof target === "string") targets.push({ source, target, path: `${entryPath}.target` });
    const guarded = isRecord(entry) && "guard" in entry;
    if (!guarded && fallback === null) fallback = index;
    else if (fallback !== null)
      issues.push(
        issue(
          "transition.unreachable",
          entryPath,
          `Transition at ${entryPath} is unreachable because an unguarded fallback appears first.`,
        ),
      );
  });
}

function inspectStates(states: Json, issues: StateMachineIssue[], targets: Target[], parent = "") {
  for (const [name, raw] of Object.entries(states)) {
    const state = raw as Json;
    const path = join(parent, name);
    const children = state.states;
    const initial = state.initial;
    const type = state.type;
    if (isRecord(children)) {
      if (typeof initial !== "string")
        issues.push(
          issue(
            "state.initial.required",
            `states.${path}.initial`,
            `Compound state "${path}" must define its initial child.`,
          ),
        );
      else if (!(initial in children))
        issues.push(
          issue(
            "state.initial.unknown",
            `states.${path}.initial`,
            `State "${path}" has unknown initial child "${initial}".`,
          ),
        );
    }
    if (type === "atomic" && isRecord(children))
      issues.push(
        issue(
          "state.atomic.children",
          `states.${path}.states`,
          `Atomic state "${path}" cannot define child states.`,
        ),
      );
    if (type === "final" && ["initial", "states", "invoke", "on", "after"].some((k) => k in state))
      issues.push(
        issue(
          "state.final.children",
          `states.${path}`,
          `Final state "${path}" cannot define child states, invocation, watchdogs, or transitions.`,
        ),
      );
    if (type === "final" && path !== "activity.complete")
      issues.push(
        issue(
          "state.final.location",
          `states.${path}.type`,
          `Only "activity.complete" may be final in a state machine; "${path}" would terminate early.`,
        ),
      );
    if (isRecord(state.on))
      for (const [event, value] of Object.entries(state.on))
        inspectTransitions(value, path, `states.${path}.on.${event}`, issues, targets);
    if (isRecord(state.after))
      for (const [delay, value] of Object.entries(state.after)) {
        if (!/^[0-9]+$/.test(delay) || Number(delay) <= 0)
          issues.push(
            issue(
              "after.delay",
              `states.${path}.after.${delay}`,
              `Watchdog delay at "${path}.after.${delay}" must be a positive integer number of milliseconds.`,
            ),
          );
        inspectTransitions(value, path, `states.${path}.after.${delay}`, issues, targets);
      }
    if (isRecord(state.invoke)) {
      if (isRecord(children))
        issues.push(
          issue(
            "invoke.compound",
            `states.${path}.invoke`,
            `Compound state "${path}" cannot invoke work; place the invocation on an active leaf state.`,
          ),
        );
      for (const outcome of ["onDone", "onError"] as const)
        if (outcome in state.invoke)
          inspectTransitions(
            state.invoke[outcome],
            path,
            `states.${path}.invoke.${outcome}`,
            issues,
            targets,
          );
    }
    if (isRecord(children)) inspectStates(children, issues, targets, path);
  }
}

/**
 * The scene states a machine must have: each scene of the specification but the general one,
 * or the scaffold's placeholder when there is none, as Loom asks.
 */
export function machineSceneIds(spec: unknown): Set<string> {
  const raw = isRecord(spec) ? (spec.scenes ?? spec.stages) : undefined;
  const ids = new Set(
    (Array.isArray(raw) ? raw : [])
      .filter((scene): scene is Json => isRecord(scene) && !isGeneralScene(scene))
      .map((scene) => String(scene.id ?? "").trim())
      .filter(Boolean),
  );
  if (ids.size === 0) ids.add(SCAFFOLD_PLACEHOLDER_SCENE_ID);
  return ids;
}

/** Every problem the machine has, none when it may be saved. `spec` names its scenes. */
export function validateStateMachine(value: unknown, spec: unknown): StateMachineIssue[] {
  if (!isRecord(value))
    return [issue("machine.type", "", "The state machine must be a JSON object.")];
  const unsupported = unsupportedStates(value.states);
  if (unsupported.length) return unsupported;
  const schema = new SchemaCheck();
  schema.machine(value);
  if (schema.issues.length) return schema.issues;

  const states = value.states as Json;
  const id = value.id as string;
  const initial = value.initial as string;
  const nodes = collectNodes(states);
  const issues: StateMachineIssue[] = [];
  const targets: Target[] = [];
  if (!(initial in states))
    issues.push(issue("initial.unknown", "initial", `Initial state "${initial}" does not exist.`));
  inspectStates(states, issues, targets);
  for (const { source, target, path } of targets)
    if (!nodes.has(resolveTarget(id, nodes, source, target)))
      issues.push(
        issue("transition.target.unknown", path, `Transition target "${target}" does not exist.`),
      );
  const scenes = machineSceneIds(spec);
  for (const scene of [...scenes].filter((scene) => !(scene in states)).sort())
    issues.push(
      issue(
        "scene.missing",
        `states.${scene}`,
        `The machine does not define scene state "${scene}".`,
      ),
    );
  for (const scene of Object.keys(states)
    .filter((name) => !scenes.has(name) && name !== "activity")
    .sort())
    issues.push(
      issue(
        "scene.unknown",
        `states.${scene}`,
        `The machine defines unknown scene state "${scene}".`,
      ),
    );
  const complete = nodes.get("activity.complete");
  if (!complete || complete.type !== "final")
    issues.push(
      issue(
        "activity.complete",
        "states.activity.states.complete",
        "The machine must define activity.complete as a final state.",
      ),
    );
  const activity = nodes.get("activity");
  if (activity && activity.initial !== undefined && activity.initial !== "complete")
    issues.push(
      issue(
        "activity.initial",
        "states.activity.initial",
        'The "activity" compound state must use "complete" as its initial child.',
      ),
    );
  return issues;
}

/**
 * An unsaved machine's problems, each marked `inherited` when `baseline`, the machine being
 * edited, already had it: a save is refused only for the others.
 */
export function checkStateMachine(
  value: unknown,
  spec: unknown,
  baseline: unknown,
): StateMachineCheck {
  const key = (found: StateMachineIssue) => `${found.code} ${found.path}`;
  const inherited = new Set(
    isRecord(baseline) ? validateStateMachine(baseline, spec).map(key) : [],
  );
  const issues = validateStateMachine(value, spec).map((found) => ({
    ...found,
    inherited: inherited.has(key(found)),
  }));
  return { valid: issues.length === 0, savable: issues.every((found) => found.inherited), issues };
}
