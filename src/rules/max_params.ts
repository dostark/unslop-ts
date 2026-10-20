/**
 * @module MaxParams
 * @path src/rules/max_params.ts
 * @description Reports a function, method, or constructor that takes more parameters than the limit.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/engine/type_environment.ts]
 */

import { asNode } from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

const DEFAULT_MAX_PARAMS = 7;
const THIS_PARAMETER = "this";

function countedParameters(node: Deno.lint.Node): number {
  const params = asNode(node).params;
  if (!Array.isArray(params)) return 0;
  return params.filter((param) => {
    const entry = asNode(param);
    return !(entry.type === "Identifier" && entry.name === THIS_PARAMETER);
  }).length;
}

export function createMaxParams(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const max = typeof ctx.options.max === "number" ? ctx.options.max : DEFAULT_MAX_PARAMS;
  const check = (node: Deno.lint.Node): void => {
    const found = countedParameters(node);
    if (found <= max) return;
    context.report({
      node,
      message:
        `Methods and functions must not exceed ${max} parameters (found ${found}). Refactor to use a parameter object.`,
      hint: `See ${ctx.codeStyle ?? "the complexity rules"}.`,
    });
  };
  return {
    FunctionDeclaration: check,
    FunctionExpression: check,
    ArrowFunctionExpression: check,
    TSDeclareFunction: check,
    TSEmptyBodyFunctionExpression: check,
  };
}
