/**
 * @module HealthExports
 * @path src/report/exports.ts
 * @description Raw value-export population of the health snapshot, separate from the filtered lint findings.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/parse.ts, src/report/health.ts, src/rules/whole_tree/unused_exports_resolved.ts]
 */

import { asNode, type ILintNode, isNodeLike } from "../engine/type_environment.ts";
import { forEachChildNode } from "../metrics/estree.ts";
import type { IParsedHealthFile } from "./parse.ts";

/** One raw value export site, including suppressed and re-exported values. */
export interface IValueExportSite {
  readonly path: string;
  readonly name: string;
  readonly kind: "value" | "default" | "re-export";
  readonly line: number;
  readonly column: number;
}

/** The raw export population of one snapshot. */
export interface IExportPopulation {
  readonly total: number;
  readonly unused: number;
  readonly byPath: ReadonlyMap<string, { readonly total: number; readonly unused: number }>;
}

/** The declaration node types that never declare a runtime value. */
const TYPE_DECLARATIONS: ReadonlySet<string> = new Set([
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSDeclareFunction",
  "TSModuleDeclaration",
]);

/** Adds every binding name of an exported pattern to the site list. */
function patternSites(
  value: unknown,
  add: (name: string) => void,
): void {
  if (!isNodeLike(value)) return;
  const node = asNode(value);
  switch (node.type) {
    case "Identifier":
      if (typeof node.name === "string") add(node.name);
      return;
    case "ObjectPattern":
      for (const property of Array.isArray(node.properties) ? node.properties : []) {
        if (isNodeLike(property)) patternSites(asNode(property).value ?? asNode(property).argument, add);
      }
      return;
    case "ArrayPattern":
      for (const element of Array.isArray(node.elements) ? node.elements : []) patternSites(element, add);
      return;
    case "AssignmentPattern":
      patternSites(node.left, add);
      return;
    case "RestElement":
      patternSites(node.argument, add);
      return;
    default:
      return;
  }
}

/** The exported name of one export specifier, or null for a type-only specifier. */
function specifierName(specifier: ILintNode): string | null {
  if (specifier.exportKind === "type" || specifier.importKind === "type") return null;
  const exported = specifier.exported;
  if (!isNodeLike(exported)) return null;
  const node = asNode(exported);
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if ((node.type === "StringLiteral" || node.type === "Literal") && typeof node.value === "string") return node.value;
  return null;
}

/** Adds the value sites of one export declaration, skipping every type-only declaration. */
function declarationSites(
  declaration: unknown,
  add: (name: string, kind: IValueExportSite["kind"], node: ILintNode) => void,
  node: ILintNode,
): void {
  if (!isNodeLike(declaration)) return;
  const declared = asNode(declaration);
  if (TYPE_DECLARATIONS.has(declared.type)) return;
  if (declared.type === "VariableDeclaration") {
    for (const declarator of Array.isArray(declared.declarations) ? declared.declarations : []) {
      if (isNodeLike(declarator)) patternSites(asNode(declarator).id, (name) => add(name, "value", node));
    }
    return;
  }
  patternSites(declared.id, (name) => add(name, "value", node));
}

/** Adds the value sites of one named export clause. */
function namedSpecifierSites(
  node: ILintNode,
  add: (name: string, kind: IValueExportSite["kind"], node: ILintNode) => void,
): void {
  for (const specifier of Array.isArray(node.specifiers) ? node.specifiers : []) {
    if (!isNodeLike(specifier)) continue;
    const name = specifierName(asNode(specifier));
    if (name !== null) add(name, isNodeLike(node.source) ? "re-export" : "value", node);
  }
}

/** The raw value export sites of one parsed file. Suppression pragmas never remove a site. */
export function valueExportSitesOf(file: IParsedHealthFile): IValueExportSite[] {
  const sites: IValueExportSite[] = [];
  const add = (name: string, kind: IValueExportSite["kind"], node: ILintNode): void => {
    const position = file.context.positionAt(node.range?.[0] ?? 0);
    sites.push({ path: file.path, name, kind, line: position.line, column: position.column });
  };
  const program = asNode(file.tree.program);
  for (const statement of Array.isArray(program.body) ? program.body : []) {
    if (!isNodeLike(statement)) continue;
    const node = asNode(statement);
    if (node.type === "ExportNamedDeclaration") {
      if (node.exportKind === "type") continue;
      declarationSites(node.declaration, add, node);
      namedSpecifierSites(node, add);
      continue;
    }
    if (node.type === "ExportDefaultDeclaration") {
      add("default", "default", node);
      continue;
    }
    if (node.type === "ExportAllDeclaration" && node.exportKind !== "type") add("*", "re-export", node);
  }
  return sites;
}

/** Every identifier occurrence of the snapshot, used by the raw value-use scan. */
function identifierCounts(files: ReadonlyMap<string, IParsedHealthFile>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files.values()) {
    const visit = (node: ILintNode): void => {
      if (node.type === "Identifier" && typeof node.name === "string") {
        counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
      }
      forEachChildNode(node, visit);
    };
    visit(asNode(file.tree.program));
  }
  return counts;
}

/** The raw export population of the snapshot. Star and default sites stay in the denominator. */
export function exportPopulationOf(files: ReadonlyMap<string, IParsedHealthFile>): IExportPopulation {
  const references = identifierCounts(files);
  const declarations = new Map<string, number>();
  const all = [...files.values()].flatMap(valueExportSitesOf);
  for (const site of all) {
    if (site.kind === "value" || site.kind === "re-export") {
      if (site.name === "*") continue;
      declarations.set(site.name, (declarations.get(site.name) ?? 0) + 1);
    }
  }
  const byPath = new Map<string, { total: number; unused: number }>();
  let unused = 0;
  for (const site of all) {
    const entry = byPath.get(site.path) ?? { total: 0, unused: 0 };
    entry.total++;
    const resolvable = site.kind !== "default" && site.name !== "*";
    const dead = resolvable && (references.get(site.name) ?? 0) <= (declarations.get(site.name) ?? 0);
    if (dead) {
      entry.unused++;
      unused++;
    }
    byPath.set(site.path, entry);
  }
  return { total: all.length, unused, byPath };
}

/** The dead-export ratio, zero for an empty population. */
export function deadRatioOf(total: number, unused: number): number {
  return total === 0 ? 0 : unused / total;
}
