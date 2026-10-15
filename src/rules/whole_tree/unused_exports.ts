/**
 * @module WholeTreeUnusedExports
 * @path packages/lint-rules/src/rules/whole_tree/unused_exports.ts
 * @description Finds exported declarations never imported by other production files.
 *   Whole-tree rule (TypeScript compiler API), moved from scripts/check_unused_exports.ts.
 * @architectural-layer Shared
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [packages/lint-rules/src/rules/whole_tree/options.ts, packages/lint-rules/src/cli/whole_tree.ts]
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, join, normalize } from "@std/path";
import { type IUnusedExportsSettings, WHOLE_TREE_SETTINGS } from "./options.ts";

/** One exported declaration site. */
export interface IExportSite {
  readonly repoPath: string;
  readonly line: number;
  readonly isBarrelPassThrough: boolean;
  readonly isTypeDecl: boolean;
}

/** One unwired export. */
export interface IUnwiredExport {
  readonly repoPath: string;
  readonly line: number;
  readonly name: string;
}

/** The result of an unused-exports run. */
export interface IUnusedExportsReport {
  readonly strict: boolean;
  readonly findings: readonly IUnwiredExport[];
  /** Directories ranked by finding count (relaxed mode only). */
  readonly topDirectories: readonly (readonly [string, number])[];
}

interface ISourceCacheEntry {
  text: string;
  sourceFile: ts.SourceFile | null;
}

type SourceCache = Map<string, ISourceCacheEntry>;

function isTestFilePath(repoPath: string, settings: IUnusedExportsSettings): boolean {
  return settings.testSegments.some((segment) => repoPath.includes(segment)) ||
    settings.testSuffixes.some((suffix) => repoPath.endsWith(suffix));
}

function isProductionRoot(repoPath: string, settings: IUnusedExportsSettings): boolean {
  return settings.productionRoots.some((root) => repoPath.startsWith(root));
}

function isPackageEntrypoint(repoPath: string, settings: IUnusedExportsSettings): boolean {
  return settings.entrypointSuffixes.some((suffix) => repoPath.endsWith(suffix));
}

function isMainEntrypoint(repoPath: string, settings: IUnusedExportsSettings): boolean {
  return settings.mainEntrypointSuffixes.some((suffix) => repoPath.endsWith(suffix));
}

function walkSkipPatterns(settings: IUnusedExportsSettings): RegExp[] {
  return settings.walkSkipPatterns.map((pattern) => new RegExp(pattern));
}

function hasExportModifier(node: ts.Node): boolean {
  if (!("modifiers" in node)) return false;
  // SAFETY: TypeScript stores the modifier list on the node when the key exists.
  const mods = (node as { modifiers?: ts.Modifier[] }).modifiers;
  return mods ? mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) : false;
}

function getExportName(node: ts.Node): string | null {
  if (ts.isClassDeclaration(node) && node.name) return node.name.text;
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) return decl.name.text;
    }
    return null;
  }
  if (ts.isInterfaceDeclaration(node) && node.name) return node.name.text;
  if (ts.isTypeAliasDeclaration(node) && node.name) return node.name.text;
  if (ts.isEnumDeclaration(node) && node.name) return node.name.text;
  return null;
}

function isIfaceOrType(node: ts.Node): boolean {
  return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
}

function isNamedReExport(node: ts.Node): node is ts.ExportDeclaration & {
  moduleSpecifier: ts.StringLiteral;
  exportClause: ts.NamedExports;
} {
  return ts.isExportDeclaration(node) &&
    !!node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
    !!node.exportClause && ts.isNamedExports(node.exportClause);
}

function isWildcardReExport(node: ts.Node): node is ts.ExportDeclaration & {
  moduleSpecifier: ts.StringLiteral;
} {
  return ts.isExportDeclaration(node) &&
    !!node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
    !node.exportClause;
}

function hasPublicJSDoc(text: string): boolean {
  return /@public\b/.test(text);
}

function isProviderMetadata(name: string): boolean {
  return /^PROVIDER_[A-Z]+_(DESCRIPTION|CAPABILITIES|STRENGTHS|COST_TIER)$/.test(name);
}

function isTestHelper(name: string): boolean {
  return /(Mock|Stub|TestHelper|TestHarness|TestContext)$/.test(name) ||
    /^mock[A-Z]/.test(name) ||
    /^create.*(Mock|Stub|Test)$/.test(name);
}

function isEntryPointName(name: string): boolean {
  return /^(run|start|launch|main)[A-Z]/.test(name);
}

function isTestExport(name: string): boolean {
  return name.startsWith("__test_");
}

function resolveImport(importerRepoPath: string, importPath: string): string | null {
  if (importPath.startsWith(".")) return normalize(join(dirname(importerRepoPath), importPath));
  return null;
}

