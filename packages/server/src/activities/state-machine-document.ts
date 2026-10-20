/**
 * A ref's state machine as Loom's GET returned it: the definition in effect, where it came
 * from, and what is wrong with it. A file that is missing, not JSON or not an object is
 * reported as such rather than refused, so the Studio can show it and the author can fix it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { STATE_MACHINE_FILE } from "./ref-files.js";
import type { StateMachineDocument, StateMachineIssue } from "./state-machine-types.js";
import { validateStateMachine } from "./state-machine-validation.js";
import { moduleDocumentPath, ModuleLayout } from "./waf-layout.js";

/** What was found for a ref's machine: in a module, or the author's edit in the draft. */
export interface FoundStateMachine {
  definition: Record<string, unknown> | null;
  issues: StateMachineIssue[];
  source: "ref" | "product" | "draft" | null;
  file: string;
  /** An edit that predates the current specification. */
  stale?: boolean;
}

const MISSING: StateMachineIssue = {
  code: "machine.missing",
  path: "",
  message: "This activity does not have a state-machine.json definition yet.",
};

/**
 * The first machine in `roots`, read in the order the preview and an assembly read it
 * (`readModuleStateMachine`): the product's `spec/state-machine.json`, then the ref's.
 */
export async function findStateMachine(
  roots: readonly string[],
  productCode: string,
  refNum: number,
  spec: unknown,
): Promise<FoundStateMachine> {
  for (const root of roots) {
    const module = new ModuleLayout(root);
    for (const [source, dir] of [
      ["product", module.productSpecDir(productCode)],
      ["ref", module.refSpecDir(productCode, refNum)],
    ] as const) {
      const absolute = path.join(dir, STATE_MACHINE_FILE);
      const text = await fs.readFile(absolute, "utf8").catch(() => null);
      if (text === null) continue;
      const file = path.relative(root, absolute).split(path.sep).join("/");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        return {
          definition: null,
          source,
          file,
          issues: [
            {
              code: "machine.json",
              path: "",
              message: `The state-machine.json definition is invalid JSON: ${(error as Error).message}.`,
            },
          ],
        };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {
          definition: null,
          source,
          file,
          issues: [
            {
              code: "machine.type",
              path: "",
              message: "The state-machine.json definition must be an object.",
            },
          ],
        };
      const definition = parsed as Record<string, unknown>;
      return { definition, source, file, issues: validateStateMachine(definition, spec) };
    }
  }
  return {
    definition: null,
    source: null,
    file: moduleDocumentPath("stateMachine", productCode, refNum),
    issues: [MISSING],
  };
}

/** The file extensions a module's own code is in. */
const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;

/**
 * Everything in the `src` folder of the first of `roots` that has one, as one text, so the
 * names a machine gives its actions, guards and services can be looked for in it; null when
 * no root has code to look in.
 */
export async function moduleSourceText(roots: readonly string[]): Promise<string | null> {
  for (const root of roots) {
    const src = path.join(root, "src");
    const entries = await fs
      .readdir(src, { recursive: true, withFileTypes: true })
      .catch(() => null);
    if (!entries) continue;
    const parts: string[] = [];
    for (const entry of entries)
      if (
        entry.isFile() &&
        SOURCE_FILE.test(entry.name) &&
        !entry.parentPath.includes("node_modules")
      )
        parts.push(await fs.readFile(path.join(entry.parentPath, entry.name), "utf8"));
    return parts.join("\n");
  }
  return null;
}

/** The document the Studio reads, from what was found and who is reading. */
export function stateMachineDocument(
  found: FoundStateMachine,
  context: {
    productCode: string;
    refNum: number;
    canEdit: boolean;
    book: boolean;
    canonicalRefNum: number | null;
  },
): StateMachineDocument {
  // A ref that is not the canonical one reads the product's machine but does not edit it.
  const shared = context.canonicalRefNum !== null && context.canonicalRefNum !== context.refNum;
  const locked = context.book ? "book" : shared ? "shared" : null;
  return {
    productCode: context.productCode,
    refNum: context.refNum,
    definition: found.definition,
    validation: { valid: found.issues.every((issue) => issue.warning), issues: found.issues },
    source: found.source,
    file: found.file,
    edited: found.source === "draft",
    stale: found.stale ?? false,
    editable: context.canEdit && !locked,
    locked,
    canonicalRefNum: context.canonicalRefNum,
  };
}
