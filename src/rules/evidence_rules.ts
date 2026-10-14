/**
 * @module EvidenceRules
 * @path packages/lint-rules/src/rules/evidence_rules.ts
 * @description Ratcheted evidence rules: justified assertions, no ad-hoc typeof, no empty spreads.
 *   Rule ideas from deslop / anti-slop (MIT).
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts, packages/lint-rules/src/rules/type_safety_rules.ts]
 */

import { asNode, type ILintNode, type LintValue, toLintNode, unwrap } from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

function parentOf(node: ILintNode): ILintNode | undefined {
  const parent = node.parent;
  return parent && typeof parent === "object" ? asNode(parent) : undefined;
}

function isObject(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

/** The top-level statement that contains the node. */
function statementOf(node: ILintNode): ILintNode {
  let current = node;
  for (;;) {
    const parent = parentOf(current);
    if (!parent) return current;
    if (parent.type === "Program" || parent.type === "BlockStatement") return current;
    current = parent;
  }
}

function previousSibling(statement: ILintNode): ILintNode | null {
  const body = parentOf(statement)?.body;
  if (!Array.isArray(body)) return null;
  const index = body.indexOf(statement);
  return index > 0 ? asNode(body[index - 1]) : null;
}

function rangeEnd(node: ILintNode | null): number {
  return node?.range ? node.range[1] : -1;
}

interface IComment {
  readonly value: string;
  readonly range?: readonly [number, number];
}

/** True when a marker comment with non-empty text precedes `node` after `boundary`. */
function hasMarker(
  sourceCode: Deno.lint.SourceCode,
  node: LintValue,
  markers: readonly string[],
  boundary: number,
): boolean {
  const comments = sourceCode.getCommentsBefore(toLintNode(node)) as IComment[];
  for (const comment of comments) {
    if (comment.range && comment.range[0] < boundary) continue;
    const text = comment.value.trim();
    for (const marker of markers) {
      const prefix = `${marker}:`;
      if (text.startsWith(prefix) && text.slice(prefix.length).trim().length > 0) return true;
    }
  }
  return false;
}

export function createRequireSafetyComment(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const raw = ctx.options.markers;
  const markers = Array.isArray(raw) ? raw.map(String) : ["SAFETY"];
  const sourceCode = context.sourceCode;
  const check = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const annotation = node.typeAnnotation;
    if (isObject(annotation)) {
      const resolved = unwrap(asNode(annotation));
      if (resolved.type === "TSTypeReference" && asNode(resolved.typeName).name === "const") return;
    }
    const statement = statementOf(node);
    const boundary = rangeEnd(previousSibling(statement));
    if (hasMarker(sourceCode, node, markers, boundary)) return;
    if (hasMarker(sourceCode, statement, markers, boundary)) return;
    context.report({
      node: rawNode,
      message: "A type assertion needs a marker comment that states its invariant.",
      hint: "Add a `// SAFETY: <reason>` comment before the assertion or its statement.",
    });
  };
  return { TSAsExpression: check, TSTypeAssertion: check };
}

/** True when the node sits inside a function whose return type is a type predicate. */
function insideTypeGuard(node: ILintNode): boolean {
  let current = parentOf(node);
  while (current) {
    if (
      current.type === "FunctionDeclaration" || current.type === "FunctionExpression" ||
      current.type === "ArrowFunctionExpression"
    ) {
      const returnType = current.returnType;
      if (isObject(returnType)) {
        const annotation = asNode(returnType).typeAnnotation;
        if (isObject(annotation) && asNode(annotation).type === "TSTypePredicate") return true;
      }
      return false;
    }
    current = parentOf(current);
  }
  return false;
}

interface ITypeofComparison {
  readonly value: string;
}

/** The compared string value when `node` is a `typeof` comparison, or null. */
function matchTypeofComparison(node: ILintNode): ITypeofComparison | null {
  const operator = node.operator;
  if (operator !== "===" && operator !== "!==" && operator !== "==" && operator !== "!=") return null;
  if (!isObject(node.left) || !isObject(node.right)) return null;
  const left = asNode(node.left);
  const right = asNode(node.right);
  const typeofSide = left.type === "UnaryExpression" && left.operator === "typeof"
    ? left
    : right.type === "UnaryExpression" && right.operator === "typeof"
    ? right
    : null;
  if (!typeofSide) return null;
  const other = typeofSide === left ? right : left;
  if (other.type !== "Literal" || typeof other.value !== "string") return null;
  return { value: other.value };
}

export function createNoRuntimeTypeof(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const allowInTypeGuards = ctx.options.allowInTypeGuards !== false;
  const check = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const comparison = matchTypeofComparison(node);
    if (!comparison) return;
    if (comparison.value === "undefined") return;
    if (allowInTypeGuards && insideTypeGuard(node)) return;
    context.report({
      node: rawNode,
      message: "A runtime `typeof` comparison narrows a value by shape. Parse or narrow it with a type guard instead.",
      hint: "Prefer a typed boundary or a type-predicate function.",
    });
  };
  return { BinaryExpression: check };
}

export function createNoConditionalEmptyObjectSpread(
  context: Deno.lint.RuleContext,
  _ctx: IPluginRuleContext,
): LintVisitor {
  const check = (rawNode: Deno.lint.Node): void => {
    const node = asNode(rawNode);
    const argument = node.argument;
    if (!isObject(argument)) return;
    const conditional = asNode(argument);
    if (conditional.type !== "ConditionalExpression") return;
    if (isEmptyObject(conditional.consequent) || isEmptyObject(conditional.alternate)) {
      context.report({
        node: rawNode,
        message: "A conditional spread with an empty object branch hides a missing field. Build the object explicitly.",
        hint: "Assign the field conditionally instead of spreading an empty object.",
      });
    }
  };
  return { SpreadElement: check };
}

function isEmptyObject(node: LintValue): boolean {
  if (!isObject(node)) return false;
  const value = asNode(node);
  if (value.type !== "ObjectExpression") return false;
  const properties = value.properties;
  return Array.isArray(properties) && properties.length === 0;
}
