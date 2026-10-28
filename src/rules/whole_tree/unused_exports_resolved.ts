/**
 * @module WholeTreeUnusedExportsResolved
 * @path src/rules/whole_tree/unused_exports_resolved.ts
 * @description Matches each import to the module that defines the export, follows named and star re-exports, and lists the export sites that no import reaches. A bare name that another module exports and imports never hides an unused site.
 * @architectural-layer Shared
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [src/rules/whole_tree/unused_exports.ts, src/rules/whole_tree/manifest_entries.ts]
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, relative } from "@std/path";
import {
  createImportResolver,
  globMatcher,
  type IImportMapEntry,
  readDenoManifest,
  readPublicEntries,
  resolveSpecifier,
} from "./manifest_entries.ts";

const DEFAULT_EXPORT = "default";
const KEY_SEPARATOR = "\0";
const DENO_MANIFEST = "deno.json";
const PACKAGE_MANIFEST = "package.json";

/** One export site that the report may list: an exported name in a file. */
export interface IExportCandidate {
  readonly repoPath: string;
  readonly name: string;
}

/** What an import takes from its module: the listed names, or every export. */
type ImportUse = readonly string[] | "all";

/** One re-export entry: the module and the name that an exported name forwards. */
interface IForward {
  readonly specifier: string;
  readonly original: string;
}

/** The module edges of one file. */
interface IModuleEdges {
  readonly forwards: Map<string, IForward>;
  readonly stars: string[];
  readonly imports: Array<{ readonly specifier: string; readonly use: ImportUse }>;
}

/** The inputs of one resolved run. */
export interface IResolvedInput {
  readonly repoRoot: string;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  readonly candidates: readonly IExportCandidate[];
  readonly walkSkipPatterns: readonly string[];
  readonly publicEntries: readonly string[];
}

/** What the manifests below the root give: import map entries, and the files that they publish as API. */
interface IManifestScan {
  readonly importMap: IImportMapEntry[];
  readonly publicEntries: string[];
}

function keyOf(repoPath: string, name: string): string {
  return `${repoPath}${KEY_SEPARATOR}${name}`;
}

/** Reads every deno.json and package.json below the root. */
async function scanManifests(repoRoot: string, skipPatterns: readonly string[]): Promise<IManifestScan> {
  const skip = skipPatterns.map((pattern) => new RegExp(pattern));
  const scan: IManifestScan = { importMap: [], publicEntries: [] };
  const match = [new RegExp(`(^|/)(${DENO_MANIFEST}|${PACKAGE_MANIFEST})$`.replaceAll(".", "\\."))];
  for await (const entry of walk(repoRoot, { includeDirs: false, includeSymlinks: false, skip, match })) {
    try {
      const json = JSON.parse(await Deno.readTextFile(entry.path));
      const dir = dirname(relative(repoRoot, entry.path));
      const isPackageJson = entry.name === PACKAGE_MANIFEST;
      scan.publicEntries.push(...readPublicEntries(dir, json, isPackageJson));
      if (!isPackageJson) scan.importMap.push(...readDenoManifest(dir, json).importMap);
    } catch {
      // A manifest that does not parse adds nothing.
    }
  }
  return scan;
}

/** True when the identifier is the member part of `x.name` or `X.Name`, so it is not a read of the binding. */
function isMemberName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return ts.isPropertyAccessExpression(parent) && parent.name === node ||
    ts.isQualifiedName(parent) && parent.right === node;
}

/** What the identifier's occurrences read from it: member names, or every export when it escapes. */
function identifierUse(sourceFile: ts.SourceFile, name: string, declaration: ts.Node): ImportUse {
  const members = new Set<string>();
  let escapes = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && node !== declaration) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) members.add(parent.name.text);
      else if (ts.isQualifiedName(parent) && parent.left === node) members.add(parent.right.text);
      else if (!isMemberName(node)) escapes = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return escapes ? "all" : [...members];
}

function bindingNames(pattern: ts.ObjectBindingPattern): string[] {
  return pattern.elements.map((element) => (element.propertyName ?? element.name).getText());
}

/** What a dynamic `import()` call takes, from the shape that reads its result. */
function dynamicImportUse(sourceFile: ts.SourceFile, call: ts.CallExpression): ImportUse {
  let node: ts.Node = call;
  while (ts.isAwaitExpression(node.parent) || ts.isParenthesizedExpression(node.parent)) node = node.parent;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return [parent.name.text];
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    if (ts.isObjectBindingPattern(parent.name)) return bindingNames(parent.name);
    if (ts.isIdentifier(parent.name)) return identifierUse(sourceFile, parent.name.text, parent.name);
  }
  return "all";
}

