/**
 * @module ClassMetrics
 * @path src/metrics/class_metrics.ts
 * @description Class-unit metrics over host or Babel class nodes: NOM, NOA, WMC, LOC, TCC and LCOM4.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/metrics/function_metrics.ts, src/metrics/types.ts, src/rules/max_class_size.ts]
 */

import { asNode, type ILintNode, isNodeLike, stringLiteralValue } from "../engine/type_environment.ts";
import type { IRuleNode } from "../rules/types.ts";
import { measureCoupling } from "./class_coupling.ts";
import { forEachChildNode, rangeOf } from "./estree.ts";
import { codeTokenLines, functionUnits, measureFunction } from "./function_metrics.ts";
import type { IClassMetrics, IMeasurementContext, IMetricOptions } from "./types.ts";

const METHOD_KINDS: ReadonlySet<string> = new Set([
  "MethodDefinition",
  "TSAbstractMethodDefinition",
  "ClassMethod",
  "ClassPrivateMethod",
]);
const PROPERTY_KINDS: ReadonlySet<string> = new Set([
  "PropertyDefinition",
  "TSAbstractPropertyDefinition",
  "AccessorProperty",
  "ClassProperty",
  "ClassPrivateProperty",
  "ClassAccessorProperty",
]);
const CLASS_KINDS: ReadonlySet<string> = new Set(["ClassDeclaration", "ClassExpression"]);
const PRIVATE_NAME_KINDS: ReadonlySet<string> = new Set(["PrivateIdentifier", "PrivateName"]);
const MEMBER_ACCESS_KINDS: ReadonlySet<string> = new Set(["MemberExpression", "OptionalMemberExpression"]);
const REBOUND_THIS_KINDS: ReadonlySet<string> = new Set(["FunctionDeclaration", "FunctionExpression", "ObjectMethod"]);
const CONSTRUCTOR_KIND = "constructor";
const ACCESSOR_KINDS: ReadonlySet<string> = new Set(["get", "set"]);
const HIDDEN_ACCESSIBILITY: ReadonlySet<string> = new Set(["private", "protected"]);
const PARAMETER_PROPERTY = "TSParameterProperty";
const PRIVATE_ACCESSIBILITY = "private";
const PRIVATE_PREFIX = "#";
const ANONYMOUS_CLASS = "(anonymous)";
const parameterVisibility = new WeakMap<IMeasurementContext, ReadonlyMap<number, boolean>>();

/** One method or accessor of the class with the members it reaches through `this`. */
interface IClassMethod {
  readonly name: string | null;
  readonly isVisible: boolean;
  readonly attributes: ReadonlySet<string>;
  readonly calls: ReadonlySet<string>;
}

/** The name a key declares, with a prefix for a private name, or null for a computed key. */
function keyName(key: ILintNode["key"], computed: ILintNode["computed"]): string | null {
  if (computed === true || !isNodeLike(key)) return null;
  const node = asNode(key);
  if (typeof node.name === "string") {
    return PRIVATE_NAME_KINDS.has(node.type) ? `${PRIVATE_PREFIX}${node.name}` : node.name;
  }
  if (node.type === "PrivateName" && isNodeLike(node.id)) {
    const name = asNode(node.id).name;
    if (typeof name === "string") return `${PRIVATE_PREFIX}${name}`;
  }
  return stringLiteralValue(key);
}

/** The members of the class body. */
function membersOf(classNode: ILintNode): readonly ILintNode[] {
  const body = classNode.body;
  if (!isNodeLike(body)) return [];
  const members = asNode(body).body;
  return Array.isArray(members) ? members.filter(isNodeLike).map(asNode) : [];
}

function isConstructor(member: ILintNode): boolean {
  return METHOD_KINDS.has(member.type) && member.kind === CONSTRUCTOR_KIND;
}

/** The function node of a method: the value of an ESTree definition, or the Babel method itself. */
function functionOf(member: ILintNode): ILintNode {
  return isNodeLike(member.value) ? asNode(member.value) : member;
}

/** The attribute names that the constructor parameters declare. */
function parameterPropertyNames(constructorMember: ILintNode): string[] {
  const params = functionOf(constructorMember).params;
  if (!Array.isArray(params)) return [];
  const names: string[] = [];
  for (const param of params) {
    if (!isNodeLike(param) || asNode(param).type !== PARAMETER_PROPERTY) continue;
    const target = parameterTarget(asNode(param));
    if (target && typeof target.name === "string") names.push(target.name);
  }
  return names;
}

