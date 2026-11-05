/**
 * @module WholeTreeClassHierarchy
 * @path src/rules/whole_tree/class_hierarchy.ts
 * @description Depth of inheritance and number of children of the classes of the walked files. Only `extends` counts. A base that no walked class declares adds one level and ends the chain.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/class_context.ts, src/rules/whole_tree/class_receivers.ts, src/report/class_pass.ts]
 */

import ts from "typescript";
import { createReceiverContext, type ITypeContext } from "./class_context.ts";
import { expressionDefs, type IReceiverContext, type ITypeDef } from "./class_receivers.ts";

/** The inheritance depth and the direct subclass count of one class. */
export interface IHierarchy {
  readonly dit: number;
  readonly noc: number;
}

/** The classes that a class extends: none, a base that no walked class declares, or the declared bases. */
type Base = "none" | "unresolved" | readonly ITypeDef[];

function extendsExpression(node: ts.ClassLikeDeclaration): ts.Expression | null {
  const clause = node.heritageClauses?.find((candidate) => candidate.token === ts.SyntaxKind.ExtendsKeyword);
  return clause?.types[0]?.expression ?? null;
}

function baseOf(receivers: IReceiverContext, def: ITypeDef): Base {
  const expression = ts.isClassLike(def.node) ? extendsExpression(def.node) : null;
  if (expression === null) return "none";
  if (!ts.isIdentifier(expression)) return "unresolved";
  const bases = expressionDefs(receivers, def.repoPath, expression).filter((candidate) =>
    ts.isClassLike(candidate.node)
  );
  return bases && bases.length > 0 ? bases : "unresolved";
}

/** The inheritance depth and subclass count of every class declaration of the walked files. */
export function hierarchyOf(
  context: ITypeContext,
  receivers: IReceiverContext = createReceiverContext(context),
): ReadonlyMap<ITypeDef, IHierarchy> {
  const classes = [...context.defs.values()].filter((def) => ts.isClassLike(def.node));
  const bases = new Map(classes.map((def) => [def, baseOf(receivers, def)]));
  const depths = new Map<ITypeDef, number>();
  const depthOf = (def: ITypeDef, path: ReadonlySet<ITypeDef>): number => {
    const known = depths.get(def);
    if (known !== undefined) return known;
    const base = bases.get(def) ?? "none";
    let depth = 0;
    if (base === "unresolved") depth = 1;
    else if (base !== "none" && !path.has(def)) {
      depth = 1 + Math.max(...base.map((parent) => depthOf(parent, new Set([...path, def]))));
    }
    depths.set(def, depth);
    return depth;
  };
  const children = new Map<ITypeDef, number>();
  for (const base of bases.values()) {
    if (base === "none" || base === "unresolved") continue;
    for (const parent of base) children.set(parent, (children.get(parent) ?? 0) + 1);
  }
  return new Map(classes.map((def) => [def, { dit: depthOf(def, new Set()), noc: children.get(def) ?? 0 }]));
}
