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
export function createTypeContext(
  graph: IModuleGraph,
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  includeLexicalClasses = false,
): ITypeContext {
  const visible = collectTypes(sourceFiles);
  const defs = new Map(visible);
  if (!includeLexicalClasses) {
    return { defs, sourceFiles, bindings: new Map(), ...createDefinitionReach(graph, visible) };
  }
  for (const [repoPath, sourceFile] of sourceFiles) {
    const visit = (node: ts.Node): void => {
      if ((ts.isClassLike(node) || ts.isInterfaceDeclaration(node)) && node.name) {
        const known = visible.get(definitionKey(repoPath, node.name.text));
        if (known?.node !== node) {
          defs.set(`${definitionKey(repoPath, node.name.text)}\0${node.name.getStart(sourceFile)}`, {
            repoPath,
            name: node.name.text,
            node,
            exported: false,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    addExpressionBindings(repoPath, sourceFile, visible);
    markListedExports(repoPath, sourceFile, visible);
  }
  const canonical = new Map([...defs.values()].map((def) => [def.node, def]));
  const reach = createDefinitionReach(graph, visible);
  const normalize = (
    found: readonly ITypeDef[],
  ): ITypeDef[] => [...new Set(found.map((def) => canonical.get(def.node) ?? def))];
  return {
    defs,
    sourceFiles,
    bindings: new Map(),
    reach: (module, name) => normalize(reach.reach(module, name)),
    reachAll: (module) => normalize(reach.reachAll(module)),
    bindingsOf: (repoPath, sourceFile) => {
      const bindings = reach.bindingsOf(repoPath, sourceFile);
      return {
        names: new Map([...bindings.names].map(([name, found]) => [name, normalize(found)])),
        namespaces: bindings.namespaces,
      };
    },
  };
}

/** A top-level variable may export a named expression under a different binding name. */
function addExpressionBindings(repoPath: string, sourceFile: ts.SourceFile, visible: Map<string, ITypeDef>): void {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const node = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || !node || !ts.isClassExpression(node) || !node.name) continue;
      const name = declaration.name.text;
      visible.set(definitionKey(repoPath, name), { repoPath, name, node, exported: isExported(statement) });
    }
  }
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
export function heritageNames(node: ts.ClassLikeDeclaration | ts.InterfaceDeclaration): Array<string | null> {
  const names: Array<string | null> = [];
  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) names.push(ts.isIdentifier(type.expression) ? type.expression.text : null);
  }
  return names;
}

/** The types that a class or interface extends or implements, as the walked files declare them. */
function parentsFor(context: ITypeContext, def: ITypeDef, defOfNode: ReadonlyMap<ts.Node, ITypeDef>): ITypeDef[] {
  const names = new Map<string, ts.Identifier>();
  for (const clause of def.node.heritageClauses ?? []) {
    for (const type of clause.types) {
      if (ts.isIdentifier(type.expression)) names.set(type.expression.text, type.expression);
    }
  }
  return resolveHeritage(
    heritageNames(def.node),
    (name) => namedAt(context, def.repoPath, names.get(name)!, defOfNode),
  );
}

/** Resolves the nearest class or interface type binding without exposing local sites as module exports. */
function namedAt(
  context: ITypeContext,
  repoPath: string,
  identifier: ts.Identifier,
  defOfNode: ReadonlyMap<ts.Node, ITypeDef>,
): ITypeDef[] {
  const lookup = (node: ts.Node): ITypeDef[] => {
    const def = defOfNode.get(node);
    return def ? [def] : [];
  };
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    if (ts.isClassLike(scope) && scope.name?.text === identifier.text) return lookup(scope);
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isModuleBlock(scope)) continue;
    for (const statement of scope.statements) {
      if (
        (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
        statement.name?.text === identifier.text
      ) {
        return lookup(statement);
      }
      if (
        (ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
        statement.name.text === identifier.text
      ) return [];
    }
  }
  return bindingsFor(context, repoPath).names.get(identifier.text) ?? [];
}

/** The lookups that receiver typing needs, with the family of a type memoized. */
export function createReceiverContext(context: ITypeContext): IReceiverContext {
  const defOfNode = new Map<ts.Node, ITypeDef>();
  for (const def of context.defs.values()) defOfNode.set(def.node, def);
  const parents = new Map<ITypeDef, ITypeDef[]>();
  const children = new Map<ITypeDef, ITypeDef[]>();
  for (const def of context.defs.values()) {
    const found = parentsFor(context, def, defOfNode);
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
    resolveName: (repoPath, identifier) => namedAt(context, repoPath, identifier, defOfNode),
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
