/**
 * @module TypeSafetyRules
 * @path packages/lint-rules/src/rules/type_safety_rules.ts
 * @description AST-matched type-safety plugin rules. Rule ideas from deslop / anti-slop (MIT).
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/type_environment.ts, packages/lint-rules/src/rules/mod.ts]
 */

import {
  asNode,
  createTypeEnvironment,
  type ILintNode,
  innerType,
  programOf,
  typeArguments,
  typeReferenceName,
  unwrap,
} from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

type Report = (node: Deno.lint.Node, message: string) => void;

function makeReporter(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): Report {
  const codeStyle = ctx.codeStyle ?? "CODE_STYLE.md#strict-type-safety";
  return (node, message) => {
    context.report({ node, message, hint: `Keep type evidence. See ${codeStyle}.` });
  };
}

function envFor(context: Deno.lint.RuleContext): ReturnType<typeof createTypeEnvironment> {
  return createTypeEnvironment(programOf(context.sourceCode));
}

function parentOf(node: ILintNode): ILintNode | undefined {
  const parent = node.parent;
  return parent && typeof parent === "object" ? asNode(parent) : undefined;
}

/** True when the unknown node annotates a catch binding. */
function isCatchBinding(node: ILintNode): boolean {
  let current = parentOf(node);
  if (current?.type === "TSTypeAnnotation") current = parentOf(current);
  if (current?.type !== "Identifier") return false;
  const clause = parentOf(current);
  return clause?.type === "CatchClause" && clause.param === current;
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "TSMethodSignature",
  "TSDeclareFunction",
]);

/** True when the unknown node annotates the subject of a type-predicate return. */
function isPredicateSubject(node: ILintNode): boolean {
  let current = parentOf(node);
  if (current?.type === "TSTypeAnnotation") current = parentOf(current);
  if (current?.type !== "Identifier") return false;
  const fn = parentOf(current);
  if (!fn || !FUNCTION_TYPES.has(fn.type)) return false;
  const returnType = fn.returnType;
  if (!returnType || typeof returnType !== "object") return false;
  const annotation = asNode(returnType).typeAnnotation;
  return annotation !== undefined && asNode(annotation).type === "TSTypePredicate";
}

/** True when the unknown node sits inside a generic parameter constraint or default. */
function isInsideTypeParameter(node: ILintNode): boolean {
  let current = parentOf(node);
  while (current) {
    if (current.type === "TSTypeParameter") return true;
    current = parentOf(current);
  }
  return false;
}

/** True when `node` is the constraint of a generic type parameter, as upstream allows. */
function isTypeParameterConstraint(node: ILintNode): boolean {
  let current = node;
  let parent = parentOf(current);
  while (parent) {
    if (parent.type === "TSTypeParameter") return parent.constraint === current;
    current = parent;
    parent = parentOf(current);
  }
  return false;
}

export function createNoExplicitUnknown(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const allowCatch = ctx.options.allowCatchBinding !== false;
  const allowPredicate = ctx.options.allowTypePredicateSubject !== false;
  const report = makeReporter(context, ctx);
  return {
    TSUnknownKeyword(rawNode: Deno.lint.Node) {
      const node = asNode(rawNode);
      if (allowCatch && isCatchBinding(node)) return;
      if (allowPredicate && isPredicateSubject(node)) return;
      if (isInsideTypeParameter(node)) return;
      report(rawNode, "Explicit 'unknown' discards type evidence. Name the shape with an interface or type alias.");
    },
  };
}

function isForbiddenValue(
  node: ILintNode,
  forbidden: readonly string[],
  env: ReturnType<typeof createTypeEnvironment>,
): boolean {
  for (const member of env.unionMembers(node)) {
    if (member.type === "TSUnknownKeyword" && forbidden.includes("unknown")) return true;
    if (member.type === "TSAnyKeyword" && forbidden.includes("any")) return true;
    if (member.type === "TSObjectKeyword" && forbidden.includes("object")) return true;
    if (member.type === "TSTypeLiteral" && forbidden.includes("{}")) {
      const members = member.members;
      if (!Array.isArray(members) || members.length === 0) return true;
    }
  }
  return false;
}

