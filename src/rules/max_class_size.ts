/**
 * @module MaxClassSize
 * @path packages/lint-rules/src/rules/max_class_size.ts
 * @description Class-size (god-object) score as a plugin rule on the Deno ESTree.
 *   Indicators ported from scripts/check_god_objects.ts.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts, packages/lint-rules/tests/max_class_size_test.ts]
 */

import { asNode, type ILintNode, isNodeLike, programOf, walk } from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

/** Class-size indicators, matching the check_god_objects.ts metrics. */
export interface IClassIndicators {
  readonly lineCount: number;
  readonly methodCount: number;
  readonly ctorParams: number;
  readonly importCount: number;
  readonly fieldCount: number;
  readonly maxMethodLines: number;
}

const METHOD_CAP = 30;
const METHOD_WEIGHT = 1.5;
const CTOR_PARAM_LIMIT = 7;
const CTOR_WEIGHT = 3;
const LINE_DIVISOR = 50;
const LONGEST_METHOD_BASELINE = 100;
const LONGEST_METHOD_DIVISOR = 10;
const IMPORT_BASELINE = 24;
const IMPORT_WEIGHT = 1.5;
const FIELD_BASELINE = 3;
const FIELD_WEIGHT = 0.8;

/** The line span of a node, from its byte range in `text`, or 0 when unavailable. */
function lineSpan(node: ILintNode, text: string): number {
  const range = node.range;
  if (!Array.isArray(range) || range.length !== 2) return 0;
  const start = range[0];
  const end = range[1];
  if (typeof start !== "number" || typeof end !== "number") return 0;
  return text.slice(start, end).split("\n").length;
}

/** The declared parameter count of a method definition, or 0. */
function paramCount(method: ILintNode): number {
  const value = method.value;
  if (!isNodeLike(value)) return 0;
  const params = asNode(value).params;
  return Array.isArray(params) ? params.length : 0;
}

/** Collects the class indicators, or null when the class is under `minClassLines`. */
export function collectClassIndicators(
  classNode: ILintNode,
  text: string,
  importCount: number,
  minClassLines: number,
): IClassIndicators | null {
  const lineCount = lineSpan(classNode, text);
  if (lineCount < minClassLines) return null;
  let methodCount = 0;
  let fieldCount = 0;
  let ctorParams = 0;
  let seenConstructor = false;
  let maxMethodLines = 0;
  walk(classNode, (node) => {
    if (node.type === "MethodDefinition") {
      if (node.kind === "constructor") {
        if (!seenConstructor) {
          seenConstructor = true;
          ctorParams = paramCount(node);
        }
        return;
      }
      // ts-morph's MethodDeclaration excludes get/set accessors, so the port does too.
      if (node.kind !== "method") return;
      methodCount++;
      const span = lineSpan(node, text);
      if (span > maxMethodLines) maxMethodLines = span;
    } else if (node.type === "Property" && node.method === true) {
      // Object-literal method shorthand is a MethodDeclaration in the TypeScript AST.
      methodCount++;
      const span = lineSpan(node, text);
      if (span > maxMethodLines) maxMethodLines = span;
    } else if (node.type === "PropertyDefinition") {
      fieldCount++;
    }
  });
  return { lineCount, methodCount, ctorParams, importCount, fieldCount, maxMethodLines };
}

/** The check_god_objects.ts score for the collected indicators. */
export function classSizeScore(m: IClassIndicators, minClassLines: number): number {
  const methodTerm = Math.min(m.methodCount, METHOD_CAP) * METHOD_WEIGHT;
  const ctorTerm = m.ctorParams > CTOR_PARAM_LIMIT ? m.ctorParams * CTOR_WEIGHT : 0;
  const lineTerm = Math.max(0, (m.lineCount - minClassLines) / LINE_DIVISOR);
  const longestTerm = Math.max(0, (m.maxMethodLines - LONGEST_METHOD_BASELINE) / LONGEST_METHOD_DIVISOR);
  const importTerm = Math.max(0, (m.importCount - IMPORT_BASELINE) * IMPORT_WEIGHT);
  const fieldTerm = Math.max(0, m.fieldCount - FIELD_BASELINE) * FIELD_WEIGHT;
  return Math.round(methodTerm + ctorTerm + lineTerm + longestTerm + importTerm + fieldTerm);
}

function countImports(program: ILintNode): number {
  const statements = program.body;
  if (!Array.isArray(statements)) return 0;
  return statements.filter((statement) => isNodeLike(statement) && asNode(statement).type === "ImportDeclaration")
    .length;
}

/** The declared class name, or `(anonymous)`. */
function classNameOf(classNode: ILintNode): string {
  const id = classNode.id;
  if (isNodeLike(id) && typeof asNode(id).name === "string") return asNode(id).name as string;
  return "(anonymous)";
}

export function createMaxClassSize(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const minClassLines = typeof ctx.options.minClassLines === "number" ? ctx.options.minClassLines : 200;
  const threshold = typeof ctx.options.threshold === "number" ? ctx.options.threshold : 60;
  const importCount = countImports(programOf(context.sourceCode));
  const text = context.sourceCode.getText();

  const check = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const indicators = collectClassIndicators(node, text, importCount, minClassLines);
    if (indicators === null) return;
    const score = classSizeScore(indicators, minClassLines);
    if (score < threshold) return;
    context.report({
      node: rawNode,
      message: `Class ${
        classNameOf(node)
      } score ${score} (limit ${threshold}; ${indicators.methodCount} methods, ${indicators.lineCount} lines).`,
      hint: "Split the class into smaller, focused units.",
    });
  };

  return { ClassDeclaration: check };
}
