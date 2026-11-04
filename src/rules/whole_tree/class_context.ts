/**
 * @module WholeTreeClassContext
 * @path src/rules/whole_tree/class_context.ts
 * @description Builds the class and interface declarations of the walked files and the receiver lookups over them. The unused-member check and the class pass of the health report share it.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/class_receivers.ts, src/rules/whole_tree/unused_class_members.ts, src/report/class_pass.ts]
 */

import ts from "typescript";
import { isExported } from "./declaration_markers.ts";
import { createDefinitionReach, definitionKey, type IDefinitionReach, type IFileBindings } from "./definition_reach.ts";
import type { IReceiverContext, ITypeDef } from "./class_receivers.ts";
import { resolveHeritage } from "../../metrics/heritage.ts";
import type { IModuleGraph } from "./unused_exports_resolved.ts";

/** The declarations of the walked files with the lookups that resolve a name to them. */
export interface ITypeContext extends IDefinitionReach<ITypeDef> {
  readonly defs: ReadonlyMap<string, ITypeDef>;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  readonly bindings: Map<string, IFileBindings<ITypeDef>>;
}

/** An `export { Name }` list exports a declaration of the same file. */
function markListedExports(repoPath: string, sourceFile: ts.SourceFile, defs: Map<string, ITypeDef>): void {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const def = defs.get(definitionKey(repoPath, (element.propertyName ?? element.name).text));
      if (def && !element.propertyName) def.exported = true;
    }
  }
}

/** Every top-level class and interface declaration of the walked files. */
function collectTypes(sourceFiles: ReadonlyMap<string, ts.SourceFile>): Map<string, ITypeDef> {
  const defs = new Map<string, ITypeDef>();
  for (const [repoPath, sourceFile] of sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) continue;
      if (!statement.name) continue;
      const name = statement.name.text;
      defs.set(definitionKey(repoPath, name), { repoPath, name, node: statement, exported: isExported(statement) });
    }
    markListedExports(repoPath, sourceFile, defs);
  }
  return defs;
}

/** Collects the declarations of the walked files and the lookups over them. */
export function createTypeContext(graph: IModuleGraph, sourceFiles: ReadonlyMap<string, ts.SourceFile>): ITypeContext {
  const defs = collectTypes(sourceFiles);
  return { defs, sourceFiles, bindings: new Map(), ...createDefinitionReach(graph, defs) };
}

/** The bindings of the file that declares `def`, built once per file. */
export function bindingsFor(context: ITypeContext, repoPath: string): IFileBindings<ITypeDef> {
  const known = context.bindings.get(repoPath);
  if (known) return known;
  const bindings = context.bindingsOf(repoPath, context.sourceFiles.get(repoPath)!);
  context.bindings.set(repoPath, bindings);
  return bindings;
}

/** The heritage type names of a class or interface, as written. Null stands for a base that is not a plain name. */
export function heritageNames(node: ts.ClassDeclaration | ts.InterfaceDeclaration): Array<string | null> {
  const names: Array<string | null> = [];
  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) names.push(ts.isIdentifier(type.expression) ? type.expression.text : null);
  }
  return names;
}

/** The types that a class or interface extends or implements, as the walked files declare them. */
function parentsFor(context: ITypeContext, def: ITypeDef): ITypeDef[] {
  const bindings = bindingsFor(context, def.repoPath);
  return resolveHeritage(heritageNames(def.node), (name) => bindings.names.get(name) ?? []);
}

/** The lookups that receiver typing needs, with the family of a type memoized. */
export function createReceiverContext(context: ITypeContext): IReceiverContext {
  const defOfNode = new Map<ts.Node, ITypeDef>();
  for (const def of context.defs.values()) defOfNode.set(def.node, def);
  const parents = new Map<ITypeDef, ITypeDef[]>();
  const children = new Map<ITypeDef, ITypeDef[]>();
  for (const def of context.defs.values()) {
    const found = parentsFor(context, def);
    parents.set(def, found);
    for (const parent of found) children.set(parent, [...children.get(parent) ?? [], def]);
  }
  const closure = (start: ITypeDef, edges: ReadonlyMap<ITypeDef, ITypeDef[]>, into: Set<ITypeDef>): void => {
    for (const next of edges.get(start) ?? []) {
      if (into.has(next)) continue;
      into.add(next);
      closure(next, edges, into);
    }
  };
  const families = new Map<ITypeDef, ReadonlySet<ITypeDef>>();
  return {
    bindingsFor: (repoPath) => bindingsFor(context, repoPath),
    reach: context.reach,
    defOfNode,
    parentsOf: (def) => parents.get(def) ?? [],
    familyOf: (def) => {
      const known = families.get(def);
      if (known) return known;
      const family = new Set<ITypeDef>([def]);
      closure(def, parents, family);
      closure(def, children, family);
      families.set(def, family);
      return family;
    },
  };
}