/** Names imported by the repository's own wiring scripts, which are not scanned as production. */
export async function collectScriptImportedNames(
  repoRoot: string,
  settings: IUnusedExportsSettings = WHOLE_TREE_SETTINGS.unusedExports,
): Promise<Set<string>> {
  const names = new Set<string>();
  const skip = walkSkipPatterns(settings);
  for await (
    const entry of walk(join(repoRoot, settings.scriptRoot), { includeDirs: false, exts: [".ts"], skip })
  ) {
    const repoPath = entry.path.startsWith(repoRoot + "/") ? entry.path.slice(repoRoot.length + 1) : entry.path;
    if (isTestFilePath(repoPath, settings)) continue;
    const sourceFile = ts.createSourceFile(repoPath, await Deno.readTextFile(entry.path), ts.ScriptTarget.Latest, true);
    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isImportDeclaration(node) || !node.importClause) return;
      const clause = node.importClause;
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if (!el.isTypeOnly) names.add(el.name.text);
        }
      }
      if (clause.name) names.add(clause.name.text);
    });
  }
  return names;
}

async function collectProductionFiles(
  repoRoot: string,
  settings: IUnusedExportsSettings,
): Promise<{ files: string[]; cache: SourceCache }> {
  const files: string[] = [];
  const cache: SourceCache = new Map();
  const skip = walkSkipPatterns(settings);
  for await (
    const entry of walk(repoRoot, { includeDirs: false, exts: [".ts"], followSymlinks: false, skip })
  ) {
    const repoPath = entry.path.startsWith(repoRoot + "/") ? entry.path.slice(repoRoot.length + 1) : entry.path;
    if (isTestFilePath(repoPath, settings)) continue;
    if (!isProductionRoot(repoPath, settings)) continue;
    files.push(repoPath);
    cache.set(repoPath, { text: await Deno.readTextFile(entry.path), sourceFile: null });
  }
  return { files, cache };
}

function recordImport(name: string, repoPath: string, importMap: Map<string, Set<string>>): void {
  const importers = importMap.get(name) ?? new Set<string>();
  importers.add(repoPath);
  importMap.set(name, importers);
}

function parseImports(sourceFile: ts.SourceFile, repoPath: string, importMap: Map<string, Set<string>>): void {
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node) || !node.importClause) return;
    const clause = node.importClause;
    if (clause.name) recordImport(clause.name.text, repoPath, importMap);
    if (!clause.namedBindings) return;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      recordImport(clause.namedBindings.name.text, repoPath, importMap);
      return;
    }
    for (const el of clause.namedBindings.elements) {
      if (!el.isTypeOnly) recordImport(el.name.text, repoPath, importMap);
    }
  });
}

function recordExport(name: string, site: IExportSite, exportMap: Map<string, IExportSite[]>): void {
  const sites = exportMap.get(name) ?? [];
  sites.push(site);
  exportMap.set(name, sites);
}

function parseExports(
  sourceFile: ts.SourceFile,
  repoPath: string,
  exportMap: Map<string, IExportSite[]>,
  settings: IUnusedExportsSettings,
): void {
  ts.forEachChild(sourceFile, (node) => {
    const lineOf = (child: ts.Node): number => sourceFile.getLineAndCharacterOfPosition(child.getStart()).line + 1;
    if (isNamedReExport(node)) {
      for (const el of node.exportClause.elements) {
        recordExport(el.name.text, {
          repoPath,
          line: lineOf(el),
          isBarrelPassThrough: isPackageEntrypoint(repoPath, settings),
          isTypeDecl: false,
        }, exportMap);
      }
      return;
    }
    if (ts.isExportAssignment(node) || !hasExportModifier(node)) return;
    const name = getExportName(node);
    if (!name) return;
    recordExport(name, {
      repoPath,
      line: lineOf(node),
      isBarrelPassThrough: false,
      isTypeDecl: isIfaceOrType(node),
    }, exportMap);
  });
}

function findSourceByImport(cache: SourceCache, targetKey: string): ts.SourceFile | null {
  for (const [key, entry] of cache) {
    if (key.replace(/\.ts$/, "") === targetKey) return entry.sourceFile;
  }
  return null;
}

