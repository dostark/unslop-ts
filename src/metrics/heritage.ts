/**
 * @module Heritage
 * @path src/metrics/heritage.ts
 * @description Shared heritage reading: the plain names a class extends or implements, and their resolution through bindings.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/metrics/class_coupling.ts, src/rules/whole_tree/unused_class_members.ts]
 */

import { asNode, type ILintNode, isNodeLike } from "../engine/type_environment.ts";

const IDENTIFIER = "Identifier";

/** The plain name of an expression node, or null when the node is not a plain identifier. */
function plainName(value: ILintNode["expression"]): string | null {
  if (!isNodeLike(value)) return null;
  const node = asNode(value);
  return node.type === IDENTIFIER && typeof node.name === "string" ? node.name : null;
}

/** The heritage names of a class node as written. A base that is not a plain name is null. */
export function heritageNamesOfClass(classNode: ILintNode): readonly (string | null)[] {
  const names: (string | null)[] = [];
  if (isNodeLike(classNode.superClass)) names.push(plainName(classNode.superClass));
  const implemented = classNode.implements;
  if (Array.isArray(implemented)) {
    for (const entry of implemented) {
      if (isNodeLike(entry)) names.push(plainName(asNode(entry).expression));
    }
  }
  return names;
}

/** The definitions that the heritage names resolve to. A null name resolves to nothing. */
export function resolveHeritage<TDefinition>(
  names: readonly (string | null)[],
  lookup: (name: string) => readonly TDefinition[],
): TDefinition[] {
  const parents: TDefinition[] = [];
  for (const name of names) {
    if (name !== null) parents.push(...lookup(name));
  }
  return parents;
}
