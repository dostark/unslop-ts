/**
 * @module WholeTreeDefinitionReach
 * @path src/rules/whole_tree/definition_reach.ts
 * @description Resolves a name that a file imports to the exported definitions behind it, through aliases, named and star re-exports, and namespace imports.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/unused_exports_resolved.ts, src/rules/whole_tree/unused_enum_members.ts, src/rules/whole_tree/unused_class_members.ts]
 */

import ts from "typescript";
import type { IModuleGraph } from "./unused_exports_resolved.ts";

const KEY_SEPARATOR = "\0";
const DEFAULT_EXPORT = "default";

/** A definition that a file declares under a name and may export. */
export interface IExportedDefinition {
  readonly repoPath: string;
  readonly name: string;
  exported: boolean;
}

/** What the names of one file denote: the definitions behind each local name, and the modules of each namespace import. */
export interface IFileBindings<T> {
  readonly names: Map<string, T[]>;
  readonly namespaces: Map<string, string[]>;
}

/** The lookups over one set of definitions. */
export interface IDefinitionReach<T> {
  /** The exported definitions that the name `name` of `module` reaches. */
  readonly reach: (module: string, name: string) => T[];
  /** Every exported definition that `module` declares or forwards. */
  readonly reachAll: (module: string) => T[];
  /** The bindings of one file. */
  readonly bindingsOf: (repoPath: string, sourceFile: ts.SourceFile) => IFileBindings<T>;
}

/** The key under which a definition is stored. */
export function definitionKey(repoPath: string, name: string): string {
  return `${repoPath}${KEY_SEPARATOR}${name}`;
}

/** Builds the lookups over `defs`, which are keyed by `definitionKey`. */
export function createDefinitionReach<T extends IExportedDefinition>(
  graph: IModuleGraph,
  defs: ReadonlyMap<string, T>,
): IDefinitionReach<T> {
  const byModule = new Map<string, T[]>();
  for (const def of defs.values()) byModule.set(def.repoPath, [...(byModule.get(def.repoPath) ?? []), def]);

  const reach = (module: string, name: string, seen = new Set<string>()): T[] => {
    const key = definitionKey(module, name);
    if (seen.has(key)) return [];
    seen.add(key);
    const def = defs.get(key);
    const found: T[] = def?.exported ? [def] : [];
    const edges = graph.edges.get(module);
    const forward = edges?.forwards.get(name);
    if (forward) {
      for (const target of graph.targetsOf(module, forward.specifier)) {
        found.push(...reach(target, forward.original, seen));
      }
    }
    if (name === DEFAULT_EXPORT) return found;
    for (const specifier of edges?.stars ?? []) {
      for (const target of graph.targetsOf(module, specifier)) found.push(...reach(target, name, seen));
    }
    return found;
  };

  const reachAll = (module: string, seen = new Set<string>()): T[] => {
    if (seen.has(module)) return [];
    seen.add(module);
    const edges = graph.edges.get(module);
    const found = (byModule.get(module) ?? []).filter((def) => def.exported);
    for (const name of edges?.forwards.keys() ?? []) found.push(...reach(module, name));
    for (const specifier of edges?.stars ?? []) {
      for (const target of graph.targetsOf(module, specifier)) found.push(...reachAll(target, seen));
    }
    return found;
  };

  const bindingsOf = (repoPath: string, sourceFile: ts.SourceFile): IFileBindings<T> => {
    const bindings: IFileBindings<T> = { names: new Map(), namespaces: new Map() };
    for (const def of byModule.get(repoPath) ?? []) bindings.names.set(def.name, [def]);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const targets = graph.targetsOf(repoPath, statement.moduleSpecifier.text);
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindings.namespaces.set(named.name.text, targets);
      if (!named || !ts.isNamedImports(named)) continue;
      for (const element of named.elements) {
        const found = targets.flatMap((target) => reach(target, (element.propertyName ?? element.name).text));
        if (found.length > 0) bindings.names.set(element.name.text, found);
      }
    }
    return bindings;
  };

  return { reach, reachAll, bindingsOf };
}