/** The identifier of a parameter property, including one with a default value. */
function parameterTarget(param: ILintNode): ILintNode | null {
  const parameter = param.parameter;
  const target = isNodeLike(parameter) && asNode(parameter).type === "AssignmentPattern"
    ? asNode(parameter).left
    : parameter;
  return isNodeLike(target) ? asNode(target) : null;
}

/** Babel preserves parameter accessibility that the host AST omits. Index the existing tree once per file. */
function publicParameters(context: IMeasurementContext): ReadonlyMap<number, boolean> {
  const known = parameterVisibility.get(context);
  if (known) return known;
  const visibility = new Map<number, boolean>();
  const visit = (node: ILintNode): void => {
    if (node.type === PARAMETER_PROPERTY) {
      const target = parameterTarget(node);
      if (target) visibility.set(rangeOf(target)[0], isPublicMember(node));
    }
    forEachChildNode(node, visit);
  };
  visit(asNode(context.syntaxTree.program));
  parameterVisibility.set(context, visibility);
  return visibility;
}

function publicParameterCount(member: ILintNode, context: IMeasurementContext): number {
  const params = functionOf(member).params;
  if (!Array.isArray(params)) return 0;
  let count = 0;
  for (const param of params) {
    if (!isNodeLike(param) || asNode(param).type !== PARAMETER_PROPERTY) continue;
    const target = parameterTarget(asNode(param));
    if (target && publicParameters(context).get(rangeOf(target)[0]) === true) count++;
  }
  return count;
}

/** The names of the declared attributes: properties and constructor parameter properties. */
function attributeNames(members: readonly ILintNode[]): Set<string> {
  const names = new Set<string>();
  for (const member of members) {
    if (PROPERTY_KINDS.has(member.type)) {
      const name = keyName(member.key, member.computed);
      if (name !== null) names.add(name);
    } else if (isConstructor(member)) {
      for (const name of parameterPropertyNames(member)) names.add(name);
    }
  }
  return names;
}

/** The public surface of a class: its functional methods, accessor methods and attributes. */
interface IPublicSurface {
  readonly woc: number | null;
  readonly noap: number;
  readonly noam: number;
}

/** True for a member that is not private, protected or a `#` name. */
function isPublicMember(member: ILintNode): boolean {
  if (typeof member.accessibility === "string" && HIDDEN_ACCESSIBILITY.has(member.accessibility)) return false;
  return !(isNodeLike(member.key) && PRIVATE_NAME_KINDS.has(asNode(member.key).type));
}

/** Weight of class and public attribute and accessor counts, including public constructor parameter properties. */
function publicSurface(members: readonly ILintNode[], context: IMeasurementContext): IPublicSurface {
  let functional = 0;
  let accessors = 0;
  let attributes = 0;
  for (const member of members) {
    if (isConstructor(member)) {
      attributes += publicParameterCount(member, context);
      continue;
    }
    if (METHOD_KINDS.has(member.type) && isPublicMember(member)) {
      if (typeof member.kind === "string" && ACCESSOR_KINDS.has(member.kind)) accessors++;
      else functional++;
    } else if (PROPERTY_KINDS.has(member.type) && isPublicMember(member)) attributes++;
  }
  const total = functional + accessors + attributes;
  return { woc: total === 0 ? null : functional / total, noap: attributes, noam: accessors };
}

/** The member name that `this.name` reads, or null when the node is not such a read. */
function thisMemberName(node: ILintNode): string | null {
  if (!MEMBER_ACCESS_KINDS.has(node.type) || !isNodeLike(node.object)) return null;
  if (asNode(node.object).type !== "ThisExpression") return null;
  return keyName(node.property, node.computed);
}

/** Collects method reads while preserving lexical arrows and excluding receivers rebound by nested functions. */
function collectThisReads(node: ILintNode, into: Set<string>): void {
  const name = thisMemberName(node);
  if (name !== null) into.add(name);
  forEachChildNode(node, (child) => {
    if (CLASS_KINDS.has(child.type)) return;
    if (REBOUND_THIS_KINDS.has(child.type)) {
      if (child.computed === true && isNodeLike(child.key)) collectThisReads(asNode(child.key), into);
      return;
    }
    collectThisReads(child, into);
  });
}

