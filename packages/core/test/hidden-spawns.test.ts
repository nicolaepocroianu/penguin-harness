/**
 * Every child process Penguin starts is hidden on Windows (`windowsHide: true`), except the
 * few that exist to put something in front of the user.
 *
 * Why: a process with no console of its own — the desktop app, its server, the server
 * `penguin` starts in the background — gives every unhidden console program it starts a NEW
 * console window. With Windows Terminal as the default terminal that window also takes focus,
 * so a version check, an update run or an ssh call pulls the user out of whatever they were
 * doing. The option is ignored on macOS and Linux.
 *
 * The check reads source, not behaviour. Every call to a `child_process` function — imported
 * by name or as a namespace, or reached through a local alias such as a promisified
 * `execFile` or an injectable default — must pass an object literal holding
 * `windowsHide: true`. A reference the check cannot follow (handed to another function,
 * re-exported, a dynamic import) fails as well, so a new call site cannot slip past it. It
 * lives in core because every surface builds on core; it scans every package and plugin.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * The spawns that are meant to be seen, keyed `<file>#<enclosing function>`, with the reason.
 * Everything else is hidden.
 */
const VISIBLE: Record<string, string> = {
  "packages/server/src/services/reveal-path.ts#revealInFileManager":
    "opens the file manager on a file the user asked to see",
  "packages/cli/src/commands/serve.ts#openBrowser": "opens the user's browser on the app",
  "packages/cli/src/lang-config.ts#restartShell":
    "the user's own interactive shell, in their terminal",
};

const SPAWNERS = new Set([
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
]);
const MODULES = new Set(["child_process", "node:child_process"]);
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;

interface FileReport {
  /** How many child_process calls the file makes. */
  calls: number;
  /** Calls without `windowsHide: true` and references the check cannot follow. */
  problems: string[];
  /** VISIBLE keys this file used. */
  visible: string[];
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function isChildProcessModule(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isStringLiteralLike(node) && MODULES.has(node.text);
}

/** `require("node:child_process")`. */
function isRequireOfChildProcess(node: ts.Expression): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require" &&
    isChildProcessModule(node.arguments[0])
  );
}

function inTypePosition(node: ts.Node): boolean {
  for (let at = node.parent; at !== undefined && !ts.isSourceFile(at); at = at.parent) {
    if (ts.isTypeQueryNode(at) || ts.isTypeReferenceNode(at) || ts.isQualifiedName(at)) return true;
  }
  return false;
}

/** An identifier that reads a value, as opposed to naming a declaration or a member. */
function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent)) {
    return false;
  }
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) {
    return false;
  }
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node) {
    return false;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (
    (ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return !inTypePosition(node);
}

/** Some argument is an object literal holding `windowsHide: true`. */
function hidesWindow(call: ts.CallExpression): boolean {
  return call.arguments.some(
    (arg) =>
      ts.isObjectLiteralExpression(arg) &&
      arg.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          p.name.getText() === "windowsHide" &&
          p.initializer.kind === ts.SyntaxKind.TrueKeyword,
      ),
  );
}

/** The name of the nearest named function around `node`: what a VISIBLE key names. */
function enclosingFunction(node: ts.Node): string {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name) {
      return at.name.getText();
    }
    if (
      (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) &&
      ts.isVariableDeclaration(at.parent) &&
      ts.isIdentifier(at.parent.name)
    ) {
      return at.parent.name.text;
    }
  }
  return "(top level)";
}

