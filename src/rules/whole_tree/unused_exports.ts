/**
 * @module WholeTreeUnusedExports
 * @path src/rules/whole_tree/unused_exports.ts
 * @description Finds exported declarations never imported by other production files.
 *   Whole-tree rule (TypeScript compiler API), moved from scripts/check_unused_exports.ts.
 * @architectural-layer Shared
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [src/rules/whole_tree/options.ts, src/cli/whole_tree.ts]
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, join, normalize } from "@std/path";
import type { IUnusedExportsSettings } from "./options.ts";
import { findUnusedClassMembers } from "./unused_class_members.ts";
import { findUnusedEnumMembers } from "./unused_enum_members.ts";
import {
  buildModuleGraph,
  findUnusedCandidates,
  type IModuleGraph,
  withoutImportersIn,
} from "./unused_exports_resolved.ts";

/** One exported declaration site. */
export interface IExportSite {
  readonly repoPath: string;
  readonly line: number;
  readonly isBarrelPassThrough: boolean;
  readonly isTypeDecl: boolean;
  readonly isInterface: boolean;
  readonly isConfigurable: boolean;
  readonly isTypeAlias: boolean;
  readonly isNamespace: boolean;
  readonly hasIgnorePragma: boolean;
}

/** How an unwired export finding is enforced. Type declarations stay warnings, so `--fail` leaves them alone. */
export type TUnwiredSeverity = "warning" | "error";

/** The enforcement the catalog leaves unset: type declarations warn, values and parity findings fail. */
const DEFAULT_SEVERITY = { type: "warning", value: "error", parity: "error" } as const;

/** Who uses a finding: no file, or only test files. */
export type TUsedBy = "nothing" | "tests";

const UNUSED: TUsedBy = "nothing";
const TESTS_ONLY: TUsedBy = "tests";

/** The declaration shape an unwired export finding comes from. */
export type TUnwiredKind =
  | "export"
  | "interface"
  | "type-alias"
  | "default"
  | "namespace"
  | "enum-member"
  | "class-member";

/** One unwired export. */
export interface IUnwiredExport {
  readonly repoPath: string;
  readonly line: number;
  readonly name: string;
  readonly severity: TUnwiredSeverity;
  readonly kind: TUnwiredKind;
  /** `nothing` when no file uses it. `tests` when only test files do, which the production mode reports. */
  readonly usedBy: TUsedBy;
}

/** The result of an unused-exports run. */
export interface IUnusedExportsReport {
  /** True when the report applies the trusted exemption set; false is the broad superset. */
  readonly includeExempt: boolean;
  readonly findings: readonly IUnwiredExport[];
  /** Directories ranked by finding count (relaxed mode only). */
  readonly topDirectories: readonly (readonly [string, number])[];
}

interface ISourceCacheEntry {
  text: string;
  sourceFile: ts.SourceFile | null;
}

type SourceCache = Map<string, ISourceCacheEntry>;

/** True for a test file. A segment such as `/tests/` also matches a directory at the repository root. */
function isTestFilePath(repoPath: string, settings: IUnusedExportsSettings): boolean {
  const rooted = `/${repoPath}`;
  return settings.testSegments.some((segment) => rooted.includes(segment)) ||
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
  if (
    ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)
  ) {
    return node.name?.text ?? null;
  }
  if (!ts.isVariableStatement(node)) return null;
  for (const decl of node.declarationList.declarations) {
    if (ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return null;
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!("modifiers" in node)) return false;
  const mods = (node as { modifiers?: ts.Modifier[] }).modifiers;
  return mods ? mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) : false;
}

/** True when the parity report scans the file: workspace roots and scripts, not fixtures or vendored trees. */
function isParityScanPath(repoPath: string, settings: IUnusedExportsSettings): boolean {
  if (repoPath.includes("/fixtures/")) return false;
  if (repoPath.startsWith(`${settings.scriptRoot}/`)) return true;
  return isProductionRoot(repoPath, settings);
}

function isIfaceOrType(node: ts.Node): boolean {
  return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
}

