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

/** The document the Studio reads, from what was found and who is reading. */
export function stateMachineDocument(
  found: FoundStateMachine,
  context: { productCode: string; refNum: number; canEdit: boolean; book: boolean },
): StateMachineDocument {
  return {
    productCode: context.productCode,
    refNum: context.refNum,
    definition: found.definition,
    validation: { valid: found.issues.length === 0, issues: found.issues },
    source: found.source,
    file: found.file,
    edited: found.source === "draft",
    stale: found.stale ?? false,
    editable: context.canEdit && !context.book,
    locked: context.book ? "book" : null,
  };
}
