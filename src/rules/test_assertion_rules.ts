/**
 * @module TestAssertionRules
 * @path packages/lint-rules/src/rules/test_assertion_rules.ts
 * @description Test-assertion quality rules. Rule ideas from deslop / anti-slop (MIT).
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts]
 */

import { asNode, type LintValue, NODE_IDENTIFIER } from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

function isObject(value: LintValue): boolean {
  return value !== null && typeof value === "object";
}

/** The called name for an `Identifier` or `obj.method` callee, or null. */
function calleeName(node: LintValue): string | null {
  if (!isObject(node)) return null;
  const callee = asNode(node);
  if (callee.type === NODE_IDENTIFIER) return callee.name as string;
  if (callee.type === "MemberExpression") {
    const property = callee.property;
    if (isObject(property) && asNode(property).type === NODE_IDENTIFIER) return asNode(property).name as string;
  }
  return null;
}

function isBooleanLiteral(node: LintValue): boolean {
  if (!isObject(node)) return false;
  const value = asNode(node);
  return value.type === "Literal" && typeof value.value === "boolean";
}

export function createNoBooleanAssert(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const rawMethods = ctx.options.methods;
  const methods = Array.isArray(rawMethods) ? rawMethods.map(String) : ["includes", "startsWith", "endsWith"];
  const rawFunctions = ctx.options.assertFunctions;
  const assertFunctions = Array.isArray(rawFunctions)
    ? rawFunctions.map(String)
    : ["assert", "assertEquals", "assertStrictEquals"];

  const check = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const name = calleeName(node.callee);
    if (!name || !assertFunctions.includes(name)) return;
    const args = node.arguments;
    if (!Array.isArray(args) || args.length === 0) return;
    const first = args[0];
    if (!isObject(first)) return;
    const subject = asNode(first);
    if (subject.type !== "CallExpression") return;
    const method = calleeName(subject.callee);
    if (!method || !methods.includes(method)) return;
    if (name === "assert") {
      report(rawNode, name, method);
      return;
    }
    if (args.length >= 2 && isBooleanLiteral(args[1])) report(rawNode, name, method);
  };

  const report = (rawNode: Deno.lint.Node, name: string, method: string): void => {
    context.report({
      node: rawNode,
      message: `A boolean-wrapped \`.${method}()\` assertion hides the failing value.`,
      hint:
        `Replace \`${name}(x.${method}(y), true)\` with a dedicated assertion such as \`assertStringIncludes(x, y)\` or \`assertArrayIncludes(x, [y])\`.`,
    });
  };

  return { CallExpression: check };
}
