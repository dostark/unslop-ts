/**
 * @module FunctionMetrics
 * @path src/metrics/function_metrics.ts
 * @description Function-unit discovery and the cyclomatic measurement over host ESTree nodes.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/metrics/types.ts, src/metrics/context.ts, src/rules/max_cyclomatic_complexity.ts]
 */

import { asNode, type ILintNode, isNodeLike, NODE_IDENTIFIER } from "../engine/type_environment.ts";
import type { IRuleNode } from "../rules/types.ts";
import { cognitiveContributions } from "./cognitive.ts";
import { forEachChildNode, FUNCTION_KINDS, isFunctionUnitNode, rangeOf } from "./estree.ts";
import type {
  IFunctionMetrics,
  IFunctionUnit,
  IMeasurementContext,
  IMetricContribution,
  IMetricOptions,
  IMetricToken,
  MetricContributionKind,
} from "./types.ts";

/** The cyclomatic count of a function with no decision. */
const CYCLOMATIC_BASE = 1;

/** The counted loop node types and their contribution kinds. */
const LOOP_KINDS: Readonly<Record<string, MetricContributionKind>> = {
  ForStatement: "for",
  ForInStatement: "for-in",
  ForOfStatement: "for-of",
  WhileStatement: "while",
  DoWhileStatement: "do-while",
};

/** The assignment operators the extended variant counts as one decision each. */
const LOGICAL_ASSIGNMENT_OPERATORS: ReadonlySet<string> = new Set(["&&=", "||=", "??="]);

/** The accessor kinds whose names carry the get or set prefix. */
const ACCESSOR_PREFIXES: Readonly<Record<string, string>> = { get: "get ", set: "set " };

/** The parents whose function value may or may not include the declared key in its range. */
const KEYED_PARENT_KINDS: ReadonlySet<string> = new Set([
  "Property",
  "ObjectProperty",
  "ClassProperty",
  "ClassPrivateProperty",
  "PropertyDefinition",
  "MethodDefinition",
]);

/** The Babel method nodes that carry their own key and behave as a function unit. */
const SELF_KEYED_KINDS: ReadonlySet<string> = new Set(["ClassMethod", "ObjectMethod", "ClassPrivateMethod"]);

/** The identifier name of a value, or null. */
function identifierName(value: unknown): string | null {
  if (!isNodeLike(value)) return null;
  const node = asNode(value);
  if (node.type !== NODE_IDENTIFIER) return null;
  return typeof node.name === "string" ? node.name : null;
}

/** The declared key name of a property or method, or null. */
function keyName(value: unknown): string | null {
  const declared = identifierName(value);
  if (declared !== null) return declared;
  if (!isNodeLike(value)) return null;
  const node = asNode(value);
  if ((node.type === "StringLiteral" || node.type === "Literal") && typeof node.value === "string") return node.value;
  return null;
}

/** The declared name with its accessor prefix, so a getter and a setter stay distinct. */
function withAccessorPrefix(name: string, kind: unknown): string {
  const prefix = typeof kind === "string" ? ACCESSOR_PREFIXES[kind] : undefined;
  return prefix === undefined ? name : `${prefix}${name}`;
}

/** The name a declaring parent gives its function expression, or null. */
function nameFromParent(parent: ILintNode): string | null {
  switch (parent.type) {
    case "VariableDeclarator":
      return identifierName(parent.id);
    case "Property":
    case "ObjectProperty":
    case "ClassProperty":
    case "ClassPrivateProperty":
    case "PropertyDefinition":
    case "MethodDefinition": {
      const key = keyName(parent.key);
      return key === null ? null : withAccessorPrefix(key, parent.kind);
    }
    case "AssignmentExpression":
      return identifierName(parent.left);
    case "ExportDefaultDeclaration":
      return "default";
    default:
      return null;
  }
}

/** The declared name of a Babel method node, which carries its own key, or null. */
function nameFromSelf(node: ILintNode): string | null {
  if (!SELF_KEYED_KINDS.has(node.type)) return null;
  const key = keyName(node.key);
  return key === null ? null : withAccessorPrefix(key, node.kind);
}

/** The fallback label of an anonymous unit: the containing position after `<anonymous>`. */
function anonymousName(node: ILintNode, context: IMeasurementContext): string {
  const position = context.positionAt(rangeOf(node)[0]);
  return `<anonymous>@${position.line}:${position.column}`;
}

