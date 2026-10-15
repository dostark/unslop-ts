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

const NODE_CALL_EXPRESSION = "CallExpression";
const ASSERT_FUNCTION = "assert";
const ASSERT_STRING_INCLUDES = "assertStringIncludes";
const SUBSTRING_METHODS = ["includes", "startsWith", "endsWith"];

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
  const methods = Array.isArray(rawMethods) ? rawMethods.map(String) : SUBSTRING_METHODS;
  const rawFunctions = ctx.options.assertFunctions;
  const assertFunctions = Array.isArray(rawFunctions)
    ? rawFunctions.map(String)
    : [ASSERT_FUNCTION, "assertEquals", "assertStrictEquals"];

  const check = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const name = calleeName(node.callee);
    if (!name || !assertFunctions.includes(name)) return;
    const args = node.arguments;
    if (!Array.isArray(args) || args.length === 0) return;
    const first = args[0];
    if (!isObject(first)) return;
    const subject = asNode(first);
    if (subject.type !== NODE_CALL_EXPRESSION) return;
    const method = calleeName(subject.callee);
    if (!method || !methods.includes(method)) return;
    if (name === ASSERT_FUNCTION) {
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

/** The first-argument call node of an assertion statement, or null. */
function assertionFirstCallArg(statement: LintValue, prefix: string): LintValue | null {
  if (!isObject(statement)) return null;
  const stmt = asNode(statement);
  if (stmt.type !== "ExpressionStatement") return null;
  const expression = stmt.expression;
  if (!isObject(expression)) return null;
  const call = asNode(expression);
  if (call.type !== NODE_CALL_EXPRESSION) return null;
  const name = calleeName(call.callee);
  if (!name || !name.startsWith(prefix)) return null;
  const args = call.arguments;
  if (!Array.isArray(args) || args.length === 0) return null;
  const first = args[0];
  if (!isObject(first)) return null;
  if (asNode(first).type !== NODE_CALL_EXPRESSION) return null;
  return first;
}

export function createNoRepeatedAssertCall(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const prefix = typeof ctx.options.assertPrefix === "string" ? ctx.options.assertPrefix : ASSERT_FUNCTION;
  const sourceCode = context.sourceCode;
  const normalize = (node: LintValue): string => sourceCode.getText(node as Deno.lint.Node).replace(/\s+/g, "");

  const checkBlock = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const body = node.body;
    if (!Array.isArray(body)) return;
    for (let index = 1; index < body.length; index++) {
      const previous = assertionFirstCallArg(body[index - 1], prefix);
      const current = assertionFirstCallArg(body[index], prefix);
      if (previous === null || current === null) continue;
      if (normalize(previous) !== normalize(current)) continue;
      context.report({
        node: body[index] as Deno.lint.Node,
        message: "Two adjacent assertions repeat the same call as their first argument.",
        hint: "Assert once on the call result, or assert on the value that differs.",
      });
    }
  };

  return { BlockStatement: checkBlock };
}

function isImportedConstant(node: LintValue, imported: Set<string>, pattern: RegExp): boolean {
  if (!isObject(node)) return false;
  const value = asNode(node);
  if (value.type !== NODE_IDENTIFIER) return false;
  const name = value.name as string;
  return imported.has(name) && pattern.test(name);
}

/** The named bindings an import declaration introduces. */
function namedImportBindings(rawNode: Deno.lint.Node): string[] {
  const node = asNode(rawNode);
  const specifiers = node.specifiers;
  if (!Array.isArray(specifiers)) return [];
  const names: string[] = [];
  for (const rawSpecifier of specifiers) {
    if (!isObject(rawSpecifier)) continue;
    const specifier = asNode(rawSpecifier);
    if (specifier.type !== "ImportSpecifier") continue;
    const local = specifier.local;
    if (!isObject(local)) continue;
    const localNode = asNode(local);
    if (localNode.type === NODE_IDENTIFIER) names.push(localNode.name as string);
  }
  return names;
}

/** The subject identifier of a substring assertion call, or null. */
function substringAssertSubject(node: LintValue): LintValue | null {
  if (!isObject(node)) return null;
  const call = asNode(node);
  if (call.type !== NODE_CALL_EXPRESSION) return null;
  const name = calleeName(call.callee);
  if (!name) return null;
  const args = call.arguments;
  if (!Array.isArray(args) || args.length === 0) return null;
  if (name === ASSERT_STRING_INCLUDES) return args[0];
  if (name !== ASSERT_FUNCTION) return null;
  const subject = args[0];
  if (!isObject(subject)) return null;
  const subjectCall = asNode(subject);
  if (subjectCall.type !== NODE_CALL_EXPRESSION) return null;
  const method = calleeName(subjectCall.callee);
  if (!method || !SUBSTRING_METHODS.includes(method)) return null;
  const callee = subjectCall.callee;
  return isObject(callee) ? asNode(callee).object : null;
}

export function createNoConstantSubstringAssert(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const patternSource = typeof ctx.options.constantPattern === "string"
    ? ctx.options.constantPattern
    : "^[A-Z][A-Z0-9_]*$";
  const pattern = new RegExp(patternSource);
  const imported = new Set<string>();

  const collectImports = (rawNode: Deno.lint.Node): void => {
    for (const name of namedImportBindings(rawNode)) imported.add(name);
  };

  const check = (rawNode: Deno.lint.Node): void => {
    if (!isImportedConstant(substringAssertSubject(rawNode), imported, pattern)) return;
    context.report({
      node: rawNode,
      message: "This substring assertion restates an imported constant as a literal.",
      hint: "Assert on the constant's value, or on the behavior that consumes it.",
    });
  };

  return { ImportDeclaration: collectImports, CallExpression: check };
}
