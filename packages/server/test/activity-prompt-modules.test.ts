/**
 * The stage prompts' own modules (`src/activities/prompts/`, decision 18) hold prompt text and
 * nothing else: no imports, and only exported constants that are text — string and template
 * literals, joined with `+` — or text templates filled from one `values` parameter. So an edit
 * there can change what an agent is told and nothing about how a run is collected or checked:
 * the activity bench takes such an edit as part of a recipe, and the Reflector may write it
 * (decision 15). What a prompt says is pinned by activity-run-kinds-golden.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PROMPTS = path.join(import.meta.dirname, "..", "src", "activities", "prompts");

/** Why a prompt module's source is not text only, or [] when it is. */
function problems(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const consts = new Set<string>();
  const where = (node: ts.Node) =>
    `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

  /** Text: literals, `+` of text, and in a substitution a constant, a value or a template call. */
  const isText = (node: ts.Expression, parameter: string | null): boolean => {
    if (ts.isParenthesizedExpression(node)) return isText(node.expression, parameter);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
    if (ts.isTemplateExpression(node))
      return node.templateSpans.every((span) => isReference(span.expression, parameter));
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return isText(node.left, parameter) && isText(node.right, parameter);
    return isReference(node, parameter);
  };
  const isReference = (node: ts.Expression, parameter: string | null): boolean => {
    if (ts.isIdentifier(node)) return consts.has(node.text);
    if (ts.isPropertyAccessExpression(node))
      return ts.isIdentifier(node.expression) && node.expression.text === parameter;
    if (ts.isCallExpression(node))
      return (
        ts.isIdentifier(node.expression) &&
        consts.has(node.expression.text) &&
        node.arguments.length === 1 &&
        ts.isIdentifier(node.arguments[0]!) &&
        node.arguments[0].text === parameter
      );
    return false;
  };
  const isValuesType = (node: ts.TypeNode | undefined): boolean =>
    !!node &&
    ts.isTypeLiteralNode(node) &&
    node.members.every(
      (member) =>
        ts.isPropertySignature(member) &&
        member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) === true &&
        !!member.type &&
        /^(string|number|string \| number)$/.test(member.type.getText(source)),
    );

  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (
      !ts.isVariableStatement(statement) ||
      !exported ||
      !(statement.declarationList.flags & ts.NodeFlags.Const) ||
      statement.declarationList.declarations.length !== 1
    ) {
      found.push(`${where(statement)}: only exported text constants belong here`);
      continue;
    }
    const declaration = statement.declarationList.declarations[0]!;
    const init = declaration.initializer;
    const name = declaration.name.getText(source);
    if (!init || declaration.type) {
      found.push(`${where(statement)}: ${name} must be text`);
    } else if (ts.isArrowFunction(init)) {
      const [parameter, ...rest] = init.parameters;
      const ok =
        !rest.length &&
        parameter &&
        ts.isIdentifier(parameter.name) &&
        parameter.name.text === "values" &&
        isValuesType(parameter.type) &&
        !init.type &&
        !ts.isBlock(init.body) &&
        isText(init.body as ts.Expression, "values");
      if (!ok) found.push(`${where(statement)}: ${name} must be a text template of values`);
    } else if (!isText(init, null)) {
      found.push(`${where(statement)}: ${name} must be text`);
    }
    consts.add(name);
  }
  return found;
}

describe("the stage prompts' own modules", () => {
  const files = fs.readdirSync(PROMPTS).sort();

  it("are one per stage that has a prompt", () => {
    expect(files).toEqual([
      "assessment.ts",
      "assist.ts",
      "composition.ts",
      "critique.ts",
      "image.ts",
      "media-text.ts",
      "module.ts",
      "phonemes.ts",
      "spec.ts",
      "test.ts",
      "timeline.ts",
    ]);
  });

  it("hold prompt text and nothing else", () => {
    for (const file of files)
      expect(problems(file, fs.readFileSync(path.join(PROMPTS, file), "utf8")), file).toEqual([]);
  });

  it("would refuse code beside the text", () => {
    for (const [text, problem] of [
      ['import fs from "node:fs";\nexport const A = "x";\n', "only exported text constants"],
      ["export const A = String(process.env.HOME);\n", "A must be text"],
      [
        "export const A = (values: { readonly x: string }) => { return values.x; };\n",
        "text template",
      ],
      [
        "export const A = (values: { readonly x: string }) => `${eval(values.x)}`;\n",
        "text template",
      ],
      ["export function A() { return 'x'; }\n", "only exported text constants"],
    ] as const) {
      expect(problems("probe.ts", text).join("\n"), text).toContain(problem);
    }
  });
});