function importClauseUses(sourceFile: ts.SourceFile, clause: ts.ImportClause): ImportUse {
  const names: string[] = clause.name ? [DEFAULT_EXPORT] : [];
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    const used = identifierUse(sourceFile, bindings.name.text, bindings.name);
    return used === "all" ? "all" : [...names, ...used];
  }
  if (bindings) names.push(...bindings.elements.map((element) => (element.propertyName ?? element.name).text));
  return names;
}

function collectEdges(sourceFile: ts.SourceFile): IModuleEdges {
  const edges: IModuleEdges = { forwards: new Map(), stars: [], imports: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      edges.imports.push({
        specifier: node.moduleSpecifier.text,
        use: importClauseUses(sourceFile, node.importClause),
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const clause = node.exportClause;
      if (!clause) edges.stars.push(specifier);
      else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          edges.forwards.set(element.name.text, { specifier, original: (element.propertyName ?? element.name).text });
        }
      } else edges.imports.push({ specifier, use: "all" });
    } else if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])
    ) {
      edges.imports.push({ specifier: node.arguments[0].text, use: dynamicImportUse(sourceFile, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edges;
}

/**
 * Lists the candidates that no import reaches. An import marks the site it names and every site along the
 * re-export chain behind it. A named re-export is not an import, so a barrel entry that nobody imports through the
 * barrel stays unused even when the definition behind it is used elsewhere.
 */
export async function findUnusedCandidates(input: IResolvedInput): Promise<IExportCandidate[]> {
  const manifests = await scanManifests(input.repoRoot, input.walkSkipPatterns);
  const resolveAlias = createImportResolver(manifests.importMap);
  const edges = new Map<string, IModuleEdges>();
  for (const [repoPath, sourceFile] of input.sourceFiles) edges.set(repoPath, collectEdges(sourceFile));
  const known = new Set(edges.keys());
  const targetsOf = (from: string, specifier: string): string[] =>
    resolveSpecifier(from, specifier, resolveAlias).filter((target) => known.has(target));
  const namesByFile = new Map<string, string[]>();
  for (const { repoPath, name } of input.candidates) {
    namesByFile.set(repoPath, [...(namesByFile.get(repoPath) ?? []), name]);
  }

  const used = new Set<string>();
  const markChain = (repoPath: string, name: string, seen: Set<string>): void => {
    const key = keyOf(repoPath, name);
    if (seen.has(key)) return;
    seen.add(key);
    used.add(key);
    const module = edges.get(repoPath);
    const forward = module?.forwards.get(name);
    if (forward) {
      for (const target of targetsOf(repoPath, forward.specifier)) markChain(target, forward.original, seen);
    }
    if (name === DEFAULT_EXPORT) return;
    for (const specifier of module?.stars ?? []) {
      for (const target of targetsOf(repoPath, specifier)) markChain(target, name, seen);
    }
  };
  const markAll = (repoPath: string, seen: Set<string>): void => {
    if (seen.has(repoPath)) return;
    seen.add(repoPath);
    const module = edges.get(repoPath);
    for (const name of namesByFile.get(repoPath) ?? []) used.add(keyOf(repoPath, name));
    for (const name of module?.forwards.keys() ?? []) markChain(repoPath, name, new Set());
    for (const specifier of module?.stars ?? []) {
      for (const target of targetsOf(repoPath, specifier)) markAll(target, seen);
    }
  };
  for (const [importer, module] of edges) {
    for (const { specifier, use } of module.imports) {
      for (const target of targetsOf(importer, specifier)) {
        if (target === importer) continue;
        if (use === "all") markAll(target, new Set());
        else for (const name of use) markChain(target, name, new Set());
      }
    }
  }
  // A published entry file is consumed from outside the walk, as a namespace import of the whole file.
  const isConfiguredEntry = globMatcher(input.publicEntries);
  const publicFiles = new Set([...manifests.publicEntries, ...[...known].filter(isConfiguredEntry)]);
  for (const entry of publicFiles) if (known.has(entry)) markAll(entry, new Set());
  return input.candidates.filter(({ repoPath, name }) => !used.has(keyOf(repoPath, name)));
}