/** The name a direct self-call resolves to: its own id, or the variable it is assigned to. */
function bindingNameOf(node: ILintNode, parent: ILintNode | null): string | null {
  const declared = identifierName(node.id);
  if (declared !== null) return declared;
  if (parent !== null && parent.type === "VariableDeclarator") return identifierName(parent.id);
  return null;
}

/** The display name of a function unit. */
function nameOf(node: ILintNode, parent: ILintNode | null, context: IMeasurementContext): string {
  const declared = identifierName(node.id) ?? nameFromSelf(node);
  if (declared !== null) return declared;
  const inherited = parent === null ? null : nameFromParent(parent);
  return inherited ?? anonymousName(node, context);
}

/** Every executable function unit under the program, with its descendant function ranges. */
export function functionUnits(program: IRuleNode, context: IMeasurementContext): readonly IFunctionUnit[] {
  const units: IFunctionUnit[] = [];
  const open: (readonly [number, number])[][] = [];
  const visit = (node: ILintNode, parent: ILintNode | null): void => {
    if (!isFunctionUnitNode(node)) {
      forEachChildNode(node, (child) => visit(child, node));
      return;
    }
    const range = unitRangeOf(node, parent, context);
    const descendantRanges: (readonly [number, number])[] = [];
    for (const ancestor of open) ancestor.push(range);
    open.push(descendantRanges);
    units.push({
      node,
      name: nameOf(node, parent, context),
      range,
      descendantRanges,
      bindingName: bindingNameOf(node, parent),
    });
    forEachChildNode(node, (child) => visit(child, node));
    open.pop();
  };
  visit(asNode(program), null);
  return units;
}

/** True when the node is the else branch of a parent `if`, which reads as `else-if`. */
function isElseBranch(node: ILintNode, parent: ILintNode | null): boolean {
  return parent !== null && parent.type === "IfStatement" && parent.alternate === node;
}

/** The cyclomatic contribution a logical expression makes under the chosen variant. */
function logicalKind(operator: unknown, options: IMetricOptions): MetricContributionKind | null {
  if (operator === "&&") return "logical-and";
  if (operator === "||") return "logical-or";
  if (operator === "??") return options.variant === "extended" ? "nullish-coalescing" : null;
  return null;
}

/** The cyclomatic contribution a node makes, or null when it makes none. */
function cyclomaticKindOf(
  node: ILintNode,
  parent: ILintNode | null,
  options: IMetricOptions,
): MetricContributionKind | null {
  const loop = LOOP_KINDS[node.type];
  if (loop !== undefined) return loop;
  switch (node.type) {
    case "IfStatement":
      return isElseBranch(node, parent) ? "else-if" : "if";
    case "CatchClause":
      return "catch";
    case "ConditionalExpression":
      return "ternary";
    case "SwitchCase":
      return isNodeLike(node.test) ? "case" : null;
    case "LogicalExpression":
      return logicalKind(node.operator, options);
    case "AssignmentExpression":
      return options.variant === "extended" && LOGICAL_ASSIGNMENT_OPERATORS.has(String(node.operator))
        ? "logical-assignment"
        : null;
    default:
      return null;
  }
}

/** One cyclomatic contribution at an offset, with weight one and nesting zero. */
function contributionAt(
  offset: number,
  kind: MetricContributionKind,
  context: IMeasurementContext,
): IMetricContribution {
  const position = context.positionAt(offset);
  return { metric: "cyclomatic", kind, weight: 1, nesting: 0, line: position.line, column: position.column };
}

/** The first code token that starts at or after an offset, or the offset itself. */
function firstTokenStartAtOrAfter(context: IMeasurementContext, offset: number): number {
  for (const token of context.tokens) {
    if (token.start >= offset) return token.start;
  }
  return offset;
}

/** The key node that precedes a function value, whether on the parent or on the node itself. */
function keyOf(node: ILintNode, parent: ILintNode | null): ILintNode | null {
  if (parent !== null && KEYED_PARENT_KINDS.has(parent.type) && isNodeLike(parent.key)) return asNode(parent.key);
  if (SELF_KEYED_KINDS.has(node.type) && isNodeLike(node.key)) return asNode(node.key);
  return null;
}