/** Checks one source file; `file` is repo-relative with forward slashes. */
function checkSource(file: string, text: string): FileReport {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const report: FileReport = { calls: 0, problems: [], visible: [] };
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  // Local names for child_process: functions (and their aliases), and whole-module namespaces.
  const functions = new Set<string>();
  const namespaces = new Set<string>();
  const visitBindings = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      isChildProcessModule(node.moduleSpecifier) &&
      node.importClause?.isTypeOnly !== true
    ) {
      const clause = node.importClause;
      if (clause?.name) namespaces.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly && SPAWNERS.has((element.propertyName ?? element.name).text)) {
            functions.add(element.name.text);
          }
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isRequireOfChildProcess(node.initializer)
    ) {
      if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const imported = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(imported) &&
            ts.isIdentifier(element.name) &&
            SPAWNERS.has(imported.text)
          ) {
            functions.add(element.name.text);
          }
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      isChildProcessModule(node.arguments[0])
    ) {
      report.problems.push(
        `${file}:${lineOf(node)} imports child_process dynamically; import it statically so this check can follow it`,
      );
    }
    ts.forEachChild(node, visitBindings);
  };
  visitBindings(sf);
  if (functions.size === 0 && namespaces.size === 0) return report;

  /** A child_process function, as an expression: `spawn`, `cp.spawn`, or an alias of one. */
  const refersToSpawner = (node: ts.Expression): boolean =>
    (ts.isIdentifier(node) && functions.has(node.text)) ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text) &&
      SPAWNERS.has(node.name.text));
  /** Where a child_process function becomes a local alias: `promisify(execFile)`, `injected ?? spawn`, `= spawn`. */
  const aliasSources = (init: ts.Expression): ts.Expression[] => {
    const e = ts.isParenthesizedExpression(init) ? init.expression : init;
    if (refersToSpawner(e)) return [e];
    if (
      ts.isCallExpression(e) &&
      ts.isIdentifier(e.expression) &&
      e.expression.text === "promisify" &&
      e.arguments[0] &&
      refersToSpawner(e.arguments[0])
    ) {
      return [e.arguments[0]];
    }
    if (
      ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      return [e.left, e.right].filter(refersToSpawner);
    }
    return [];
  };
  /** References that only make an alias; the alias's own calls are what gets checked. */
  const followed = new Set<ts.Node>();
  /**
   * Alias names. An injectable default (`{ spawnProcess = spawn }`) is often kept on the
   * instance, so a call through `this.<alias>(...)` is checked as a call too.
   */
  const aliases = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    const visitAliases = (node: ts.Node): void => {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const sources = aliasSources(node.initializer);
        if (sources.length > 0 && !functions.has(node.name.text)) {
          functions.add(node.name.text);
          aliases.add(node.name.text);
          grew = true;
        }
        for (const source of sources) followed.add(source);
      }
      ts.forEachChild(node, visitAliases);
    };
    visitAliases(sf);
  }

  /** An alias kept on an object under its own name (`{ spawnProcess }`, `this.spawnProcess = spawnProcess`). */
  const storedUnderOwnName = (node: ts.Expression): boolean => {
    if (!ts.isIdentifier(node) || !aliases.has(node.text)) return false;
    const parent = node.parent;
    return (
      ts.isShorthandPropertyAssignment(parent) ||
      (ts.isPropertyAssignment(parent) && parent.name.getText(sf) === node.text) ||
      (ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.right === node &&
        ts.isPropertyAccessExpression(parent.left) &&
        parent.left.name.text === node.text)
    );
  };
  const checkCall = (call: ts.CallExpression): void => {
    report.calls += 1;
    if (hidesWindow(call)) return;
    const key = `${file}#${enclosingFunction(call)}`;
    if (key in VISIBLE) {
      report.visible.push(key);
    } else {
      report.problems.push(
        `${file}:${lineOf(call)} ${call.expression.getText(sf)}(...) does not pass windowsHide: true`,
      );
    }
  };

  const visitUses = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      aliases.has(node.expression.name.text) &&
      !refersToSpawner(node.expression)
    ) {
      checkCall(node);
    }
    const expression =
      (ts.isIdentifier(node) && isValueReference(node)) ||
      (ts.isPropertyAccessExpression(node) && !inTypePosition(node))
        ? node
        : undefined;
    if (expression !== undefined && refersToSpawner(expression)) {
      const parent = expression.parent;
      if (ts.isCallExpression(parent) && parent.expression === expression) {
        checkCall(parent);
      } else if (!followed.has(expression) && !storedUnderOwnName(expression)) {
        report.problems.push(
          `${file}:${lineOf(expression)} ${expression.getText(sf)} is used where this check cannot follow it; call it directly or alias it as a local`,
        );
      }
      return;
    }
    // A namespace used any other way than `ns.<function>` (passed along, destructured later).
    if (ts.isIdentifier(node) && namespaces.has(node.text) && isValueReference(node)) {
      const parent = node.parent;
      if (!(ts.isPropertyAccessExpression(parent) && parent.expression === node)) {
        report.problems.push(
          `${file}:${lineOf(node)} the child_process namespace ${node.text} is used where this check cannot follow it`,
        );
      }
    }
    ts.forEachChild(node, visitUses);
  };
  visitUses(sf);
  return report;
}

/** Every source file of every package and plugin (their src, and plugin hooks). */
function sourceFiles(): string[] {
  const roots: string[] = [];
  for (const group of ["packages", "plugins"]) {
    for (const entry of readdirSync(path.join(repoRoot, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const sub of ["src", "hooks"]) roots.push(path.join(repoRoot, group, entry.name, sub));
    }
  }
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(full);
    }
  };
  for (const root of roots) walk(root);
  return files;
}