function isLocalExportList(node: ts.Node): node is ts.ExportDeclaration & {
  exportClause: ts.NamedExports;
} {
  return ts.isExportDeclaration(node) && node.moduleSpecifier === undefined && node.exportClause !== undefined &&
    ts.isNamedExports(node.exportClause);
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
async function collectScriptImportedNames(
  repoRoot: string,
  settings: IUnusedExportsSettings,
): Promise<Set<string>> {
  const names = new Set<string>();
  const skip = walkSkipPatterns(settings);
  try {
    for await (
      const entry of walk(join(repoRoot, settings.scriptRoot), { includeDirs: false, exts: [".ts"], skip })
    ) {
      const repoPath = entry.path.startsWith(repoRoot + "/") ? entry.path.slice(repoRoot.length + 1) : entry.path;
      if (isTestFilePath(repoPath, settings)) continue;
      const sourceFile = ts.createSourceFile(
        repoPath,
        await Deno.readTextFile(entry.path),
        ts.ScriptTarget.Latest,
        true,
      );
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
  } catch {
    // A checkout need not have a wiring-scripts root.
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
    files.push(repoPath);
    cache.set(repoPath, { text: await Deno.readTextFile(entry.path), sourceFile: null });
  }
  files.sort();
  return { files, cache };
}

function recordImport(name: string, repoPath: string, importMap: Map<string, Set<string>>): void {
  const importers = importMap.get(name) ?? new Set<string>();
  importers.add(repoPath);
  importMap.set(name, importers);
}

/** Records the names a destructured `await import("./m.ts")` binds. */
function recordDynamicImportNames(
  node: ts.VariableStatement,
  repoPath: string,
  importMap: Map<string, Set<string>>,
  moduleVariables: ReadonlySet<string>,
): void {
  for (const declaration of node.declarationList.declarations) {
    const initializer = declaration.initializer;
    if (!initializer) continue;
    const fromImport = importsModule(initializer);
    const moduleIdentifier = moduleIdentifierOf(initializer);
    const fromModuleVariable = moduleIdentifier !== null && moduleVariables.has(moduleIdentifier.text);
    if (!fromImport && !fromModuleVariable) continue;
    if (!ts.isObjectBindingPattern(declaration.name)) continue;
    for (const element of declaration.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const imported = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
      recordImport(imported, repoPath, importMap);
    }
  }
}

/** True when the expression calls the dynamic `import()` form. */
function isDynamicImportCall(call: ts.Expression): boolean {
  return ts.isCallExpression(call) && call.expression.kind === ts.SyntaxKind.ImportKeyword;
}

/** True when the initializer is `import("./m.ts")` or `await import("./m.ts")`. */
function importsModule(initializer: ts.Expression): boolean {
  return isDynamicImportCall(initializer) ||
    (ts.isAwaitExpression(initializer) && isDynamicImportCall(initializer.expression));
}

/** The module object identifier an initializer holds, directly or after an await. */
function moduleIdentifierOf(initializer: ts.Expression): ts.Identifier | null {
  if (ts.isIdentifier(initializer)) return initializer;
  if (ts.isAwaitExpression(initializer) && ts.isIdentifier(initializer.expression)) return initializer.expression;
  return null;
}

/** The variables a file binds to a whole `await import("./m.ts")` module object. */
function collectDynamicImportVariables(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (!initializer) continue;
        if (ts.isIdentifier(declaration.name) && importsModule(initializer)) names.add(declaration.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function parseImports(
  sourceFile: ts.SourceFile,
  repoPath: string,
  importMap: Map<string, Set<string>>,
): void {
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) recordImport(clause.name.text, repoPath, importMap);
      if (!clause.namedBindings) return;
      if (ts.isNamespaceImport(clause.namedBindings)) {
        const namespaceName = clause.namedBindings.name.text;
        recordImport(namespaceName, repoPath, importMap);
        for (const member of sourceFile.text.matchAll(new RegExp(`\\b${namespaceName}\\.([A-Za-z_$][\\w$]*)`, "g"))) {
          recordImport(member[1], repoPath, importMap);
        }
        return;
      }
      for (const el of clause.namedBindings.elements) {
        recordImport(el.propertyName?.text ?? el.name.text, repoPath, importMap);
      }
      return;
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) {
        recordImport(el.propertyName?.text ?? el.name.text, repoPath, importMap);
      }
    }
  });
  recordNestedDynamicImports(sourceFile, repoPath, importMap);
}