/** Builds the method records, splitting each method's `this` reads into attributes and calls. */
function methodRecords(members: readonly ILintNode[], attributes: ReadonlySet<string>): readonly IClassMethod[] {
  const methods = members.filter((member) => METHOD_KINDS.has(member.type) && !isConstructor(member));
  const names = new Set(methods.map((method) => keyName(method.key, method.computed)).filter((name) => name !== null));
  return methods.map((method) => {
    const reads = new Set<string>();
    collectThisReads(functionOf(method), reads);
    const name = keyName(method.key, method.computed);
    return {
      name,
      isVisible: method.accessibility !== PRIVATE_ACCESSIBILITY && !(name ?? "").startsWith(PRIVATE_PREFIX),
      attributes: new Set([...reads].filter((read) => attributes.has(read))),
      calls: new Set([...reads].filter((read) => names.has(read))),
    };
  });
}

function sharesAttribute(left: IClassMethod, right: IClassMethod): boolean {
  for (const attribute of left.attributes) {
    if (right.attributes.has(attribute)) return true;
  }
  return false;
}

/** Tight class cohesion: directly connected visible method pairs over all pairs, or null for fewer than two. */
function tightClassCohesion(methods: readonly IClassMethod[]): number | null {
  const visible = methods.filter((method) => method.isVisible);
  if (visible.length < 2) return null;
  let connected = 0;
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      if (sharesAttribute(visible[i], visible[j])) connected++;
    }
  }
  return connected / ((visible.length * (visible.length - 1)) / 2);
}

function isLinked(left: IClassMethod, right: IClassMethod): boolean {
  if (sharesAttribute(left, right)) return true;
  return (right.name !== null && left.calls.has(right.name)) || (left.name !== null && right.calls.has(left.name));
}

/** LCOM4: the connected components of the graph that joins methods sharing an attribute or calling each other. */
function connectedComponents(methods: readonly IClassMethod[]): number {
  const parent = methods.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < methods.length; i++) {
    for (let j = i + 1; j < methods.length; j++) {
      if (isLinked(methods[i], methods[j])) parent[find(i)] = find(j);
    }
  }
  return new Set(methods.map((_, index) => find(index))).size;
}

/** The ranges of the classes nested inside the class body. */
function nestedClassRanges(classNode: ILintNode): readonly (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = [];
  const visit = (node: ILintNode): void => {
    if (CLASS_KINDS.has(node.type)) ranges.push(rangeOf(node));
    forEachChildNode(node, visit);
  };
  forEachChildNode(classNode, visit);
  return ranges;
}

/** Weighted methods per class: each unit adds its cyclomatic value, and a nested function adds it minus its base path. */
function weightedMethods(
  classNode: ILintNode,
  options: IMetricOptions,
  context: IMeasurementContext,
): number {
  const nested = nestedClassRanges(classNode);
  const units = functionUnits(classNode as IRuleNode, context).filter((unit) =>
    !nested.some(([start, end]) => unit.range[0] >= start && unit.range[1] <= end)
  );
  const inner = new Set(units.flatMap((unit) => unit.descendantRanges.map((range) => range.join(":"))));
  let total = 0;
  for (const unit of units) {
    const value = measureFunction(unit, options, context).cyclomatic;
    total += inner.has(unit.range.join(":")) ? value - 1 : value;
  }
  return total;
}

/** The count of token lines inside the class range. */
function classLines(range: readonly [number, number], context: IMeasurementContext): number {
  return codeTokenLines(range, context).size;
}

function classNameOf(classNode: ILintNode): string {
  const id = classNode.id;
  return isNodeLike(id) && typeof asNode(id).name === "string" ? (asNode(id).name as string) : ANONYMOUS_CLASS;
}

/** Measures one class unit: the per-file metrics that need no other file. */
export function measureClass(
  classNode: ILintNode,
  options: IMetricOptions,
  context: IMeasurementContext,
): IClassMetrics {
  const members = membersOf(classNode);
  const attributes = attributeNames(members);
  const methods = methodRecords(members, attributes);
  const range = rangeOf(classNode);
  const coupling = measureCoupling(classNode, context);
  const surface = publicSurface(members, context);
  return {
    name: classNameOf(classNode),
    line: context.positionAt(range[0]).line,
    nom: methods.length,
    wmc: weightedMethods(classNode, options, context),
    loc: classLines(range, context),
    noa: attributes.size,
    tcc: tightClassCohesion(methods),
    lcom4: connectedComponents(methods),
    atfd: coupling.atfd,
    cbo: coupling.cbo,
    rfc: null,
    dit: null,
    noc: null,
    woc: surface.woc,
    noap: surface.noap,
    noam: surface.noam,
    precision: "syntactic",
  };
}