/** The unit start with the declared key removed, so every host and parser reports one start. */
function normalizedStart(node: ILintNode, parent: ILintNode | null, context: IMeasurementContext): number {
  const start = rangeOf(node)[0];
  const key = keyOf(node, parent);
  if (key === null) return start;
  const keyEnd = rangeOf(key)[1];
  if (start >= keyEnd) return start;
  return firstTokenStartAtOrAfter(context, keyEnd);
}

/** The unit range: the host range with method keys removed, so every host reports one start. */
function unitRangeOf(
  node: ILintNode,
  parent: ILintNode | null,
  context: IMeasurementContext,
): readonly [number, number] {
  return [normalizedStart(node, parent, context), rangeOf(node)[1]];
}

/** Every counted decision in the function body, with nested function bodies excluded. */
function cyclomaticContributions(
  unit: IFunctionUnit,
  options: IMetricOptions,
  context: IMeasurementContext,
): IMetricContribution[] {
  const fn = asNode(unit.node);
  const body = fn.body;
  if (!isNodeLike(body)) return [];
  const contributions: IMetricContribution[] = [];
  const visit = (node: ILintNode, parent: ILintNode | null): void => {
    if (node !== fn && FUNCTION_KINDS.has(node.type)) return;
    const kind = cyclomaticKindOf(node, parent, options);
    if (kind !== null) contributions.push(contributionAt(rangeOf(node)[0], kind, context));
    forEachChildNode(node, (child) => visit(child, node));
  };
  visit(asNode(body), fn);
  return contributions;
}

/** Every optional link in the unit, counted once per `?.` token outside descendant functions. */
function optionalContributionOffsets(unit: IFunctionUnit, context: IMeasurementContext): number[] {
  const [start, end] = unit.range;
  return context.optionalChainOffsets.filter((offset) => {
    if (offset < start || offset >= end) return false;
    return !unit.descendantRanges.some(([from, to]) => offset >= from && offset < to);
  });
}

/** True when a token lies inside one of the excluded descendant function ranges. */
function isDescendantToken(token: IMetricToken, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => token.start >= start && token.end <= end);
}

/** The code-token line numbers the function owns, excluding every descendant function. */
function ownedLines(unit: IFunctionUnit, context: IMeasurementContext): Set<number> {
  const [start, end] = unit.range;
  const lines = new Set<number>();
  for (const token of context.tokens) {
    if (token.start < start || token.end > end) continue;
    if (isDescendantToken(token, unit.descendantRanges)) continue;
    const first = context.positionAt(token.start).line;
    const last = token.end > token.start ? context.positionAt(token.end - 1).line : first;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  return lines;
}

/** True when the parameter is the TypeScript `this` parameter, which is not a caller argument. */
function isThisParameter(value: unknown): boolean {
  if (!isNodeLike(value)) return false;
  const node = asNode(value);
  return node.type === NODE_IDENTIFIER && node.name === "this";
}

/** The declared parameter count, excluding a `this` parameter. */
function parameterCount(node: ILintNode): number {
  const params = node.params;
  if (!Array.isArray(params)) return 0;
  return params.filter((param) => !isThisParameter(param)).length;
}

/** Measures one function unit: cyclomatic, owned lines, and parameters. */
export function measureFunction(
  unit: IFunctionUnit,
  options: IMetricOptions,
  context: IMeasurementContext,
): IFunctionMetrics {
  const cyclomaticEntries = cyclomaticContributions(unit, options, context);
  if (options.variant === "extended") {
    for (const offset of optionalContributionOffsets(unit, context)) {
      cyclomaticEntries.push(contributionAt(offset, "optional-chain", context));
    }
  }
  const cognitiveEntries = cognitiveContributions(unit, options, context);
  const contributions = [...cyclomaticEntries, ...cognitiveEntries].sort(
    (left, right) => left.line - right.line || left.column - right.column,
  );
  const position = context.positionAt(unit.range[0]);
  const cyclomatic = cyclomaticEntries.reduce((sum, entry) => sum + entry.weight, CYCLOMATIC_BASE);
  const cognitive = cognitiveEntries.reduce((sum, entry) => sum + entry.weight, 0);
  return {
    name: unit.name,
    line: position.line,
    column: position.column,
    range: unit.range,
    cyclomatic,
    cognitive,
    lines: ownedLines(unit, context).size,
    params: parameterCount(asNode(unit.node)),
    contributions,
  };
}
