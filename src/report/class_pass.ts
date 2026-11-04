/**
 * @module HealthClassPass
 * @path src/report/class_pass.ts
 * @description Class design metrics of a health snapshot. The Babel tree measures each class, the TypeScript compiler tree types its ATFD and CBO, and the two are joined by file, class name and name offset.
 * @architectural-layer Tooling
 * @dependencies [typescript]
 * @related-files [src/metrics/class_metrics.ts, src/rules/whole_tree/typed_coupling.ts, src/report/parse.ts, src/report/exports.ts]
 */

import ts from "typescript";
import { asNode, type ILintNode } from "../engine/type_environment.ts";
import { measureClass } from "../metrics/class_metrics.ts";
import { forEachChildNode, rangeOf } from "../metrics/estree.ts";
import type { IClassMetrics, IMetricOptions } from "../metrics/types.ts";
import { createReceiverContext, createTypeContext } from "../rules/whole_tree/class_context.ts";
import type { ITypeDef } from "../rules/whole_tree/class_receivers.ts";
import { type ITypedCoupling, typedCouplingOf } from "../rules/whole_tree/typed_coupling.ts";
import type { IModuleGraph } from "../rules/whole_tree/unused_exports_resolved.ts";
import { typeScriptSourcesOf } from "./exports.ts";
import type { IParsedHealthFile } from "./parse.ts";

/** Where a class is declared: the file, the name, and the offset of the name identifier. */
export interface IClassSite {
  readonly path: string;
  readonly name: string;
  readonly nameOffset: number;
}

/** The tree that reported a class: the Babel tree that measures, or the TypeScript compiler tree that types. */
export type ClassTree = "babel" | "typescript";

/** A class that only one of the two trees reports. */
export interface IUnjoinedClass extends IClassSite {
  readonly reportedBy: ClassTree;
}

/** One measured class with the place where it is declared. */
export interface IPassClass extends IClassSite {
  readonly metrics: IClassMetrics;
}

/** The inputs of the class pass. */
export interface IClassPassInput {
  readonly files: ReadonlyMap<string, IParsedHealthFile>;
  readonly graph: IModuleGraph;
  readonly options: IMetricOptions;
}

/** Every measured class, and the classes that the two trees did not both report. */
export interface IClassPassResult {
  readonly classes: readonly IPassClass[];
  readonly unjoined: readonly IUnjoinedClass[];
}

/** The classes that both trees report, and the classes that only one tree reports. */
export interface IClassJoin<B extends IClassSite, T extends IClassSite> {
  readonly pairs: ReadonlyArray<{ readonly babel: B; readonly typed: T }>;
  readonly unjoined: readonly IUnjoinedClass[];
}

const CLASS_KINDS: ReadonlySet<string> = new Set(["ClassDeclaration", "ClassExpression"]);
const KEY_SEPARATOR = "\0";

function siteKey(site: IClassSite): string {
  return [site.path, site.name, site.nameOffset].join(KEY_SEPARATOR);
}

/** Pairs the classes of the two trees. Two classes are the same when path, name and name offset agree. */
export function joinClasses<B extends IClassSite, T extends IClassSite>(
  babel: readonly B[],
  typed: readonly T[],
): IClassJoin<B, T> {
  const typedByKey = new Map(typed.map((site) => [siteKey(site), site]));
  const pairs: Array<{ babel: B; typed: T }> = [];
  const unjoined: IUnjoinedClass[] = [];
  for (const site of babel) {
    const match = typedByKey.get(siteKey(site));
    if (match) {
      pairs.push({ babel: site, typed: match });
      typedByKey.delete(siteKey(site));
    } else {
      unjoined.push({ path: site.path, name: site.name, nameOffset: site.nameOffset, reportedBy: "babel" });
    }
  }
  for (const site of typedByKey.values()) {
    unjoined.push({ path: site.path, name: site.name, nameOffset: site.nameOffset, reportedBy: "typescript" });
  }
  return { pairs, unjoined };
}

/** Every class node under a root, outer classes before the classes nested in them. */
function classNodesUnder(root: ILintNode, found: ILintNode[]): ILintNode[] {
  if (CLASS_KINDS.has(root.type)) found.push(root);
  forEachChildNode(root, (child) => classNodesUnder(child, found));
  return found;
}

/** The offset of the class name identifier, or of the class itself when it has no name. */
function nameOffsetOf(node: ILintNode): number {
  const id = node.id;
  return rangeOf(id && typeof id === "object" ? asNode(id) : node)[0];
}

interface IBabelClass extends IPassClass {
  readonly metrics: IClassMetrics;
}

function babelClassesOf(file: IParsedHealthFile, options: IMetricOptions): IBabelClass[] {
  return classNodesUnder(asNode(file.tree.program), []).map((node) => {
    const metrics = measureClass(node, options, file.context);
    return { path: file.path, name: metrics.name, nameOffset: nameOffsetOf(node), metrics };
  });
}

interface ITypedClass extends IClassSite {
  readonly def: ITypeDef;
}

function typedClassesOf(defs: Iterable<ITypeDef>): ITypedClass[] {
  const classes: ITypedClass[] = [];
  for (const def of defs) {
    if (!ts.isClassDeclaration(def.node) || !def.node.name) continue;
    const nameOffset = def.node.name.getStart(def.node.getSourceFile());
    classes.push({ path: def.repoPath, name: def.name, nameOffset, def });
  }
  return classes;
}

/** Measures the classes of the snapshot and gives each joined class its typed ATFD and CBO. */
export function classPassOf(input: IClassPassInput): IClassPassResult {
  const context = createTypeContext(input.graph, typeScriptSourcesOf(input.files));
  const coupling = typedCouplingOf(context, createReceiverContext(context));
  const measured = [...input.files.values()].flatMap((file) => babelClassesOf(file, input.options));
  const { pairs, unjoined } = joinClasses(measured, typedClassesOf(context.defs.values()));
  const typedBy = new Map<IBabelClass, ITypedCoupling | undefined>(
    pairs.map((pair) => [pair.babel, coupling.get(pair.typed.def)]),
  );
  const classes = measured.map((entry) => {
    const typed = typedBy.get(entry);
    const metrics: IClassMetrics = typed
      ? { ...entry.metrics, atfd: typed.atfd, cbo: typed.cbo, precision: "typed" }
      : entry.metrics;
    return { path: entry.path, name: entry.name, nameOffset: entry.nameOffset, metrics };
  });
  return { classes, unjoined };
}