const DICTIONARY_MESSAGE =
  "A dictionary with a weak value type loses type evidence. Name a specific value interface instead.";

export function createNoUnsafeDictionary(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const raw = ctx.options.forbiddenValueTypes;
  const forbidden = Array.isArray(raw) ? raw.map(String) : ["unknown", "any", "object", "{}"];
  const report = makeReporter(context, ctx);
  const env = envFor(context);
  return {
    TSTypeReference(rawNode: Deno.lint.Node) {
      const node = asNode(rawNode);
      const name = typeReferenceName(node);
      if (name !== "Record" && name !== "Map") return;
      if (isTypeParameterConstraint(node)) return;
      const value = typeArguments(node)[1];
      if (value && isForbiddenValue(value, forbidden, env)) report(rawNode, DICTIONARY_MESSAGE);
    },
    TSIndexSignature(rawNode: Deno.lint.Node) {
      const node = asNode(rawNode);
      const annotation = node.typeAnnotation;
      if (annotation && typeof annotation === "object" && isForbiddenValue(asNode(annotation), forbidden, env)) {
        report(rawNode, DICTIONARY_MESSAGE);
      }
    },
  };
}
/** The source text a `TSTypeQuery` names, for the allowed-target check. */
function queryText(node: ILintNode, text: string): string {
  const range = node.range;
  return range ? text.slice(range[0], range[1]) : "";
}

export function createNoAnyEscape(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const raw = ctx.options.allowedTypeofTargets;
  const allowed = new Set(Array.isArray(raw) ? raw.map(String) : ["globalThis.fetch"]);
  const allowAnyInTests = ctx.options.allowAnyInTests !== false;
  const report = makeReporter(context, ctx);
  const message =
    "An 'any' or 'as typeof' escape discards type evidence. Keep the precise type or parse at the boundary.";
  const text = context.sourceCode.text;
  const checkType = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const annotation = node.typeAnnotation;
    if (!annotation || typeof annotation !== "object") return;
    const type = unwrap(asNode(annotation));
    if (type.type === "TSAnyKeyword") {
      if (!(ctx.isTestFile && allowAnyInTests)) report(rawNode, message);
      return;
    }
    if (type.type === "TSTypeQuery" && !(ctx.isTestFile && allowed.has(queryText(type, text)))) {
      report(rawNode, message);
    }
  };
  const checkArray = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const element = node.elementType;
    if (element && typeof element === "object" && unwrap(asNode(element)).type === "TSAnyKeyword") {
      report(rawNode, message);
    }
  };
  return {
    TSAsExpression: checkType,
    TSTypeAssertion: checkType,
    TSArrayType: checkArray,
  };
}

export function createNoPassThroughTypeAlias(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const report = makeReporter(context, ctx);
  const aliases = envFor(context).aliases;
  const message = "A pass-through type alias adds indirection without evidence. Use the target type directly.";
  return {
    TSTypeAliasDeclaration(rawNode: Deno.lint.Node) {
      const node = asNode(rawNode);
      const annotation = node.typeAnnotation;
      if (!annotation || typeof annotation !== "object") return;
      const name = typeReferenceName(unwrap(asNode(annotation)));
      if (name && aliases.has(name)) report(rawNode, message);
    },
  };
}

const OBJECT_MESSAGE = "An 'object' parameter names no shape. Declare the expected members instead.";

export function createNoObjectParameters(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const report = makeReporter(context, ctx);
  const checkFunction = (rawNode: Deno.lint.Node): void => {
    const fn = asNode(rawNode);
    const params = fn.params;
    if (!Array.isArray(params)) return;
    for (const param of params) {
      if (!param || typeof param !== "object") continue;
      const node = asNode(param);
      const annotation = node.typeAnnotation;
      if (!annotation || typeof annotation !== "object") continue;
      if (unwrap(innerType(asNode(annotation))).type === "TSObjectKeyword") report(rawNode, OBJECT_MESSAGE);
    }
  };
  return {
    FunctionDeclaration: checkFunction,
    FunctionExpression: checkFunction,
    ArrowFunctionExpression: checkFunction,
    TSMethodSignature: checkFunction,
    TSDeclareFunction: checkFunction,
  };
}