function resolveBarrelReExports(
  files: readonly string[],
  cache: SourceCache,
  exportMap: Map<string, IExportSite[]>,
  settings: IUnusedExportsSettings,
): void {
  for (const repoPath of files) {
    if (!isPackageEntrypoint(repoPath, settings)) continue;
    const sourceFile = cache.get(repoPath)?.sourceFile;
    if (!sourceFile) continue;
    ts.forEachChild(sourceFile, (node) => {
      if (!isWildcardReExport(node)) return;
      const targetPath = resolveImport(repoPath, node.moduleSpecifier.text);
      if (!targetPath) return;
      const targetSource = findSourceByImport(cache, targetPath.replace(/\.ts$/, ""));
      if (!targetSource) return;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const addBarrelEntry = (name: string, isType: boolean): void => {
        const sites = exportMap.get(name) ?? [];
        if (!sites.some((s) => s.repoPath === repoPath && s.isBarrelPassThrough)) {
          sites.push({ repoPath, line, isBarrelPassThrough: true, isTypeDecl: isType });
        }
        exportMap.set(name, sites);
      };
      ts.forEachChild(targetSource, (child) => {
        if (hasExportModifier(child)) {
          const name = getExportName(child);
          if (name) addBarrelEntry(name, isIfaceOrType(child));
        }
        if (isNamedReExport(child)) {
          for (const el of child.exportClause.elements) addBarrelEntry(el.name.text, false);
        }
      });
    });
  }
}

function collectPublicFiles(files: readonly string[], cache: SourceCache): Set<string> {
  const publicFiles = new Set<string>();
  for (const repoPath of files) {
    const entry = cache.get(repoPath);
    if (entry && hasPublicJSDoc(entry.text)) publicFiles.add(repoPath);
  }
  return publicFiles;
}

/** True when a strict-mode finding is a known dynamically-wired or naming-convention export. */
function isStrictExempt(
  site: IExportSite,
  name: string,
  hasBarrel: boolean,
  scriptImportedNames: Set<string>,
  settings: IUnusedExportsSettings,
): boolean {
  if (hasBarrel) return true;
  if (settings.strictSkipPrefixes.some((prefix) => site.repoPath.startsWith(prefix))) return true;
  if (settings.strictSkipSegments.some((segment) => site.repoPath.includes(segment))) return true;
  if (isPackageEntrypoint(site.repoPath, settings)) return true;
  if (name.startsWith("I") && name.length > 1 && name[1] === name[1]?.toUpperCase()) return true;
  if (isProviderMetadata(name) || isTestHelper(name) || isEntryPointName(name)) return true;
  if (isTestExport(name) || scriptImportedNames.has(name)) return true;
  return false;
}

function collectFindings(
  exportMap: Map<string, IExportSite[]>,
  importMap: Map<string, Set<string>>,
  publicFiles: Set<string>,
  scriptImportedNames: Set<string>,
  settings: IUnusedExportsSettings,
  strict: boolean,
): IUnwiredExport[] {
  const findings: IUnwiredExport[] = [];
  for (const [name, sites] of exportMap) {
    if (importMap.has(name)) continue;
    const nonTypeSites = sites.filter((s) => !s.isTypeDecl);
    if (nonTypeSites.length === 0) continue;
    const hasBarrel = sites.some((s) => s.isBarrelPassThrough);
    for (const site of nonTypeSites) {
      if (site.isBarrelPassThrough) continue;
      if (name.startsWith("I") && name.length > 1 && name[1] === name[1]?.toUpperCase()) continue;
      if (publicFiles.has(site.repoPath)) continue;
      if (isMainEntrypoint(site.repoPath, settings)) continue;
      if (strict && isStrictExempt(site, name, hasBarrel, scriptImportedNames, settings)) continue;
      findings.push({ repoPath: site.repoPath, line: site.line, name });
    }
  }
  return findings;
}

function rankDirectories(findings: readonly IUnwiredExport[]): Array<[string, number]> {
  const byDir = new Map<string, number>();
  for (const finding of findings) {
    const dir = finding.repoPath.split("/").slice(0, 2).join("/");
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  return [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

/** Walk a repository checkout and report its unwired exports. */
export async function checkRepository(
  repoRoot: string,
  strict: boolean,
  settings: IUnusedExportsSettings = WHOLE_TREE_SETTINGS.unusedExports,
): Promise<IUnusedExportsReport> {
  const { files, cache } = await collectProductionFiles(repoRoot, settings);
  const exportMap = new Map<string, IExportSite[]>();
  const importMap = new Map<string, Set<string>>();
  for (const repoPath of files) {
    const sourceFile = ts.createSourceFile(repoPath, cache.get(repoPath)!.text, ts.ScriptTarget.Latest, true);
    cache.get(repoPath)!.sourceFile = sourceFile;
    parseImports(sourceFile, repoPath, importMap);
    parseExports(sourceFile, repoPath, exportMap, settings);
  }
  resolveBarrelReExports(files, cache, exportMap, settings);
  const publicFiles = collectPublicFiles(files, cache);
  const scriptImportedNames = await collectScriptImportedNames(repoRoot, settings);
  const findings = collectFindings(exportMap, importMap, publicFiles, scriptImportedNames, settings, strict);
  return { strict, findings, topDirectories: strict ? [] : rankDirectories(findings) };
}
