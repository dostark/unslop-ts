/**
 * @module CognitiveMetrics
 * @path src/metrics/cognitive.ts
 * @description Campbell cognitive complexity over host ESTree nodes, measured per function unit.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/metrics/estree.ts, src/metrics/function_metrics.ts, src/metrics/types.ts]
 */

import { asNode, type ILintNode, isNodeLike, NODE_IDENTIFIER } from "../engine/type_environment.ts";
import { forEachChildNode, FUNCTION_KINDS, functionBody, rangeOf } from "./estree.ts";
import type {
  IFunctionUnit,
  IMeasurementContext,
  IMetricContribution,
  IMetricOptions,
  MetricContributionKind,
} from "./types.ts";

/** The counted loop node types and their contribution kinds. */
const LOOP_KINDS: Readonly<Record<string, MetricContributionKind>> = {
  ForStatement: "for",
  ForInStatement: "for-in",
  ForOfStatement: "for-of",
  WhileStatement: "while",
  DoWhileStatement: "do-while",
};

/** The logical operators and their contribution kinds. */
const LOGICAL_KINDS: Readonly<Record<string, MetricContributionKind>> = {
  "&&": "logical-and",
  "||": "logical-or",
  "??": "nullish-coalescing",
};

/** The nullish operator, whose runs the countNullish option controls. */
const NULLISH_OPERATOR = "??";

/** The jump statements that carry an optional label. */
const JUMP_KINDS: ReadonlySet<string> = new Set(["BreakStatement", "ContinueStatement"]);

/** The call node types of a direct identifier call, for ESTree and Babel trees. */
const DIRECT_CALL_KINDS: ReadonlySet<string> = new Set(["CallExpression", "OptionalCallExpression"]);

/** One logical operator of a flattened chain, at the start of its sub-expression. */
interface ILogicalOperator {
  readonly operator: string;
  readonly start: number;
}

/** One cognitive contribution at an offset, with its weight and applied nesting. */
function cognitiveContribution(
  offset: number,
  kind: MetricContributionKind,
  weight: number,
  nesting: number,
  context: IMeasurementContext,
): IMetricContribution {
  const position = context.positionAt(offset);
  return { metric: "cognitive", kind, weight, nesting, line: position.line, column: position.column };
}

/** A list value read as an array, or an empty array. */
function valuesOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Adds every binding name of a parameter or declaration pattern. */
function bindingNames(value: unknown, into: Set<string>): void {
  if (!isNodeLike(value)) return;
  const node = asNode(value);
  switch (node.type) {
    case NODE_IDENTIFIER:
      if (typeof node.name === "string") into.add(node.name);
      return;
    case "ObjectPattern":
      for (const property of valuesOf(node.properties)) {
        if (isNodeLike(property)) bindingNames(asNode(property).value ?? asNode(property).argument, into);
      }
      return;
    case "ArrayPattern":
      for (const element of valuesOf(node.elements)) bindingNames(element, into);
      return;
    case "AssignmentPattern":
      bindingNames(node.left, into);
      return;
    case "RestElement":
      bindingNames(node.argument, into);
      return;
    case "TSParameterProperty":
      bindingNames(node.parameter, into);
      return;
    default:
      return;
  }
}

/** Every name the unit binds itself, so a same-name call reads as shadowed and uncertain. */
function declaredNames(fn: ILintNode): Set<string> {
  const names = new Set<string>();
  for (const param of valuesOf(fn.params)) bindingNames(param, names);
  const visit = (node: ILintNode): void => {
    if (node.type === "VariableDeclarator") bindingNames(node.id, names);
    if (node.type === "CatchClause") bindingNames(node.param, names);
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") bindingNames(node.id, names);
    if (node !== fn && FUNCTION_KINDS.has(node.type)) return;
    forEachChildNode(node, visit);
  };
  const body = fn.body;
  if (isNodeLike(body)) visit(asNode(body));
  return names;
}

/** The first direct identifier self-call in the unit, or null when the unit does not recurse. */
function selfCallOf(fn: ILintNode, name: string): ILintNode | null {
  let found: ILintNode | null = null;
  const visit = (node: ILintNode): void => {
    if (found !== null) return;
    if (node !== fn && FUNCTION_KINDS.has(node.type)) return;
    if (DIRECT_CALL_KINDS.has(node.type) && identifierNameOf(node.callee) === name) {
      found = node;
      return;
    }
    forEachChildNode(node, visit);
  };
  const body = fn.body;
  if (isNodeLike(body)) visit(asNode(body));
  return found;
}

/** The identifier name of a value, or null. */
function identifierNameOf(value: unknown): string | null {
  if (!isNodeLike(value)) return null;
  const node = asNode(value);
  return node.type === NODE_IDENTIFIER && typeof node.name === "string" ? node.name : null;
}

