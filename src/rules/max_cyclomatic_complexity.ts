/**
 * @module MaxCyclomaticComplexity
 * @path packages/lint-rules/src/rules/max_cyclomatic_complexity.ts
 * @description Cyclomatic-complexity limit as a plugin rule on the Deno ESTree.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts, tests/scripts/measure_complexity_babel_parity_test.ts]
 */

import { asNode, type ILintNode, isNodeLike, walk } from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const DECISION_NODES = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
  "ConditionalExpression",
]);

/**
 * True when a node is one decision point. Matches `scripts/measure_complexity.ts`:
 * a `SwitchCase` counts only with a test. A `LogicalExpression` counts only for `||` and `&&`.
 */
function isDecision(node: ILintNode): boolean {
  if (node.type === "SwitchCase") return node.test !== null && node.test !== undefined;
  if (node.type === "LogicalExpression") return node.operator === "||" || node.operator === "&&";
  return DECISION_NODES.has(node.type);
}

/** Cyclomatic complexity of one function, excluding nested function bodies. */
function complexityOf(fn: ILintNode): number {
  let complexity = 1;
  const body = fn.body;
  if (!isNodeLike(body)) return complexity;
  const root = asNode(body);
  walk(root, (node) => {
    if (node !== root && FUNCTION_NODES.has(node.type)) return false;
    if (isDecision(node)) complexity++;
    return true;
  });
  return complexity;
}

/** The declared name of a function node, or a fallback label. */
function nameOf(node: ILintNode): string {
  const id = node.id;
  if (isNodeLike(id)) return (asNode(id).name as string) ?? "<anonymous>";
  const parent = node.parent;
  if (isNodeLike(parent)) {
    const key = asNode(parent).key;
    if (isNodeLike(key) && asNode(key).type === "Identifier") return asNode(key).name as string;
  }
  return "<anonymous>";
}

export function createMaxCyclomaticComplexity(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const max = typeof ctx.options.max === "number" ? ctx.options.max : 15;
  const check = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const complexity = complexityOf(node);
    if (complexity <= max) return;
    context.report({
      node: rawNode,
      message: `Function ${nameOf(node)} has cyclomatic complexity ${complexity} (limit ${max}).`,
      hint: "Split the function into smaller, named helpers.",
    });
  };
  return {
    FunctionDeclaration: check,
    FunctionExpression: check,
    ArrowFunctionExpression: check,
  };
}