describe("child processes are hidden on Windows", () => {
  const reports = sourceFiles().flatMap((full) => {
    const text = readFileSync(full, "utf8");
    if (!text.includes("child_process")) return [];
    const file = path.relative(repoRoot, full).split(path.sep).join("/");
    return [{ file, ...checkSource(file, text) }];
  });

  it("passes windowsHide: true at every spawn that is not meant to be seen", () => {
    expect(reports.flatMap((r) => r.problems)).toEqual([]);
  });

  it("finds the spawns it guards (the scan is not looking in the wrong place)", () => {
    const withCalls = new Set(reports.filter((r) => r.calls > 0).map((r) => r.file));
    for (const file of [
      "packages/coding-agents/src/connection.ts",
      "packages/coding-agents/src/discovery.ts",
      "packages/server/src/services/update-job.ts",
      "packages/server/src/machines/transport/exec.ts",
      "packages/core/src/hooks/script-hook.ts",
      "packages/desktop/src/cli-install.ts",
      "plugins/sandbox-mxc/src/index.ts",
    ]) {
      expect(withCalls, file).toContain(file);
    }
  });

  it("lists only visible spawns that still exist", () => {
    const used = new Set(reports.flatMap((r) => r.visible));
    expect(Object.keys(VISIBLE).filter((key) => !used.has(key))).toEqual([]);
  });
});

describe("the hidden-spawn check itself", () => {
  const problems = (text: string) => checkSource("x/src/a.ts", text).problems;

  it("accepts a hidden spawn and flags an unhidden one", () => {
    expect(
      problems(
        `import { spawn } from "node:child_process"; spawn("a", [], { windowsHide: true });`,
      ),
    ).toEqual([]);
    expect(
      problems(`import { spawn } from "node:child_process"; spawn("a", [], { stdio: "ignore" });`),
    ).toHaveLength(1);
    expect(
      problems(`import { execFile } from "child_process"; execFile("a", ["b"], () => {});`),
    ).toHaveLength(1);
    expect(
      problems(
        `import { spawn } from "node:child_process"; spawn("a", [], { windowsHide: false });`,
      ),
    ).toHaveLength(1);
  });

  it("follows namespaces and local aliases", () => {
    expect(
      problems(`import * as cp from "node:child_process"; cp.execFileSync("a", []);`),
    ).toHaveLength(1);
    expect(
      problems(`import cp from "node:child_process"; cp.spawn("a", [], { windowsHide: true });`),
    ).toEqual([]);
    expect(
      problems(`import { execFile } from "node:child_process"; import { promisify } from "node:util";
      const run = promisify(execFile); await run("reg", ["query"]);`),
    ).toHaveLength(1);
    expect(
      problems(`import { execFile } from "node:child_process"; import { promisify } from "node:util";
      const run = promisify(execFile); await run("reg", ["query"], { windowsHide: true });`),
    ).toEqual([]);
    expect(
      problems(`import { spawn } from "node:child_process";
      function start(impl: typeof spawn = spawn) { impl("a", [], {}); }`),
    ).toHaveLength(1);
    expect(
      problems(`import { spawn } from "node:child_process";
      function start(impl?: typeof spawn) { const run = impl ?? spawn; run("a", [], { windowsHide: true }); }`),
    ).toEqual([]);
    expect(
      problems(`const { spawnSync } = require("node:child_process"); spawnSync("a", []);`),
    ).toHaveLength(1);
  });

  it("follows an injectable default kept on the instance", () => {
    const client = (options: string) => `import { spawn } from "node:child_process";
      class Client {
        constructor({ spawnProcess = spawn }) { Object.assign(this, { spawnProcess }); }
        start() { this.spawnProcess("a", [], ${options}); }
      }`;
    expect(problems(client("{ windowsHide: true }"))).toEqual([]);
    expect(problems(client("{ stdio: 'pipe' }"))).toHaveLength(1);
  });

  it("flags what it cannot follow", () => {
    expect(problems(`import { spawn } from "node:child_process"; register(spawn);`)).toHaveLength(
      1,
    );
    expect(problems(`import * as cp from "node:child_process"; register(cp);`)).toHaveLength(1);
    expect(problems(`const cp = await import("node:child_process");`)).toHaveLength(1);
  });

  it("ignores types and other modules", () => {
    expect(
      problems(
        `import { spawn, type ChildProcess } from "node:child_process"; type S = typeof spawn; let c: ChildProcess;`,
      ),
    ).toEqual([]);
    expect(problems(`import { spawn } from "./my-spawn.js"; spawn("a", []);`)).toEqual([]);
    expect(
      problems(`import { spawn } from "node:child_process";
      class Agent { static spawn() { return /x/.exec("x"); } } Agent.spawn();`),
    ).toEqual([]);
  });
});