/** Flattens one maximal logical expression into its operators, in infix order. */
function flattenLogical(node: ILintNode, operators: ILogicalOperator[], operands: ILintNode[]): void {
  if (node.type !== "LogicalExpression") {
    operands.push(node);
    return;
  }
  if (isNodeLike(node.left)) flattenLogical(asNode(node.left), operators, operands);
  operators.push({ operator: String(node.operator), start: rangeOf(node)[0] });
  if (isNodeLike(node.right)) flattenLogical(asNode(node.right), operators, operands);
}

/** Emits one contribution per contiguous operator run, honoring the nullish option. */
function emitLogicalRuns(
  operators: readonly ILogicalOperator[],
  options: IMetricOptions,
  context: IMeasurementContext,
  contributions: IMetricContribution[],
): void {
  let index = 0;
  while (index < operators.length) {
    const operator = operators[index].operator;
    const start = operators[index].start;
    let last = index;
    while (last + 1 < operators.length && operators[last + 1].operator === operator) last++;
    const kind = LOGICAL_KINDS[operator];
    const counted = kind !== undefined && !(operator === NULLISH_OPERATOR && !options.countNullish);
    if (counted) contributions.push(cognitiveContribution(start, kind, 1, 0, context));
    index = last + 1;
  }
}

/** Every cognitive contribution of one function unit, independent of its caller. */
export function cognitiveContributions(
  unit: IFunctionUnit,
  options: IMetricOptions,
  context: IMeasurementContext,
): IMetricContribution[] {
  const body = functionBody(asNode(unit.node));
  if (body === null) return [];
  const contributions: IMetricContribution[] = [];
  const fn = asNode(unit.node);
  const structural = (node: ILintNode, kind: MetricContributionKind, nesting: number): void => {
    contributions.push(cognitiveContribution(rangeOf(node)[0], kind, 1 + nesting, nesting, context));
  };
  const flat = (node: ILintNode, kind: MetricContributionKind): void => {
    contributions.push(cognitiveContribution(rangeOf(node)[0], kind, 1, 0, context));
  };

  const visitOptional = (value: unknown, depth: number): void => {
    if (isNodeLike(value)) visit(asNode(value), depth);
  };

  const visitIf = (node: ILintNode, depth: number, elseIf: boolean): void => {
    if (elseIf) flat(node, "else-if");
    else structural(node, "if", depth);
    const bodyDepth = elseIf ? depth : depth + 1;
    visitOptional(node.test, depth);
    visitOptional(node.consequent, bodyDepth);
    const alternate = node.alternate;
    if (!isNodeLike(alternate)) return;
    const alt = asNode(alternate);
    if (alt.type === "IfStatement") {
      visitIf(alt, bodyDepth, true);
      return;
    }
    flat(alt, "else");
    visit(alt, bodyDepth);
  };

  const visitLogical = (node: ILintNode, depth: number): void => {
    const operators: ILogicalOperator[] = [];
    const operands: ILintNode[] = [];
    flattenLogical(node, operators, operands);
    emitLogicalRuns(operators, options, context, contributions);
    for (const operand of operands) visit(operand, depth);
  };

  const visitSwitch = (node: ILintNode, depth: number): void => {
    structural(node, "switch", depth);
    visitOptional(node.discriminant, depth);
    for (const value of valuesOf(node.cases)) {
      if (!isNodeLike(value)) continue;
      const clause = asNode(value);
      visitOptional(clause.test, depth);
      for (const statement of valuesOf(clause.consequent)) visitOptional(statement, depth + 1);
    }
  };

  const visit = (node: ILintNode, depth: number): void => {
    if (node !== fn && FUNCTION_KINDS.has(node.type)) return;
    const loop = LOOP_KINDS[node.type];
    if (loop !== undefined) {
      structural(node, loop, depth);
      forEachChildNode(node, (child) => visit(child, child === node.body ? depth + 1 : depth));
      return;
    }
    switch (node.type) {
      case "IfStatement":
        visitIf(node, depth, false);
        return;
      case "SwitchStatement":
        visitSwitch(node, depth);
        return;
      case "CatchClause":
        structural(node, "catch", depth);
        visitOptional(node.param, depth);
        visitOptional(node.body, depth + 1);
        return;
      case "ConditionalExpression":
        structural(node, "ternary", depth);
        visitOptional(node.test, depth);
        visitOptional(node.consequent, depth + 1);
        visitOptional(node.alternate, depth + 1);
        return;
      case "LogicalExpression":
        visitLogical(node, depth);
        return;
      default:
        if (JUMP_KINDS.has(node.type) && isNodeLike(node.label)) {
          flat(node, "labeled-jump");
          return;
        }
        forEachChildNode(node, (child) => visit(child, depth));
    }
  };

  visit(asNode(body), 0);
  const name = unit.bindingName;
  if (name !== null && !declaredNames(fn).has(name)) {
    const call = selfCallOf(fn, name);
    if (call !== null) flat(call, "recursion");
  }
  return contributions;
}