/** Records destructured dynamic imports at any depth, including inside a conditional block. */
function recordNestedDynamicImports(
  sourceFile: ts.SourceFile,
  repoPath: string,
  importMap: Map<string, Set<string>>,
): void {
  const moduleVariables = collectDynamicImportVariables(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) recordDynamicImportNames(node, repoPath, importMap, moduleVariables);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const IGNORE_NEXT_LINE = /unslop-ignore-next-line\s+unused-(?:type|interface|export)\b/;

/** True when the declaration carries the exclusion pragma on the line above it. */
function hasIgnorePragma(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  const text = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  return ranges.some((range) => IGNORE_NEXT_LINE.test(text.slice(range.pos, range.end)));
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
  parity: boolean,
): void {
  ts.forEachChild(sourceFile, (node) => {
    const lineOf = (child: ts.Node): number => sourceFile.getLineAndCharacterOfPosition(child.getStart()).line + 1;
    if (isLocalExportList(node)) {
      for (const el of node.exportClause.elements) {
        recordExport(el.name.text, {
          repoPath,
          line: lineOf(el),
          isBarrelPassThrough: false,
          isTypeDecl: false,
          isInterface: false,
          isConfigurable: false,
          isTypeAlias: false,
          isNamespace: false,
          hasIgnorePragma: hasIgnorePragma(sourceFile, node),
        }, exportMap);
      }
      return;
    }
    if (isNamedReExport(node)) {
      for (const el of node.exportClause.elements) {
        recordExport(el.name.text, {
          repoPath,
          line: lineOf(el),
          isBarrelPassThrough: !parity && isPackageEntrypoint(repoPath, settings),
          isTypeDecl: false,
          isInterface: false,
          isConfigurable: false,
          isTypeAlias: false,
          isNamespace: false,
          hasIgnorePragma: hasIgnorePragma(sourceFile, el),
        }, exportMap);
      }
      return;
    }
    if (ts.isExportAssignment(node)) {
      if (!parity) return;
      recordExport("default", {
        repoPath,
        line: lineOf(node),
        isBarrelPassThrough: false,
        isTypeDecl: false,
        isInterface: false,
        isConfigurable: false,
        isTypeAlias: false,
        isNamespace: false,
        hasIgnorePragma: hasIgnorePragma(sourceFile, node),
      }, exportMap);
      return;
    }
    if (!hasExportModifier(node)) return;
    const declared = getExportName(node);
    const isDefault = parity && hasDefaultModifier(node);
    const name = isDefault ? "default" : declared;
    if (!name) return;
    recordExport(name, {
      repoPath,
      line: lineOf(node),
      isBarrelPassThrough: false,
      isTypeDecl: isIfaceOrType(node),
      isInterface: ts.isInterfaceDeclaration(node),
      isConfigurable: isConfigurableRegistration(node, sourceFile),
      isTypeAlias: ts.isTypeAliasDeclaration(node),
      isNamespace: ts.isModuleDeclaration(node),
      hasIgnorePragma: hasIgnorePragma(sourceFile, node),
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
          sites.push({
            repoPath,
            line,
            isBarrelPassThrough: true,
            isTypeDecl: isType,
            isInterface: false,
            isConfigurable: false,
            isTypeAlias: false,
            isNamespace: false,
            hasIgnorePragma: false,
          });
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

function isInterfaceName(name: string): boolean {
  return name.startsWith("I") && name.length > 1 && name[1] === name[1]?.toUpperCase();
}

function isSkippedPath(repoPath: string, settings: IUnusedExportsSettings): boolean {
  return settings.strictSkipPrefixes.some((prefix) => repoPath.startsWith(prefix)) ||
    settings.strictSkipSegments.some((segment) => repoPath.includes(segment));
}

/** An interface finding survives unless a pragma, a public tag, or an entry-point rule exempts it. */
function isInterfaceFinding(
  site: IExportSite,
  name: string,
  scriptImportedNames: Set<string>,
  settings: IUnusedExportsSettings,
): boolean {
  if (site.hasIgnorePragma) return false;
  if (isPackageEntrypoint(site.repoPath, settings)) return false;
  if (isSkippedPath(site.repoPath, settings)) return false;
  return !scriptImportedNames.has(name);
}

/** True when every initializer of the declaration is a `configurable(…)` registration. */
function isConfigurableRegistration(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  if (!ts.isVariableStatement(node)) return false;
  return node.declarationList.declarations.every((declaration) =>
    declaration.initializer !== undefined && declaration.initializer.getText(sourceFile).includes("configurable(")
  );
}

function isValueFinding(
  site: IExportSite,
  name: string,
  hasBarrel: boolean,
  publicFiles: Set<string>,
  scriptImportedNames: Set<string>,
  settings: IUnusedExportsSettings,
  includeExempt: boolean,
): boolean {
  if (site.isConfigurable) return false;
  if (site.hasIgnorePragma) return false;
  if (site.isTypeDecl) return false;
  if (isInterfaceName(name)) return false;
  if (publicFiles.has(site.repoPath)) return false;
  if (isMainEntrypoint(site.repoPath, settings)) return false;
  return !(includeExempt && isStrictExempt(site, name, hasBarrel, scriptImportedNames, settings));
}

/** The finding kind a site declares, used by the parity report. */
function kindOfSite(site: IExportSite, name: string): TUnwiredKind {
  if (site.isInterface) return "interface";
  if (site.isTypeAlias) return "type-alias";
  if (site.isNamespace) return "namespace";
  return name === "default" ? "default" : "export";
}

function collectFindings(
  exportMap: Map<string, IExportSite[]>,
  importMap: Map<string, Set<string>>,
  publicFiles: Set<string>,
  scriptImportedNames: Set<string>,
  settings: IUnusedExportsSettings,
  includeExempt: boolean,
): IUnwiredExport[] {
  const findings: IUnwiredExport[] = [];
  for (const [name, sites] of exportMap) {
    if (importMap.has(name)) continue;
    const hasBarrel = sites.some((site) => site.isBarrelPassThrough);
    for (const site of sites) {
      if (site.isBarrelPassThrough) continue;
      if (isTestExport(name)) continue;
      if (site.isInterface || site.isTypeAlias) {
        if (isInterfaceFinding(site, name, scriptImportedNames, settings)) {
          findings.push({
            repoPath: site.repoPath,
            line: site.line,
            name,
            severity: settings.severity?.type ?? DEFAULT_SEVERITY.type,
            kind: site.isInterface ? "interface" : "type-alias",
            usedBy: UNUSED,
          });
        }
        continue;
      }
      if (isValueFinding(site, name, hasBarrel, publicFiles, scriptImportedNames, settings, includeExempt)) {
        findings.push({
          repoPath: site.repoPath,
          line: site.line,
          name,
          severity: settings.severity?.value ?? DEFAULT_SEVERITY.value,
          kind: "export",
          usedBy: UNUSED,
        });
      }
    }
  }
  return findings;
}

/** One export site of the parity scan, with the declaration facts the finding needs. */
interface IParitySite {
  readonly name: string;
  readonly site: IExportSite;
}

/** True when the statement mentions the identifier anywhere inside it. */
function mentions(statement: ts.Node, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

/**
 * True when an exported declaration other than the type's own names the type. Such a type is part of that
 * declaration's API: removing its export would leave a private type in a public signature.
 */
function isNamedByOtherExport(sourceFile: ts.SourceFile, name: string): boolean {
  const owners = sourceFile.statements.filter((statement) => hasExportModifier(statement) && mentions(statement, name));
  return owners.length >= 2;
}

/** The optional reports and modes of the parity run. Each one is advisory and needs `--parity`. */
export interface IParityOptions {
  readonly enumMembers: boolean;
  readonly classMembers: boolean;
  /** Test files are not sources of uses, and a finding says whether only tests use it. */
  readonly production: boolean;
}

const NO_PARITY_OPTIONS: IParityOptions = { enumMembers: false, classMembers: false, production: false };

/** Everything one parity pass reads: the walk, the declared sites, the settings, and the options. */
interface IParityContext {
  readonly graph: IModuleGraph;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  readonly sites: ReadonlyMap<string, IParitySite>;
  readonly settings: IUnusedExportsSettings;
  readonly options: IParityOptions;
}

/** The enum member and class member findings that the options ask for, over the given sources. */
function memberFindings(
  context: IParityContext,
  graph: IModuleGraph,
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  isScanned: (repoPath: string) => boolean,
): IUnwiredExport[] {
  const severity = context.settings.severity?.parity ?? DEFAULT_SEVERITY.parity;
  const input = { graph, sourceFiles, isScanned };
  const enums = context.options.enumMembers ? findUnusedEnumMembers(input) : [];
  const classes = context.options.classMembers ? findUnusedClassMembers(input) : [];
  return [
    ...enums.map((member): IUnwiredExport => ({
      repoPath: member.repoPath,
      line: member.line,
      name: `${member.enumName}.${member.member}`,
      severity,
      kind: "enum-member",
      usedBy: UNUSED,
    })),
    ...classes.map((member): IUnwiredExport => ({
      repoPath: member.repoPath,
      line: member.line,
      name: `${member.className}.${member.member}`,
      severity,
      kind: "class-member",
      usedBy: UNUSED,
    })),
  ];
}

/** The export findings over the given graph, for the sites that `isScanned` accepts. */
function exportFindings(
  context: IParityContext,
  graph: IModuleGraph,
  isScanned: (repoPath: string) => boolean,
): IUnwiredExport[] {
  const severity = context.settings.severity?.parity ?? DEFAULT_SEVERITY.parity;
  const scanned = [...context.sites.values()].filter(({ site }) => isScanned(site.repoPath));
  const unused = findUnusedCandidates(graph, scanned.map(({ name, site }) => ({ repoPath: site.repoPath, name })));
  const findings: IUnwiredExport[] = [];
  for (const { repoPath, name } of unused) {
    const { site } = context.sites.get(`${repoPath}\0${name}`)!;
    if (site.isTypeDecl && isNamedByOtherExport(context.sourceFiles.get(repoPath)!, name)) continue;
    findings.push({ repoPath, line: site.line, name, severity, kind: kindOfSite(site, name), usedBy: UNUSED });
  }
  return findings;
}

/** One parity pass: with `production`, test files neither define the scanned sites nor use them. */
function parityPass(context: IParityContext, production: boolean): IUnwiredExport[] {
  const isTest = (repoPath: string): boolean => isTestFilePath(repoPath, context.settings);
  const isScanned = (repoPath: string): boolean =>
    isParityScanPath(repoPath, context.settings) && !(production && isTest(repoPath));
  const graph = production ? withoutImportersIn(context.graph, isTest) : context.graph;
  const sourceFiles = production
    ? new Map([...context.sourceFiles].filter(([repoPath]) => !isTest(repoPath)))
    : context.sourceFiles;
  return [...exportFindings(context, graph, isScanned), ...memberFindings(context, graph, sourceFiles, isScanned)];
}

function findingKey(finding: IUnwiredExport): string {
  return `${finding.repoPath}\0${finding.kind}\0${finding.name}`;
}

function byLocation(left: IUnwiredExport, right: IUnwiredExport): number {
  return left.repoPath.localeCompare(right.repoPath) || left.line - right.line || left.name.localeCompare(right.name);
}

/** Fallow-parity findings: an export site is unwired when no import resolves to that module and name. */
async function resolvedParityFindings(
  repoRoot: string,
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  exportMap: ReadonlyMap<string, readonly IExportSite[]>,
  settings: IUnusedExportsSettings,
  options: IParityOptions,
): Promise<IUnwiredExport[]> {
  const sites = new Map<string, IParitySite>();
  for (const [name, declared] of exportMap) {
    if (isTestExport(name)) continue;
    for (const site of declared) {
      const key = `${site.repoPath}\0${name}`;
      if (!site.isConfigurable && !site.hasIgnorePragma && !sites.has(key)) sites.set(key, { name, site });
    }
  }
  const graph = await buildModuleGraph({
    repoRoot,
    sourceFiles,
    walkSkipPatterns: settings.walkSkipPatterns,
    publicEntries: settings.publicEntries ?? [],
  });
  const context: IParityContext = { graph, sourceFiles, sites, settings, options };
  if (!options.production) return parityPass(context, false).sort(byLocation);
  const unusedAnywhere = new Set(parityPass(context, false).map(findingKey));
  return parityPass(context, true).map((finding): IUnwiredExport =>
    unusedAnywhere.has(findingKey(finding)) ? finding : { ...finding, usedBy: TESTS_ONLY }
  ).sort(byLocation);
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
  includeExempt: boolean,
  settings: IUnusedExportsSettings,
  parity = false,
  options: IParityOptions = NO_PARITY_OPTIONS,
): Promise<IUnusedExportsReport> {
  const { files, cache } = await collectProductionFiles(repoRoot, settings);
  const exportMap = new Map<string, IExportSite[]>();
  const importMap = new Map<string, Set<string>>();
  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const repoPath of files) {
    const sourceFile = ts.createSourceFile(repoPath, cache.get(repoPath)!.text, ts.ScriptTarget.Latest, true);
    cache.get(repoPath)!.sourceFile = sourceFile;
    sourceFiles.set(repoPath, sourceFile);
    if (!parity) parseImports(sourceFile, repoPath, importMap);
    const scanExports = parity
      ? isParityScanPath(repoPath, settings)
      : !isTestFilePath(repoPath, settings) && isProductionRoot(repoPath, settings);
    if (scanExports) parseExports(sourceFile, repoPath, exportMap, settings, parity);
  }
  if (parity) {
    const findings = await resolvedParityFindings(repoRoot, sourceFiles, exportMap, settings, options);
    return { includeExempt, findings, topDirectories: [] };
  }
  resolveBarrelReExports(files, cache, exportMap, settings);
  const publicFiles = collectPublicFiles(files, cache);
  const scriptImportedNames = await collectScriptImportedNames(repoRoot, settings);
  const findings = collectFindings(
    exportMap,
    importMap,
    publicFiles,
    scriptImportedNames,
    settings,
    includeExempt,
  );
  return { includeExempt, findings, topDirectories: includeExempt ? [] : rankDirectories(findings) };
}
