#!/usr/bin/env -S deno run -A
/**
 * @module CheckCodeStyle
 * @path packages/lint-rules/src/exaix/check_code_style.ts
 * @description Scans all .ts and .tsx files for code style violations defined in CODE_STYLE.md.
 * @architectural-layer Tooling
 * @dependencies [typescript, @std/fs, @std/path, zod, @exaix/lint-rules]
 * @related-files [packages/lint-rules/mod.ts, packages/lint-rules/src/exaix/check_magic_values.ts]
 *
 * Usage:
 *   deno run -A packages/lint-rules/src/exaix/check_code_style.ts [path] [--root=<dir>]
 *
 * The repository root comes from `--root=` or the working directory. Run it from the
 * repository root, as the `check:style` task does.
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, globToRegExp, join, normalize, relative } from "@std/path";
import { z } from "zod";
import {
  classifyPath,
  type ICatalog,
  type JsonValue,
  parseCatalog,
  type PathClass,
  ruleSettings,
  type ScriptRuleSchemas,
} from "@exaix/lint-rules";
import styleRuleCatalog from "../../../../scripts/config/style_rule_catalog.json" with { type: "json" };
import {
  escapeRegExp,
  LAYOUT,
  RE_PACKAGE_NAME_CAPTURE,
  RE_PACKAGE_ROOT_ENTRYPOINT,
  RE_PACKAGE_SRC_CAPTURE,
  RE_PACKAGE_TEST_HELPERS,
  RE_PACKAGE_TESTS_CAPTURE,
} from "./repo_layout.ts";

/** Resolves the repository root from `--root=` or the working directory. */
function resolveRepoRoot(): string {
  const rootArg = Deno.args.find((arg) => arg.startsWith("--root="));
  return rootArg ? normalize(rootArg.slice("--root=".length)) : normalize(Deno.cwd());
}

const REPO_ROOT = resolveRepoRoot();

/** Option schemas for the script rules that read catalog options. */
const SCRIPT_RULE_SCHEMAS: ScriptRuleSchemas = {
  "max-params": z.object({ max: z.number().int().positive().default(7) }).strict(),
  "duplicate-type": z.object({
    minProperties: z.number().int().positive().default(2),
    allow: z.array(
      z.object({ name: z.string(), files: z.array(z.string()), reason: z.string() }).strict(),
    ).default([]),
  }).strict(),
  "long-comment": z.object({ maxLines: z.number().int().positive().default(3) }).strict(),
  "test-inline-multiline-fixture": z.object({ minLines: z.number().int().positive().default(7) }).strict(),
  "edition-leak": z.object({
    soloTier: z.number().int().default(0),
    teamTier: z.number().int().default(1),
    enterpriseTier: z.number().int().default(2),
    soloPrefixes: z.array(z.string()).default([LAYOUT.packageRoot, LAYOUT.appRoot]),
    teamPrefixes: z.array(z.string()).default([LAYOUT.teamRoot]),
    enterprisePrefixes: z.array(z.string()).default([LAYOUT.enterpriseRoot]),
    teamAppPaths: z.array(z.string()).default([LAYOUT.teamAppBootstrap]),
  }).strict(),
};

const CATALOG: ICatalog = parseCatalog(styleRuleCatalog, { scriptRuleSchemas: SCRIPT_RULE_SCHEMAS });

/** Classifies a repository-relative path with the shared catalog scopes. */
export function classifyRepoPath(repoPath: string): PathClass {
  return classifyPath(repoPath, CATALOG.scopes);
}

interface ITypeUnit {
  readonly path: string;
  readonly text: string;
}

interface ITypeAllowEntry {
  readonly name: string;
  readonly files: readonly string[];
  readonly reason: string;
}

interface IDuplicateTypeOptions {
  readonly minProperties?: number;
  readonly allow?: readonly ITypeAllowEntry[];
}

interface IDuplicateType {
  readonly name: string;
  readonly firstFile: string;
  readonly laterFile: string;
}

interface ITypeShape {
  readonly name: string;
  readonly members: string[];
}

const DEFAULT_MIN_PROPERTIES = 2;
const GROUP_SEPARATOR = "\u0000";
const MEMBER_SEPARATOR = "\u0001";

/** Whitespace-normalized text for one type member. */
function memberSignature(member: ts.TypeElement): string {
  return member.getText().replace(/\s+/g, " ").trim();
}

function canonicalMembers(members: readonly string[]): string {
  return [...members].sort().join(MEMBER_SEPARATOR);
}

/** The name and member signatures of an interface or object type alias, or null. */
function typeShapeOf(statement: ts.Statement): ITypeShape | null {
  if (ts.isInterfaceDeclaration(statement)) {
    return { name: statement.name.text, members: statement.members.map(memberSignature) };
  }
  if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
    return { name: statement.name.text, members: statement.type.members.map(memberSignature) };
  }
  return null;
}

/** The `interface NAME` / `type NAME = { ... }` member sets at the top level of a unit. */
function topLevelTypes(unit: ITypeUnit, minProperties: number): Map<string, string> {
  const result = new Map<string, string>();
  const source = ts.createSourceFile(unit.path, unit.text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    const shape = typeShapeOf(statement);
    if (shape === null || shape.members.length < minProperties) continue;
    result.set(shape.name, canonicalMembers(shape.members));
  }
  return result;
}

function groupTypes(units: readonly ITypeUnit[], minProperties: number): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const unit of units) {
    for (const [name, signature] of topLevelTypes(unit, minProperties)) {
      const key = `${name}${GROUP_SEPARATOR}${signature}`;
      const files = groups.get(key) ?? [];
      if (!files.includes(unit.path)) files.push(unit.path);
      groups.set(key, files);
    }
  }
  return groups;
}

/** Duplicate `interface`/object-type members with the same name across separate files. */
export function findDuplicateTypes(
  units: readonly ITypeUnit[],
  options: IDuplicateTypeOptions,
): IDuplicateType[] {
  const minProperties = options.minProperties ?? DEFAULT_MIN_PROPERTIES;
  const allow = options.allow ?? [];
  const groups = groupTypes(units, minProperties);

  const duplicates: IDuplicateType[] = [];
  for (const [key, files] of groups) {
    if (files.length < 2) continue;
    const [name] = key.split(GROUP_SEPARATOR);
    const sorted = [...files].sort();
    const first = sorted[0];
    for (const later of sorted.slice(1)) {
      const allowed = allow.some((entry) =>
        entry.name === name && entry.files.includes(first) && entry.files.includes(later)
      );
      if (!allowed) duplicates.push({ name, firstFile: first, laterFile: later });
    }
  }
  return duplicates;
}

/** Names allow entries that no longer match a current duplicate. */
export function validateTypeAllowEntries(
  units: readonly ITypeUnit[],
  options: IDuplicateTypeOptions,
): string[] {
  const minProperties = options.minProperties ?? DEFAULT_MIN_PROPERTIES;
  const groups = groupTypes(units, minProperties);
  const stale: string[] = [];
  for (const entry of options.allow ?? []) {
    const matches = [...groups.entries()].some(([key, files]) =>
      key.split(GROUP_SEPARATOR)[0] === entry.name &&
      entry.files.every((file) => files.includes(file)) &&
      files.length >= 2
    );
    if (!matches) stale.push(entry.name);
  }
  return stale;
}

/** `style-exclude:CODE` reasons, read from each rule's `exclusionCodes` catalog entry. */
const exclusionDict: Record<string, Record<string, { reason: string }>> = Object.fromEntries(
  Object.entries(CATALOG.rules)
    .filter(([, entry]) => entry.exclusionCodes)
    .map(([id, entry]) => [
      id,
      Object.fromEntries(
        Object.entries(entry.exclusionCodes ?? {}).map(([code, reason]) => [code, { reason }]),
      ),
    ]),
);

/** Walker skip list, from the catalog `ignore` globs (each carries a reason). */
const IGNORE_GLOBS = (CATALOG.ignore ?? []).map((entry) =>
  globToRegExp(entry.glob, { extended: true, globstar: true })
);

const GLOB_CACHE = new Map<string, RegExp>();

function globRegex(glob: string): RegExp {
  let regex = GLOB_CACHE.get(glob);
  if (!regex) {
    regex = globToRegExp(glob, { extended: true, globstar: true });
    GLOB_CACHE.set(glob, regex);
  }
  return regex;
}

function matchesAnyGlob(repoPath: string, globs: string[]): boolean {
  return globs.some((glob) => globRegex(glob).test(repoPath));
}

/** Resolves a rule's effective severity for a path, or null when the rule does not apply. */
function ruleEnabled(catalog: ICatalog, ruleName: string, repoPath: string): "error" | "warn" | null {
  const settings = ruleSettings(catalog, ruleName);
  if (settings.severity === "off") return null;
  const pathClass = classifyPath(repoPath, catalog.scopes);
  if (pathClass === "fixture") return null;
  if (settings.scope === "test" && pathClass !== "test") return null;
  if (settings.scope === "prod" && pathClass !== "prod") return null;
  if (settings.include && !matchesAnyGlob(repoPath, settings.include)) return null;
  if (settings.exclude && matchesAnyGlob(repoPath, settings.exclude)) return null;
  if (settings.severity === "warn" && ruleName === "dynamic-import" && strictImports) return "error";
  return settings.severity;
}

interface Rule {
  name: string;
  regex: RegExp;
  message: string;
}

interface ITestingShimExportInfo {
  alias: string;
  exportedNames: Set<string>;
}

interface IPublicPackageAlias {
  alias: string;
  entryPath: string;
  rootPath: string;
  packageRoot: string;
}

const ROOT_OWNED_PARENT_EXPORT_ALIASES = new Set([
  "@exaix/core/types",
]);

const RETIRED_ROOT_HEADER_RELATED_FILES = new Set([
  ...LAYOUT.retiredRootHeaderRelatedFiles,
]);

const RETIRED_ROOT_PACKAGE_IMPORT_PATHS = new Set([
  ...LAYOUT.retiredRootImportPaths,
]);

function isPackageEntrypoint(path: string): boolean {
  return path.endsWith("/mod.ts") || path.endsWith("/index.ts");
}

function isPackageRootEntrypoint(path: string): boolean {
  return RE_PACKAGE_ROOT_ENTRYPOINT.test(path);
}

function isSamePackageReExport(line: string): boolean {
  const match = line.match(/from\s+["']([^"']+)["']/);
  return !!match && match[1].startsWith("./");
}

function isTestingCompatibilityShim(path: string): boolean {
  return path.startsWith(LAYOUT.rootTestHelpers) || RE_PACKAGE_TEST_HELPERS.test(path);
}

function parseHeaderRelatedFiles(headerText: string): string[] {
  const match = headerText.match(/@related-files\s*\[([\s\S]*?)\]/);
  if (!match) {
    return [];
  }

  return match[1].split(",")
    .map((entry) => entry.trim())
    .map((entry) => entry.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function parseNamedSymbols(clause: string): string[] {
  return clause.split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .map((symbol) => symbol.replace(/^type\s+/, ""))
    .map((symbol) => symbol.split(/\s+as\s+/)[0]?.trim() ?? "")
    .filter(Boolean);
}

function isRepoRelativeSpecifier(specifier: string): boolean {
  return !/^[a-z]+:/i.test(specifier) && !specifier.startsWith("//");
}

/** True when repoPath is a functional, deployable production module (not a test file). */
function isProductionModulePath(repoPath: string): boolean {
  const isProductionRoot = repoPath.startsWith(LAYOUT.packageRoot) ||
    repoPath.startsWith(LAYOUT.teamRoot) ||
    repoPath.startsWith(LAYOUT.appRoot);
  const isTestFile = repoPath.includes(LAYOUT.testsSegment) ||
    repoPath.endsWith("_test.ts") ||
    repoPath.endsWith(".test.ts");
  // Test-infrastructure modules are NOT deployable production code: the @exaix/testing
  // package and any `*/testing/` compatibility shim exist to provide test helpers and may
  // legitimately bridge to tests/. They never ship in a production deploy.
  const isTestInfra = repoPath.startsWith(LAYOUT.testingPackageRoot) ||
    repoPath.includes(LAYOUT.testingSegment);
  return isProductionRoot && !isTestFile && !isTestInfra;
}

/**
 * True when a production module (packages/, exaix-team/, apps/) imports from the
 * root tests/ folder. Functional deployable modules must not depend on test code: it
 * is excluded from a deployed workspace, so such an import breaks the deployed
 * exactl/daemon at module load. This is the EvalSqliteStore-under-tests/ layering bug.
 * Test files are exempt — they may import test helpers/fixtures.
 */
export function isProductionToTestsImport(repoPath: string, specifier: string): boolean {
  if (!isProductionModulePath(repoPath)) return false;
  if (!isRepoRelativeSpecifier(specifier)) return false; // bare alias / URL — not a tests/ path
  // Resolve the specifier against the importing file's directory; flag if it lands in tests/.
  const resolved = specifier.startsWith(".") ? normalize(join(dirname(repoPath), specifier)) : specifier;
  return resolved === "tests" || resolved.startsWith(LAYOUT.testsRoot);
}

/** How many preceding source lines to scan for the enclosing `editionType` guard. */
const EDITION_GUARD_LOOKBACK_LINES = 12;

/** A dynamic import of @exaix-team/* or the daemon's bootstrap_team module. */
function isTeamDynamicImportLine(line: string): boolean {
  return /\bimport\s*\(\s*["'](@exaix-team\/|\.\/src\/bootstrap_team)/.test(line);
}

/** True when the import sits in one of the two sanctioned edition-dispatch entry points —
 *  including their Team-edition counterparts under exaix-team/, which are the same dispatch
 *  mechanism for the Team app and carry the same edition-gated dynamic `@exaix-team/*` import. */
function isEditionDispatchEntry(repoPath: string): boolean {
  return LAYOUT.editionAppPrefixes.some((prefix) => repoPath.startsWith(prefix));
}

/**
 * True when an `editionType` guard (`editionType === EDITION_TEAM` / `!== EDITION_SOLO`)
 * appears within the preceding-lines window — proof the dynamic import is reached only in a
 * non-Solo run, not loaded unconditionally at module scope.
 */
function precededByEditionGuard(precedingLines: string[]): boolean {
  const window = precedingLines.slice(-EDITION_GUARD_LOOKBACK_LINES);
  return window.some((l) => /\beditionType\s*(?:===?|!==?)\s*EDITION_/.test(l));
}

/**
 * Shape check (line-only): a dynamic Team import in a dispatch entry. Used by the
 * dynamic-import / import-inside-statement STYLE exemptions, which only need to recognise
 * the sanctioned shape — the stricter edition-guard check below governs the edition-leak rule.
 */
function isEditionGatedTeamDynamicImport(repoPath: string, line: string): boolean {
  return isEditionDispatchEntry(repoPath) && isTeamDynamicImportLine(line);
}

/**
 * True for a genuinely edition-gated dynamic Team import: it is in a dispatch entry, is a
 * dynamic `import("@exaix-team/...")`, AND is preceded by an `editionType` guard. This is
 * the ONLY allowed upper-edition value reference in lower-edition source — a Solo source-run
 * never executes it, so the Team module is never loaded and the deploy can omit exaix-team/.
 * (A dynamic import without an edition guard would load Team code even in Solo — the hole this
 * closes; `deno compile` bundles it either way, which is why the deploy ships source, not a
 * compiled binary — see dev/Exaix_Edition_Architecture.md.)
 */
function isGuardedEditionDynamicImport(repoPath: string, line: string, precedingLines: string[]): boolean {
  return isEditionDispatchEntry(repoPath) &&
    isTeamDynamicImportLine(line) &&
    precededByEditionGuard(precedingLines);
}

/** Edition tier prefixes, read from the `edition-leak` catalog entry. */
interface IEditionTiers {
  readonly soloTier: number;
  readonly teamTier: number;
  readonly enterpriseTier: number;
  readonly soloPrefixes: string[];
  readonly teamPrefixes: string[];
  readonly enterprisePrefixes: string[];
  readonly teamAppPaths: string[];
}

function stringListOption(value: JsonValue, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : fallback;
}

const EDITION_TIER_OPTIONS = ruleSettings(CATALOG, "edition-leak").options;

export const EDITION_TIERS: IEditionTiers = {
  soloTier: Number(EDITION_TIER_OPTIONS.soloTier ?? 0),
  teamTier: Number(EDITION_TIER_OPTIONS.teamTier ?? 1),
  enterpriseTier: Number(EDITION_TIER_OPTIONS.enterpriseTier ?? 2),
  soloPrefixes: stringListOption(EDITION_TIER_OPTIONS.soloPrefixes, [LAYOUT.packageRoot, LAYOUT.appRoot]),
  teamPrefixes: stringListOption(EDITION_TIER_OPTIONS.teamPrefixes, [LAYOUT.teamRoot]),
  enterprisePrefixes: stringListOption(EDITION_TIER_OPTIONS.enterprisePrefixes, [LAYOUT.enterpriseRoot]),
  teamAppPaths: stringListOption(EDITION_TIER_OPTIONS.teamAppPaths, [LAYOUT.teamAppBootstrap]),
};

/**
 * Edition tier of a repo path. Higher number = higher (more restricted) tier.
 * `tiers` comes from the catalog's `edition-leak` options, so callers share one source.
 */
export function editionTierOfPath(repoPath: string, tiers: IEditionTiers): number | null {
  if (tiers.enterprisePrefixes.some((prefix) => repoPath.startsWith(prefix))) return tiers.enterpriseTier;
  if (tiers.teamPrefixes.some((prefix) => repoPath.startsWith(prefix))) return tiers.teamTier;
  if (tiers.teamAppPaths.some((prefix) => repoPath === prefix || repoPath.startsWith(prefix))) return tiers.teamTier;
  if (tiers.soloPrefixes.some((prefix) => repoPath.startsWith(prefix))) return tiers.soloTier;
  return null; // scripts/, tests/, etc. — not an edition-tiered module
}

/** Edition tier of an import specifier, or null when it is not edition-tiered. */
function editionTierOfSpecifier(specifier: string): number | null {
  if (/(^|\/)exaix-enterprise(\/|$)|^@exaix-enterprise(\/|$)/.test(specifier)) {
    return EDITION_TIERS.enterpriseTier;
  }
  if (/(^|\/)exaix-team(\/|$)|^@exaix-team(\/|$)/.test(specifier)) {
    return EDITION_TIERS.teamTier;
  }
  return null;
}

/**
 * True when a module imports from a HIGHER edition tier than its own — the edition leak
 * that couples a lower edition's source/build to code shipped or licensed separately
 * (e.g. a Solo app importing BSL Team code → the Team-into-Solo deploy/bundle leak).
 * Tiers: Solo (packages/, apps/) < Team (exaix-team/) < Enterprise (exaix-enterprise/).
 *
 * Exemptions: test files (integration tests may exercise higher tiers); type-only imports
 * (erased at compile, so they never enter a build); and the single sanctioned exception —
 * a GENUINELY edition-gated dynamic `await import("@exaix-team/...")` in a dispatch entry,
 * i.e. one preceded by an `editionType` guard (see `isGuardedEditionDynamicImport`). A
 * dynamic import without an edition guard is NOT exempt — it would load Team code even in a
 * Solo run. `precedingLines` is the source lines above `line`, used to verify the guard.
 */
export function isEditionLeakImport(
  repoPath: string,
  line: string,
  precedingLines: string[] = [],
): boolean {
  const sourceTier = editionTierOfPath(repoPath, EDITION_TIERS);
  if (sourceTier === null) return false;
  if (
    repoPath.includes(LAYOUT.testsSegment) ||
    repoPath.includes(LAYOUT.testingSegment) ||
    repoPath.endsWith("_test.ts") ||
    repoPath.endsWith(".test.ts")
  ) {
    return false;
  }
  // type-only imports are erased at compile time and never enter a bundle.
  if (/^\s*import\s+type\b/.test(line)) return false;
  // the only sanctioned upper-edition value reference: an edition-GUARDED dynamic import.
  if (isGuardedEditionDynamicImport(repoPath, line, precedingLines)) return false;

  const specMatch = line.match(/(?:from|import)\s*\(?\s*["']([^"']+)["']/);
  const specifier = specMatch?.[1];
  if (!specifier) return false;

  const targetTier = editionTierOfSpecifier(specifier);
  if (targetTier === null) return false;
  return targetTier > sourceTier;
}

function discoverPackageTestingAliases(): Map<string, string> {
  const aliases = new Map<string, string>();
  const packagesDir = join(REPO_ROOT, "packages");

  try {
    for (const entry of Deno.readDirSync(packagesDir)) {
      if (!entry.isDirectory) continue;
      const testingDir = join(packagesDir, entry.name, "testing");
      try {
        const stat = Deno.statSync(testingDir);
        if (stat.isDirectory) {
          aliases.set(entry.name, `@exaix/${entry.name}/testing`);
        }
      } catch {
        // No public testing surface for this package.
      }
    }
  } catch {
    // Repository layout unavailable; keep alias map empty.
  }

  return aliases;
}

function discoverPublicPackageAliases(): IPublicPackageAlias[] {
  const aliases: IPublicPackageAlias[] = [];
  const denoJsonPath = join(REPO_ROOT, "deno.json");

  try {
    const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath)) as {
      imports?: Record<string, string>;
    };

    for (const [alias, mappedPath] of Object.entries(denoJson.imports ?? {})) {
      if ((!alias.startsWith("@exaix/") && !alias.startsWith("@exaix-team/")) || alias.endsWith("/")) {
        continue;
      }
      if (!isRepoRelativeSpecifier(mappedPath)) {
        continue;
      }

      const entryPath = normalize(mappedPath.replace(/^\.\//, ""));
      if (!entryPath.startsWith(LAYOUT.packageRoot) && !entryPath.startsWith(LAYOUT.teamRoot)) {
        continue;
      }

      // Root packages are two segments deep (packages/<name>/...); exaix-team's own
      // packages/apps are one level deeper (exaix-team/{packages,apps}/<name>/...).
      const rootSegments = entryPath.startsWith(LAYOUT.teamRoot) ? 3 : 2;
      const segments = entryPath.split("/");
      const packageName = segments[rootSegments - 1];
      if (!packageName || segments.length <= rootSegments) {
        continue;
      }

      const packageRoot = normalize(segments.slice(0, rootSegments).join("/"));
      const rootPath = normalize(dirname(entryPath));
      aliases.push({ alias, entryPath, rootPath, packageRoot });
    }
  } catch {
    // Root import-map metadata unavailable; keep alias list empty.
  }

  return aliases.sort((a, b) => {
    if (b.alias.length !== a.alias.length) {
      return b.alias.length - a.alias.length;
    }

    return b.rootPath.length - a.rootPath.length;
  });
}

function findCanonicalPackageAlias(normalizedImport: string, importerRepoPath: string): IPublicPackageAlias | null {
  for (const aliasInfo of publicPackageAliases) {
    if (importerRepoPath.startsWith(`${aliasInfo.packageRoot}/`)) {
      continue;
    }

    if (normalizedImport === aliasInfo.entryPath) {
      return aliasInfo;
    }

    if (
      aliasInfo.rootPath !== aliasInfo.packageRoot &&
      normalizedImport.startsWith(`${aliasInfo.rootPath}/`)
    ) {
      return aliasInfo;
    }
  }

  return null;
}

function findCanonicalPackageAliasForSpecifier(importPath: string): IPublicPackageAlias | null {
  for (const aliasInfo of publicPackageAliases) {
    if (aliasInfo.rootPath === aliasInfo.packageRoot) {
      continue;
    }

    if (importPath.startsWith(`${aliasInfo.alias}/`)) {
      return aliasInfo;
    }
  }

  return null;
}

function findPromotedSubpackageAliasForParentEntrypoint(
  normalizedImport: string,
  importerRepoPath: string,
): IPublicPackageAlias | null {
  if (!isPackageRootEntrypoint(importerRepoPath)) {
    return null;
  }

  const packageRoot = importerRepoPath.split("/").slice(0, 2).join("/");
  for (const aliasInfo of publicPackageAliases) {
    if (
      aliasInfo.packageRoot !== packageRoot ||
      aliasInfo.rootPath === aliasInfo.packageRoot ||
      ROOT_OWNED_PARENT_EXPORT_ALIASES.has(aliasInfo.alias)
    ) {
      continue;
    }

    if (normalizedImport === aliasInfo.entryPath || normalizedImport.startsWith(`${aliasInfo.rootPath}/`)) {
      return aliasInfo;
    }
  }

  return null;
}

function discoverRootTestingShimExports(): Map<string, ITestingShimExportInfo> {
  const shimExports = new Map<string, ITestingShimExportInfo>();
  const helpersDir = join(REPO_ROOT, "tests", "helpers");
  const exportRegex = /export(?:\s+type)?\s*{([\s\S]*?)}\s*from\s*["'](@exaix\/[^"']+\/testing)["']/g;

  try {
    for (const entry of Deno.readDirSync(helpersDir)) {
      if (!entry.isFile || !entry.name.endsWith(".ts")) continue;

      const absolutePath = join(helpersDir, entry.name);
      const repoPath = `${LAYOUT.rootTestHelpers}${entry.name}`;
      const source = Deno.readTextFileSync(absolutePath);

      for (const match of source.matchAll(exportRegex)) {
        const alias = match[2];
        const exportedNames = parseNamedSymbols(match[1]);
        const existing = shimExports.get(repoPath) ?? { alias, exportedNames: new Set<string>() };
        existing.alias = alias;
        exportedNames.forEach((name) => existing.exportedNames.add(name));
        shimExports.set(repoPath, existing);
      }
    }
  } catch {
    // Root helper directory unavailable; keep shim map empty.
  }

  return shimExports;
}

function resolveRepoImportPath(importerRepoPath: string, importPath: string): string | null {
  if (importPath.startsWith(".")) {
    return normalize(join(dirname(importerRepoPath), importPath));
  }
  if (importPath.startsWith(LAYOUT.packageRoot) || importPath.startsWith(LAYOUT.testsRoot)) {
    return normalize(importPath);
  }

  return null;
}

function getPackageTestingAliasForTestImport(normalizedImport: string): { packageName: string; alias: string } | null {
  const match = normalizedImport.match(RE_PACKAGE_TESTS_CAPTURE);
  if (!match) {
    return null;
  }

  const packageName = match[1];
  const alias = packageTestingAliases.get(packageName);
  if (!alias) {
    return null;
  }

  return { packageName, alias };
}

const packageTestingAliases = discoverPackageTestingAliases();
const rootTestingShimExports = discoverRootTestingShimExports();
const publicPackageAliases = discoverPublicPackageAliases();

const args = new Set(Deno.args);
const strictImports = args.has("--strict-imports");
const convertWarnings = args.has("--convert-warnings-to-errors");
const showAllWarnings = args.has("--show-all-warnings");

if (args.has("--help") || args.has("-h")) {
  console.log(`Exaix Code Style Checker

Usage:

  deno run ${LAYOUT.packageRoot}lint-rules/${LAYOUT.srcRoot}exaix/check_code_style.ts [options] [paths...]

Options:
  --help, -h          Show this help message
  --strict-imports    Enable strict dynamic import checks (detects imports inside statements)

  --convert-warnings-to-errors  Convert all warnings to errors
  --show-all-warnings          Show all warnings, including those masked by exclusion comments

Description:
  Scans all .ts and .tsx files in the Exaix repository for code style violations
  defined in CODE_STYLE.md. Exits with code 1 if any errors are found.
  `);
  Deno.exit(0);
}

// ── Layer-Aware Constant Imports (AST-based) ────────────────────────────────
//
// Detects when a file in package P imports a **value** (non-type) from a
// domain-implementation package Q — a sign that the orchestrator may be
// bypassing the service boundary and depending on low-level implementation
// details that belong inside the service.
//
// Domain-implementation packages export concrete classes, command constants,
// and runtime primitives.  Framework/API packages export interfaces, types,
// enums, and event names.
//
// The check is AST-based (uses the TypeScript compiler API) rather than
// regex-based, so it correctly handles multi-line imports, type-only imports,
// and per-binding type annotations.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Framework/API packages that export shared contracts — value imports
 * from these are always OK.
 */
const LAYER_LEAK_FRAMEWORK = new Set([
  "@exaix/core",
  "@exaix/schemas",
  "@exaix/ai",
  "@exaix/cli",
  "@exaix/tui",
  "@exaix/testing",
]);

/** Known bridge files — exempt from layer-leak checks. */
const LAYER_LEAK_EXEMPT = new Set(LAYOUT.layerLeakExempt.map((entry) => entry.path));

/**
 * Structural AST analysis: detect when a file in package P value-imports
 * a class from domain package Q and instantiates it with `new Q(...)`.
 *
 * No hardcoded symbol names — the check is purely structural:
 *  1. Parse all import declarations (AST)
 *  2. Build a map of imported names → source packages
 *  3. Walk all NewExpression nodes
 *  4. If the constructor identifier matches an imported value from a
 *     different domain package, flag it.
 */
function isFrameworkSpecifier(specifier: string): boolean {
  if (LAYER_LEAK_FRAMEWORK.has(specifier)) return true;
  for (const p of LAYER_LEAK_FRAMEWORK) {
    if (specifier.startsWith(p + "/")) return true;
  }
  return false;
}

function isDomainImportSpecifier(specifier: string, myPackage: string): boolean {
  if (!specifier.startsWith("@exaix/")) return false;
  if (isFrameworkSpecifier(specifier)) return false;
  if (
    specifier.startsWith("@exaix/ai-") || specifier.startsWith("@exaix-team/") ||
    specifier.startsWith("@exaix/tui/") || specifier.startsWith("@exaix/cli/")
  ) return false;
  const targetPkg = specifier.match(/^@exaix\/([^/]+)/)?.[1];
  return Boolean(targetPkg) && targetPkg !== myPackage;
}

function importBindingNames(
  bindings: ts.NamedImports,
  specifier: string,
  sourceFile: ts.SourceFile,
): Array<{ name: string; specifier: string; line: number }> {
  const result: Array<{ name: string; specifier: string; line: number }> = [];
  for (const el of bindings.elements) {
    if (el.isTypeOnly) continue;
    const name = el.name.text;
    if (/^I[A-Z]/.test(name)) continue; // I-prefixed = interface, not a constant
    result.push({ name, specifier, line: sourceFile.getLineAndCharacterOfPosition(el.getStart()).line + 1 });
  }
  return result;
}

function domainImportBindings(
  node: ts.Node,
  myPackage: string,
  sourceFile: ts.SourceFile,
): Array<{ name: string; specifier: string; line: number }> | null {
  if (!ts.isImportDeclaration(node)) return null;
  const specNode = node.moduleSpecifier;
  if (!ts.isStringLiteral(specNode)) return null;
  if (!isDomainImportSpecifier(specNode.text, myPackage)) return null;
  const clause = node.importClause;
  if (!clause || clause.isTypeOnly) return null;
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return null;
  return importBindingNames(bindings, specNode.text, sourceFile);
}

function collectDomainImports(
  sourceFile: ts.SourceFile,
  myPackage: string,
): Map<string, { specifier: string; line: number }> {
  const imported = new Map<string, { specifier: string; line: number }>();
  ts.forEachChild(sourceFile, (node) => {
    const bindings = domainImportBindings(node, myPackage, sourceFile);
    if (!bindings) return;
    for (const binding of bindings) imported.set(binding.name, { specifier: binding.specifier, line: binding.line });
  });
  return imported;
}

function findNewExpressionNames(node: ts.Node, names: Set<string>): void {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) names.add(node.expression.text);
  ts.forEachChild(node, (child) => findNewExpressionNames(child, names));
}

function reportConcreteCrossDomain(
  newNames: Set<string>,
  imported: Map<string, { specifier: string; line: number }>,
  sourceFile: ts.SourceFile,
  repoPath: string,
): void {
  for (const name of newNames) {
    const info = imported.get(name);
    if (!info) continue;
    const prefix = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${prefix} [concrete-cross-domain] ${sourceFile.fileName}:${info.line} – ` +
        `Concrete class '${name}' imported from '${info.specifier}' ` +
        `and instantiated via \`new ${name}(\` in a different-domain file ` +
        `(${repoPath}). Accept an interface via DI instead of importing ` +
        `the concrete class. See CODE_STYLE.md §5 (DI) and §15.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  }
}

function removeNamesUsedInPropertyAccess(
  sourceFile: ts.SourceFile,
  imported: Map<string, { specifier: string; line: number }>,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      imported.delete(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function removeNamesUsedInCalls(
  sourceFile: ts.SourceFile,
  imported: Map<string, { specifier: string; line: number }>,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      imported.delete(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function reportLayerConstantLeaks(
  imported: Map<string, { specifier: string; line: number }>,
  sourceFile: ts.SourceFile,
  repoPath: string,
): void {
  for (const [name, info] of imported) {
    const prefix = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${prefix} [layer-constant-leak] ${sourceFile.fileName}:${info.line} – ` +
        `Constant-like value '${name}' imported from '${info.specifier}' ` +
        `in a different-domain file (${repoPath}). ` +
        `Low-level constants belong behind the service that owns them; ` +
        `avoid importing them in composition-root code. ` +
        `See CODE_STYLE.md §15.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  }
}

function checkLayerLeaks(sourceFile: ts.SourceFile, repoPath: string): void {
  if (!repoPath.startsWith(LAYOUT.packageRoot)) return;
  if (
    repoPath.includes(LAYOUT.testsSegment) || repoPath.includes(LAYOUT.testingSegment) || repoPath.endsWith("_test.ts")
  ) return;
  if (LAYER_LEAK_EXEMPT.has(repoPath)) return;

  const pkgMatch = repoPath.match(RE_PACKAGE_NAME_CAPTURE);
  if (!pkgMatch) return;
  const myPackage = pkgMatch[1];

  // Step 1: imported names from other domain packages.
  const imported = collectDomainImports(sourceFile, myPackage);
  if (imported.size === 0) return;

  // Step 2: names used as constructors (new X(...)).
  const newNames = new Set<string>();
  findNewExpressionNames(sourceFile, newNames);

  // Step 2b: flag concrete instantiation of foreign classes.
  reportConcreteCrossDomain(newNames, imported, sourceFile, repoPath);
  for (const name of newNames) imported.delete(name);

  // Steps 3-4: drop names used in property access (X.Y) and calls (X(...)).
  removeNamesUsedInPropertyAccess(sourceFile, imported);
  removeNamesUsedInCalls(sourceFile, imported);

  // Step 5: remaining names are constant-like.
  reportLayerConstantLeaks(imported, sourceFile, repoPath);
}

// Rules correspond to the code style guidelines in CODE_STYLE.md.  When a
// violation is found we print a human-friendly explanation; the script exits
// with a non-zero status if any errors were detected so it can be used in
// pre-commit hooks or CI.
const rules: Rule[] = [
  {
    name: "import-inside-statement",
    // Match lines that have 'import(' and start with whitespace (indented = nested)
    // AND ignore 'typeof import('
    regex: /^\s+.*(?<!typeof\s+)import\s*\(/,
    message:
      "Use of import() inside other statements (e.g., if, function, loop) is prohibited. All imports must be at the top level.",
  },
  {
    name: "dynamic-import",
    // Match 'import(' but exclude 'typeof import('
    regex: /(?<!typeof\s+)\bimport\s*\(/,
    message:
      "Dynamic import statements (import(...)) are discouraged. If used, document the rationale in a comment above the import.",
  },
  {
    name: "inline-type-import",
    // Matches import("...").Something used as a type annotation, e.g.:
    //   Promise<import("./foo.ts").IFoo>
    //   : import("./bar.ts").Bar
    // Excludes `typeof import("...").Foo` which is the legitimate pattern for
    // typing the result of a dynamic import helper without a top-level import.
    regex: /(?<!typeof\s+)import\s*\(\s*["'][^"']+["']\s*\)\s*\.\s*\w/,
    message: 'Inline type imports (e.g. `import("./foo.ts").IFoo` inside a type annotation) are prohibited. ' +
      'Declare an explicit `import type { IFoo } from "./foo.ts"` at the top of the file.',
  },
  {
    name: "test-inline-multiline-fixture",
    regex:
      /^\s*(?:const|let|var)\s+(?:markdown|yaml|json|input|payload|text|content)\s*=\s*(?:[A-Za-z_$][\w$]*\s*)?`[^`]*$/,
    message:
      "Avoid inline multiline structured text fixtures in test files. Move YAML, markdown, JSON, or other multi-line test inputs into a package-local fixture under " +
      `${LAYOUT.testsRoot}fixtures/ and load them from the test file.`,
  },
  {
    name: "promise-response-alias",
    regex: /^\s*(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*(?:\([^\)]*\)\s*=>\s*)?Promise\s*<\s*Response\s*>\s*;/,
    message: "Type aliases that mask 'Promise<Response>' are prohibited; define a specific response type instead.",
  },
  {
    name: "ts-suppression-pragmas",
    regex: /@ts-(?:ignore|expect-error|nocheck)/,
    message:
      "TypeScript suppression pragmas (e.g. @ts-ignore, @ts-expect-error, @ts-nocheck) are prohibited; fix the underlying type error instead.",
  },
  {
    name: "deno-lint-no-explicit-any",
    regex: /\/\/\s*deno-lint-ignore\s+no-explicit-any/,
    message: "Using '// deno-lint-ignore no-explicit-any' is not allowed; address the typing issue explicitly.",
  },
  {
    name: "promise-response-return",
    // Expanded to catch both arrow => Promise<Response> and : Promise<Response> method/function returns
    regex: /:\s*Promise\s*<\s*Response\s*>/,
    message:
      "'Promise<Response>' as return type is too weak; define a specific interface describing the expected response shape.",
  },
  {
    name: "re-export-imported",
    regex: /^\s*export\s+.*from\s+['"]|^\s*export\s+\*\s+from/,
    message:
      "Re-exporting entities from other modules (e.g., 'export { ... } from ...' or 'export * from ...') is prohibited. Each module must only export entities it defines.",
  },
  {
    name: "package-entrypoint-root-src-reexport",
    regex: /from\s+['"](?:src\/|(\.\.\/)+src\/)/,
    message:
      "Package entrypoints must not re-export entities directly from repo retired 'src/*' paths. Use package-local public exports instead.",
  },
  {
    name: "magic-union-type",
    // Match inline union of string literals: "foo" | "bar"
    // Use word boundaries and double quotes to identify string literals
    // Skip lines that start with 'type ' or 'export type ' (named type alias definitions are the
    // recommended solution, not a violation)
    regex: /^(?!\s*(?:export\s+)?type\s+).*"\w+"\s*\|\s*"\w+"/,
    message: "Avoid magic string unions (e.g., '\"a\" | \"b\"'). Define a TypeScript 'enum' in " +
      `${LAYOUT.packageRoot}core/${LAYOUT.srcRoot}types/enums.ts or use a shared named union type instead.`,
  },
  // NOTE: the former [mit-team-import] regex rule (packages/ must not import packages-team/)
  // is superseded by the [edition-leak] check in checkFile(), which enforces the full tier
  // model (Solo < Team < Enterprise) across packages/, apps/, and exaix-team/ with
  // type-only + edition-gated-dynamic exemptions. See isEditionLeakImport().
  // NOTE: the former [layer-constant-leak] regex rule is superseded by the AST-based
  // checkLayerLeaks() called from checkFile(), which uses the TypeScript compiler API.
  {
    name: "edition-conditional-outside-composer",
    // Forbid edition conditionals (edition ===, edition !==, EXAIX_EDITION)
    // outside the edition composer. Edition-selection logic must be contained
    // in the composer — core packages and apps must not branch on edition.
    regex: /EXAIX_EDITION|\bedition\s*(?:===?|!==?)/,
    message:
      "Edition conditionals (edition === / EXAIX_EDITION) are only allowed inside the edition composer. Move edition-selection logic to the composer, or check the composer for inadvertent edition branching in core code.",
  },
];

/** Script rule ids implemented as inline checks (not in the `rules` array). */
const INLINE_SCRIPT_RULE_IDS = [
  "duplicate-type",
  "no-interface-rename-on-import",
  "import-placement",
  "module-header",
  "module-header-tag",
  "exported-interface-naming",
  "exported-interface-placement",
  "max-params",
  "long-comment",
  "ephemeral-comment",
  "decorative-comment",
  "edition-leak",
  "script-shebang",
  "script-usage",
  "script-placement",
  "tui-boundary-cli",
  "tui-boundary-services",
  "tui-boundary-config",
  "tui-boundary-helpers",
  "core-boundary-tui-helpers",
  "cli-boundary-services",
  "cli-boundary-config",
  "core-boundary-cli-helpers",
  "package-boundary",
  "package-src-boundary",
  "package-related-files-boundary",
  "package-subpath-promotion",
  "package-testing-import",
  "package-canonical-import",
  "package-instantiates-event-logger",
  "package-concrete-logger-type",
  "package-uses-config-reader",
  "concrete-cross-domain",
  "layer-constant-leak",
];

/** Every script rule id the checker implements: the `rules` array plus the inline checks. */
export const IMPLEMENTED_SCRIPT_RULE_IDS: ReadonlySet<string> = new Set([
  ...rules.map((rule) => rule.name),
  ...INLINE_SCRIPT_RULE_IDS,
]);

let errorCount = 0;
let warnCount = 0;

function parseExclusionComment(line: string, ruleName: string): { code: string; rationale: string } | null {
  // Looks for: // style-exclude:CODE - rationale
  const match = line.match(new RegExp(`//\\s*style-exclude:([A-Z0-9_]+)\\s*-\\s*(.+)$`));
  if (match && exclusionDict[ruleName] && exclusionDict[ruleName][match[1]]) {
    return { code: match[1], rationale: match[2] };
  }
  return null;
}

// Matches a run of 4+ repeated separator/decoration characters anywhere on a comment
// line — pure banner lines ("// ====...") and text wrapped in dashes ("// ── Foo ──...")
// alike. Threshold is 4, not 3, so a 3-char code echo in prose (e.g. `x === ""`) doesn't
// false-positive against the real `===`/`!==` operators. `#` is excluded: this codebase
// never uses it for banners, and it collides with markdown heading examples like `######`.
const DECORATIVE_COMMENT_LINE_PATTERN = /[=\-_~*─━═▬•]{4,}/;

const EPHEMERAL_COMMENT_PATTERNS: { pattern: RegExp; hint: string }[] = [
  { pattern: /\bphase\s+\d+\b/i, hint: "a phase number" },
  { pattern: /\bstep\s+\d+\b/i, hint: "a step number" },
  { pattern: /\bgaps?\s*[-#:]\s*[\w\d.-]+/i, hint: "a GAP identifier" },
  { pattern: /\bgaps?\s+\d+\b/i, hint: "a GAP identifier" },
  { pattern: /\b(?:pre|post)[ -]?gap\b/i, hint: "a pre/post-gap reference" },
  { pattern: /\bgap\s+(?:analysis|remediation|finding|decision)\b/i, hint: "gap analysis/remediation details" },
  { pattern: /\btried\b/i, hint: "a narration of a prior attempt" },
  { pattern: /\b(?:didn't|did not)\s+work\b/i, hint: "what didn't work" },
  { pattern: /§/, hint: "a document-section reference (§)" },
];

const MONTH_NAME_PATTERN =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const FOUR_DIGIT_YEAR_PATTERN = "(?:19|20)\\d{2}";
const TWO_OR_FOUR_DIGIT_YEAR_PATTERN = `(?:\\d{2}|${FOUR_DIGIT_YEAR_PATTERN})`;
const MONTH_NUMBER_PATTERN = "(?:0?[1-9]|1[0-2])";
const DAY_NUMBER_PATTERN = "(?:0?[1-9]|[12]\\d|3[01])";
const COMMENT_DATE_PATTERNS: RegExp[] = [
  new RegExp(
    `\\b${FOUR_DIGIT_YEAR_PATTERN}[-/.]${MONTH_NUMBER_PATTERN}[-/.]${DAY_NUMBER_PATTERN}\\b`,
  ),
  new RegExp(`\\b${FOUR_DIGIT_YEAR_PATTERN}${MONTH_NUMBER_PATTERN}${DAY_NUMBER_PATTERN}\\b`),
  new RegExp(
    `\\b(?:${MONTH_NUMBER_PATTERN}[-/.]${DAY_NUMBER_PATTERN}|${DAY_NUMBER_PATTERN}[-/.]${MONTH_NUMBER_PATTERN})[-/.]${TWO_OR_FOUR_DIGIT_YEAR_PATTERN}\\b`,
  ),
  new RegExp(
    `\\b(?:${MONTH_NAME_PATTERN}[\\s.-]+${DAY_NUMBER_PATTERN}(?:st|nd|rd|th)?(?:,|[\\s.-])+(?:${FOUR_DIGIT_YEAR_PATTERN})|${DAY_NUMBER_PATTERN}(?:st|nd|rd|th)?[\\s.-]+${MONTH_NAME_PATTERN}(?:,|[\\s.-])+(?:${FOUR_DIGIT_YEAR_PATTERN})|${MONTH_NAME_PATTERN}[\\s.-]+${FOUR_DIGIT_YEAR_PATTERN})\\b`,
    "i",
  ),
  new RegExp(`\\bQ[1-4][\\s.-]+${FOUR_DIGIT_YEAR_PATTERN}\\b`, "i"),
];

function reportCommentViolation(
  rule: "long-comment" | "ephemeral-comment" | "decorative-comment" | "ephemeral-filename",
  repoPath: string,
  lineNum: number,
  message: string,
): void {
  const severity = convertWarnings ? "ERROR" : "WARN";
  console.log(`${severity} [${rule}] ${repoPath}:${lineNum} – ${message}`);
  if (convertWarnings) errorCount++;
  else warnCount++;
}

// Matches only a NUMBERED plan-phase reference ("phase147_", "phase_2_") — bare "phase"
// and any "step" form are deliberately exempt (see CODE_STYLE.md): "step" is an
// established domain term here (flow/execution steps, PhaseStepManifestParser) independent
// of plan-phase numbering, and banning it would flag dozens of correctly-named files.
const EPHEMERAL_TEST_FILENAME_PATTERN = /(?:^|[_.-])phase[-_]?(\d+)(?:[_.-]|$)/i;

function checkTestFileName(repoPath: string): void {
  const isTestFile = repoPath.includes(LAYOUT.testsSegment) || repoPath.endsWith("_test.ts") ||
    repoPath.endsWith(".test.ts");
  if (!isTestFile) return;
  const basename = repoPath.slice(repoPath.lastIndexOf("/") + 1);
  const match = basename.match(EPHEMERAL_TEST_FILENAME_PATTERN);
  if (!match) return;
  reportCommentViolation(
    "ephemeral-filename",
    repoPath,
    1,
    `Test file name embeds a numbered plan-phase reference ("phase${
      match[1]
    }") — this is ephemeral implementation history in the path, same as in a comment. ` +
      "Name the file after the behavior it verifies; the phase-plan doc is the durable " +
      "record of which phase introduced it.",
  );
}

function checkCommentDates(repoPath: string, text: string): void {
  const sourceFile = ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, false);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }

    const commentText = scanner.getTokenText();
    if (!COMMENT_DATE_PATTERNS.some((pattern) => pattern.test(commentText))) continue;

    const lineNum = sourceFile.getLineAndCharacterOfPosition(scanner.getTokenPos()).line + 1;
    reportCommentViolation(
      "ephemeral-comment",
      repoPath,
      lineNum,
      "Comment contains a calendar date; time-specific context belongs in version control or project documentation, not code comments that should remain durable.",
    );
  }
}

// Evaluates one already-closed comment (a block comment or a run of consecutive
// `//` lines) against the length and ephemeral-reference rules. Never called for
// the module's own leading header comment — that block is governed by §7 instead.
function evaluateInModuleComment(
  repoPath: string,
  startLine: number,
  commentLines: string[],
  maxLines: number,
): void {
  if (commentLines.length === 0) return;

  if (commentLines.length > maxLines) {
    reportCommentViolation(
      "long-comment",
      repoPath,
      startLine,
      `Comment spans ${commentLines.length} lines, more than the ${maxLines}-line limit for in-module comments. Shorten it to the one non-obvious fact a reader needs, or move a longer explanation into the module's own documentation.`,
    );
  }

  const commentText = commentLines.join("\n");
  for (const { pattern, hint } of EPHEMERAL_COMMENT_PATTERNS) {
    if (pattern.test(commentText)) {
      reportCommentViolation(
        "ephemeral-comment",
        repoPath,
        startLine,
        `Comment references ${hint}; implementation history belongs in the commit message or phase-plan doc, not in code that outlives the task that produced it.`,
      );
      break;
    }
  }

  for (let i = 0; i < commentLines.length; i++) {
    if (DECORATIVE_COMMENT_LINE_PATTERN.test(commentLines[i])) {
      reportCommentViolation(
        "decorative-comment",
        repoPath,
        startLine + i,
        "Comment uses a decorative separator (====, ----, ────, or text wrapped in dashes). Drop it and write a plain comment — the decoration adds characters without adding meaning.",
      );
    }
  }
}

// Scans comments past the module header for length, ephemeral-history, and decoration rules.
// Calendar dates are scanned separately because their ban also applies to headers and inline comments.
function checkCommentDiscipline(
  repoPath: string,
  lines: string[],
  templateLiteralLines: Set<number>,
  maxLines: number,
): void {
  let pastHeader = false;
  let inBlock = false;
  let blockStartLine = -1;
  let blockLines: string[] = [];
  let lineRunStartLine = -1;
  let lineRunLines: string[] = [];

  const flushLineRun = () => {
    if (pastHeader) evaluateInModuleComment(repoPath, lineRunStartLine, lineRunLines, maxLines);
    lineRunStartLine = -1;
    lineRunLines = [];
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    if (templateLiteralLines.has(lineNum)) {
      flushLineRun();
      continue;
    }

    const rawLine = lines[idx];
    const trimmed = rawLine.trim();

    if (inBlock) {
      blockLines.push(rawLine);
      if (trimmed.includes("*/")) {
        inBlock = false;
        if (pastHeader) evaluateInModuleComment(repoPath, blockStartLine, blockLines, maxLines);
        blockLines = [];
      }
      continue;
    }

    if (!trimmed) {
      flushLineRun();
      continue;
    }

    if (trimmed.startsWith("/*")) {
      flushLineRun();
      if (trimmed.includes("*/")) {
        if (pastHeader) evaluateInModuleComment(repoPath, lineNum, [rawLine], maxLines);
      } else {
        inBlock = true;
        blockStartLine = lineNum;
        blockLines = [rawLine];
      }
      continue;
    }

    if (trimmed.startsWith("//")) {
      if (lineRunStartLine === -1) lineRunStartLine = lineNum;
      lineRunLines.push(rawLine);
      continue;
    }

    flushLineRun();
    if (!pastHeader && !trimmed.startsWith("#!")) {
      pastHeader = true;
    }
  }
  flushLineRun();
}

/** Module header and script-header checks (CODE_STYLE.md 7 and 12). */
function checkModuleHeader(path: string, repoPath: string, lines: string[], headerFound: boolean): void {
  if (!headerFound) {
    const severity = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${severity} [module-header] ${path}:1 – Modules should start with a descriptive header comment.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
    return;
  }
  if (path.includes(LAYOUT.testsSegment)) return;

  const headerLines = lines.slice(0, 15).join("\n");
  for (const tag of ["@module", "@path", "@description"]) {
    if (!headerLines.includes(tag)) {
      console.log(`ERROR [module-header-tag] ${path}:1 – Header is missing mandatory '${tag}' tag.`);
      errorCount++;
    }
  }

  if (repoPath.startsWith(LAYOUT.packageRoot)) {
    for (const relatedFile of parseHeaderRelatedFiles(headerLines)) {
      if (!RETIRED_ROOT_HEADER_RELATED_FILES.has(relatedFile)) continue;
      console.log(
        `ERROR [package-related-files-boundary] ${path}:1 – Package-owned module headers must not reference retired root compatibility paths in '@related-files': '${relatedFile}'. Point to the package-owned source-of-truth module instead.`,
      );
      errorCount++;
    }
  }

  checkScriptHeader(path, lines, headerLines);
}

/** Maintenance-script header checks (CODE_STYLE.md 12). */
function checkScriptHeader(path: string, lines: string[], headerLines: string): void {
  if (!path.includes(LAYOUT.scriptsSegment) || path.includes(LAYOUT.testsSegment)) return;
  if (!lines[0].startsWith("#!/usr/bin/env -S deno run -A")) {
    console.log(
      `ERROR [script-shebang] ${path}:1 – Maintenance scripts must start with '#!/usr/bin/env -S deno run -A'.`,
    );
    errorCount++;
  }
  if (!headerLines.includes("Usage:")) {
    console.log(
      `ERROR [script-usage] ${path}:1 – Maintenance scripts must include a 'Usage:' section in the header.`,
    );
    errorCount++;
  }
  const fileName = path.split("/").pop() || "";
  if (fileName.startsWith("debug_") || fileName.startsWith("tmp_")) {
    console.log(
      `ERROR [script-placement] ${path}:1 – Debug or temporary scripts must be located outside the '${LAYOUT.scriptsRoot}' directory.`,
    );
    errorCount++;
  }
}

interface IImportPlacementState {
  readonly firstImportLineNum: number;
  readonly lastImportLineNum: number;
  readonly firstInterfaceLineNum: number;
  readonly importFollowingInterface: Map<number, number>;
  readonly importFollowingFunctional: Map<number, number>;
}

/** Import-placement checks: interfaces after imports, and imports before functional code. */
function checkImportPlacement(path: string, state: IImportPlacementState): void {
  if (
    state.firstImportLineNum !== -1 && state.firstInterfaceLineNum !== -1 &&
    state.firstInterfaceLineNum < state.lastImportLineNum
  ) {
    console.log(
      `ERROR [import-placement] ${path}:${state.firstInterfaceLineNum} – Interface/type definitions must follow all imports (last import at line ${state.lastImportLineNum}).`,
    );
    errorCount++;
  } else if (state.importFollowingInterface.size > 0) {
    const line = Array.from(state.importFollowingInterface.keys())[0];
    const started = state.importFollowingInterface.get(line);
    console.log(
      `ERROR [import-placement] ${path}:${line} – Imports must precede all interface/type definitions (interface started at line ${started}).`,
    );
    errorCount++;
  }

  if (state.importFollowingFunctional.size > 0) {
    const line = Array.from(state.importFollowingFunctional.keys())[0];
    const started = state.importFollowingFunctional.get(line);
    console.log(
      `ERROR [import-placement] ${path}:${line} – Imports must be at the top, preceding functional code (functional code started at line ${started}).`,
    );
    errorCount++;
  }
}

function isConfigServiceConfigUsage(trimmedLine: string, line: string): boolean {
  const isImport = trimmedLine.startsWith("import") && trimmedLine.includes("ConfigService") &&
    trimmedLine.includes("@exaix/core");
  const isUsage = !trimmedLine.startsWith("import") && line.match(/\bnew\s+ConfigService\s*\(/) !== null;
  return isImport || isUsage;
}

/** Reports the package-purity violations for one source line (CODE_STYLE.md 13). */
function reportPackagePurityViolations(repoPath: string, line: string, trimmedLine: string, idx: number): void {
  if (line.match(/\bnew\s+EventLogger\s*\(/)) {
    console.log(
      `ERROR [package-instantiates-event-logger] ${repoPath}:${
        idx + 1
      } – Package source modules must not instantiate EventLogger. Accept IEventLogger as an optional constructor parameter injected by the service layer.`,
    );
    errorCount++;
  }

  if (
    trimmedLine.startsWith("import") &&
    trimmedLine.match(/\bEventLogger\b/) &&
    trimmedLine.match(/from\s+["']@exaix\/core/)
  ) {
    const prefix = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${prefix} [package-concrete-logger-type] ${repoPath}:${
        idx + 1
      } – Package source modules should import IEventLogger (the interface) instead of the concrete EventLogger class. Decouples the package from the runtime logger implementation.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  }

  if (isConfigServiceConfigUsage(trimmedLine, line)) {
    const prefix = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${prefix} [package-uses-config-reader] ${repoPath}:${
        idx + 1
      } – Package source modules must not instantiate ConfigService. Receive a Config value as a constructor parameter instead.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  }
}

/** Package module purity (CODE_STYLE.md 13): no runtime infrastructure in package src/. */
function checkPackagePurity(repoPath: string, lines: string[]): void {
  const match = repoPath.match(RE_PACKAGE_SRC_CAPTURE);
  if (!match || match[1] === "core" || repoPath.startsWith(LAYOUT.mcpServerPrefix)) return;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("*") || trimmedLine.startsWith("/*")) continue;
    reportPackagePurityViolations(repoPath, line, trimmedLine, idx);
  }
}

interface IMultilineFixtureLines {
  readonly exempt: Set<number>;
  readonly warn: Set<number>;
}

/** Scans multi-line template fixtures and classifies each opening line as exempt or warn. */
function collectMultilineFixtureLines(lines: string[], minFixtureLines: number): IMultilineFixtureLines {
  const exempt = new Set<number>();
  const warn = new Set<number>();
  const fixtureStartRegex = /^\s*(?:const|let|var)\s+(?:markdown|yaml|json|input|payload|text|content)\s*=\s*`/;
  const anyTemplateStartRegex = /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*`/;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!anyTemplateStartRegex.test(line) || /`[^`]*`/.test(line)) continue;
    const run = scanTemplateRun(lines, idx);
    const shouldWarn = run.closed && !run.containsInterpolation && run.lineCount >= minFixtureLines &&
      run.firstNonEmptyLine !== null &&
      (run.firstNonEmptyLine.startsWith("---") || run.firstNonEmptyLine.startsWith("#"));
    if (fixtureStartRegex.test(line)) {
      if (!run.closed || run.containsInterpolation || run.lineCount < minFixtureLines) exempt.add(idx + 1);
    } else if (shouldWarn) {
      warn.add(idx + 1);
    }
  }
  return { exempt, warn };
}

interface ITemplateRun {
  readonly closed: boolean;
  readonly containsInterpolation: boolean;
  readonly lineCount: number;
  readonly firstNonEmptyLine: string | null;
}

/** Scans a multi-line template run that opens on `lines[startIdx]`. */
function scanTemplateRun(lines: string[], startIdx: number): ITemplateRun {
  const openingText = lines[startIdx].slice(lines[startIdx].indexOf("`") + 1);
  let containsInterpolation = false;
  let lineCount = 0;
  let firstNonEmptyLine: string | null = null;
  if (openingText.trim().length > 0) {
    if (openingText.includes("${")) containsInterpolation = true;
    lineCount++;
    firstNonEmptyLine = openingText.trim();
  }

  for (let j = startIdx + 1; j < lines.length; j++) {
    if (lines[j].includes("${")) containsInterpolation = true;
    if (firstNonEmptyLine === null && lines[j].trim().length > 0) firstNonEmptyLine = lines[j].trim();
    const backtickIndex = lines[j].indexOf("`");
    if (backtickIndex !== -1) {
      if (lines[j].slice(0, backtickIndex).trim().length > 0) lineCount++;
      return { closed: true, containsInterpolation, lineCount, firstNonEmptyLine };
    }
    lineCount++;
  }
  return { closed: false, containsInterpolation, lineCount, firstNonEmptyLine };
}

/** Reports the TUI-only boundary violations for one line (CODE_STYLE.md 8). */
function reportTuiOnlyViolations(path: string, line: string, idx: number, tuiDepth: number): void {
  if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+cli\//)) {
    console.log(
      `ERROR [tui-boundary-cli] ${path}:${
        idx + 1
      } – TUI modules must not import from '${LAYOUT.appRoot}exactl/${LAYOUT.srcRoot}'.`,
    );
    errorCount++;
  }
  if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+services\/(?!adapters\/|tui_service_factory\.ts)/)) {
    console.log(
      `ERROR [tui-boundary-services] ${path}:${
        idx + 1
      } – TUI modules must not import from retired '${LAYOUT.srcRoot}services/' (now '${LAYOUT.packageRoot}core/${LAYOUT.srcRoot}services/').`,
    );
    errorCount++;
  }
  if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+config\//)) {
    console.log(
      `ERROR [tui-boundary-config] ${path}:${
        idx + 1
      } – TUI modules must not import from retired '${LAYOUT.srcRoot}config/' (now '${LAYOUT.packageRoot}core/${LAYOUT.srcRoot}config/').`,
    );
    errorCount++;
  }
  const helperMatch = line.match(/import\b.*?\bfrom\s+["']((\.\.\/)+)helpers\//);
  if (helperMatch && (helperMatch[1].match(/\.\.\//g) || []).length > tuiDepth) {
    console.log(
      `ERROR [tui-boundary-helpers] ${path}:${
        idx + 1
      } – TUI modules must not import from retired '${LAYOUT.srcRoot}helpers/' (now '${LAYOUT.packageRoot}tui/${LAYOUT.srcRoot}helpers/').`,
    );
    errorCount++;
  }
}

/** TUI boundary isolation (CODE_STYLE.md 8) plus the core-to-TUI-helpers guard. */
function checkTuiBoundary(path: string, lines: string[]): void {
  const isTuiFile = path.includes(LAYOUT.tuiSrcSegment) || path.includes(LAYOUT.tuiTestsSegment);
  const tuiSegments = path.split(LAYOUT.tuiSrcSegment)[1]?.split("/").filter(Boolean) ||
    path.split(LAYOUT.tuiTestsSegment)[1]?.split("/").filter(Boolean) || [];
  const tuiDepth = tuiSegments.length - 1;
  const isTuiTest = path.includes(LAYOUT.tuiTestDirSegment) || path.includes(LAYOUT.tuiTestsSegment) ||
    path.includes(LAYOUT.tuiPackageTestsSegment);

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (isTuiFile) {
      reportTuiOnlyViolations(path, line, idx, tuiDepth);
    } else if (!isTuiTest && line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+.*?tui\/helpers\//)) {
      console.log(
        `ERROR [core-boundary-tui-helpers] ${path}:${
          idx + 1
        } – Non-TUI modules must not import from '${LAYOUT.appRoot}tui/${LAYOUT.srcRoot}helpers/'.`,
      );
      errorCount++;
    }
  }
}

/** CLI boundary isolation (CODE_STYLE.md 9) plus the core-to-CLI-helpers guard. */
function checkCliBoundary(path: string, lines: string[]): void {
  const isCliBoundaryFile = path.includes(`${LAYOUT.appRoot}exactl/${LAYOUT.srcRoot}commands/`) ||
    path.includes(`${LAYOUT.appRoot}exactl/${LAYOUT.srcRoot}handlers/`) ||
    path.includes(`${LAYOUT.appRoot}exactl/${LAYOUT.srcRoot}command_builders/`);
  const isCliFile = path.includes(`${LAYOUT.appRoot}exactl/${LAYOUT.srcRoot}`);

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (isCliBoundaryFile) {
      if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+services\/(?!adapters\/)/)) {
        console.log(
          `ERROR [cli-boundary-services] ${path}:${
            idx + 1
          } – CLI command/handler/formatter/builder modules must not import from retired '${LAYOUT.srcRoot}services/' (now '${LAYOUT.packageRoot}core/${LAYOUT.srcRoot}services/') except retired '${LAYOUT.srcRoot}services/adapters/' (now '${LAYOUT.packageRoot}core/${LAYOUT.srcRoot}services/adapters/').`,
        );
        errorCount++;
      }
      if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+config\/service(?:\.ts)?["']/)) {
        console.log(
          `ERROR [cli-boundary-config] ${path}:${
            idx + 1
          } – CLI command/handler/formatter/builder modules must not import from retired '${LAYOUT.srcRoot}config/service.ts' (now '${LAYOUT.packageRoot}core/${LAYOUT.srcRoot}config/service.ts').`,
        );
        errorCount++;
      }
    }
    if (
      !isCliFile &&
      line.match(
        new RegExp(
          `import\\b.*?\\bfrom\\s+["'].*?${escapeRegExp(LAYOUT.appRoot)}exactl/${escapeRegExp(LAYOUT.srcRoot)}helpers/`,
        ),
      )
    ) {
      console.log(
        `ERROR [core-boundary-cli-helpers] ${path}:${
          idx + 1
        } – Non-CLI modules must not import from '${LAYOUT.appRoot}exactl/${LAYOUT.srcRoot}helpers/'.`,
      );
      errorCount++;
    }
  }
}

/**
 * Collects the 1-based line numbers that lie inside a template literal.
 * The parsed AST supplies the ranges, not a backtick count.
 * A backtick in a regex, string, or comment can no longer flip the state.
 */
function collectTemplateLiteralLines(sourceFile: ts.SourceFile): Set<number> {
  const lines = new Set<number>();
  function visit(node: ts.Node): void {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      for (let line = startLine; line <= endLine; line++) lines.add(line);
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return lines;
}

/**
 * True for a line that is only a `//`, `/*`, or `*` comment.
 * Code-shape rules then do not read comment prose as code.
 */
function isCommentOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

const SOURCE_UNITS: Array<{ path: string; text: string }> = [];

async function checkFile(path: string) {
  const text = await Deno.readTextFile(path);
  SOURCE_UNITS.push({ path: relative(REPO_ROOT, path), text });
  checkFileFromText(path, text, CATALOG);
}

/** Whole-tree duplicate type-contract pass, run after the per-file checks. */
function runDuplicateTypePass(): void {
  const settings = ruleSettings(CATALOG, "duplicate-type");
  const options = settings.options as {
    minProperties?: number;
    allow?: Array<{ name: string; files: string[]; reason: string }>;
  };
  const include = settings.include ?? [];
  const prodUnits = SOURCE_UNITS.filter((unit) =>
    classifyRepoPath(unit.path) === "prod" &&
    (include.length === 0 || matchesAnyGlob(unit.path, include))
  );
  for (const duplicate of findDuplicateTypes(prodUnits, options)) {
    console.log(
      `ERROR [duplicate-type] ${duplicate.laterFile} – '${duplicate.name}' duplicates ${duplicate.firstFile}. Keep one owner and import it.`,
    );
    errorCount++;
  }
  for (const name of validateTypeAllowEntries(prodUnits, options)) {
    console.log(`ERROR [duplicate-type] the allow entry '${name}' matches no current duplicate.`);
    errorCount++;
  }
  if (SOURCE_UNITS.length > 0) console.log("✅ Duplicate type-contract pass complete.");
}

interface IStyleRuleContext {
  readonly path: string;
  readonly repoPath: string;
  readonly lines: string[];
  readonly catalog: ICatalog;
  readonly templateLiteralLines: Set<number>;
  readonly multilineFixtureExemptLines: Set<number>;
  readonly multilineFixtureWarnLines: Set<number>;
}

interface IMaskResult {
  readonly masked: boolean;
  readonly code: string | null;
  readonly rationale: string | null;
}

const UNMASKED: IMaskResult = { masked: false, code: null, rationale: null };

/** Resolves a warning rule's `style-exclude:CODE` masking for one line. */
function resolveMasking(
  rule: Rule,
  severity: "error" | "warn",
  lineToTest: string,
  idx: number,
  ctx: IStyleRuleContext,
): IMaskResult {
  if (severity !== "warn") return UNMASKED;
  const isFixtureWarn = rule.name === "test-inline-multiline-fixture" && ctx.multilineFixtureWarnLines.has(idx + 1);
  if (!rule.regex.test(lineToTest) && !isFixtureWarn) return UNMASKED;
  const exclusion = parseExclusionComment(idx > 0 ? ctx.lines[idx - 1].trim() : "", rule.name);
  return exclusion ? { masked: true, code: exclusion.code, rationale: exclusion.rationale } : UNMASKED;
}

/** Prints a `test-inline-multiline-fixture` warning and counts it. */
function reportFixtureWarning(
  rule: Rule,
  severity: "error" | "warn",
  idx: number,
  ctx: IStyleRuleContext,
  masking: IMaskResult,
): void {
  const actualSeverity = convertWarnings ? "error" : severity;
  const prefix = actualSeverity === "error" ? "ERROR" : "WARN";
  if (!masking.masked || showAllWarnings) {
    let msg = `${prefix} [${rule.name}] ${ctx.path}:${idx + 1} – ${rule.message}`;
    if (exclusionDict[rule.name]) {
      msg += `\n  Possible exclusion codes: ${Object.keys(exclusionDict[rule.name]).join(", ")}`;
    }
    if (masking.masked) msg += `\n  (masked by style-exclude:${masking.code} – ${masking.rationale})`;
    console.log(msg);
  }
  if (!masking.masked) {
    if (actualSeverity === "error") errorCount++;
    else warnCount++;
  }
}

/** True when a regex-rule violation must be suppressed (boundary/edition/masking guards). */
function isRegexViolationSuppressed(
  rule: Rule,
  severity: "error" | "warn",
  lineToTest: string,
  idx: number,
  ctx: IStyleRuleContext,
  masking: IMaskResult,
): boolean {
  if (rule.name === "re-export-imported" && isPackageEntrypoint(ctx.path) && isSamePackageReExport(lineToTest)) {
    return true;
  }
  if (
    (rule.name === "import-inside-statement" || rule.name === "dynamic-import") &&
    isEditionGatedTeamDynamicImport(ctx.repoPath, lineToTest)
  ) {
    return true;
  }
  if (severity === "warn" && masking.masked && !showAllWarnings) return true;
  if (rule.name === "dynamic-import") {
    const exclusion = parseExclusionComment(idx > 0 ? ctx.lines[idx - 1].trim() : "", rule.name);
    if (exclusion && !showAllWarnings) return true;
  }
  return false;
}

/** Prints a generic regex-rule violation and counts it. */
function reportRegexViolation(
  rule: Rule,
  severity: "error" | "warn",
  lineToTest: string,
  idx: number,
  ctx: IStyleRuleContext,
  masking: IMaskResult,
): void {
  if (isRegexViolationSuppressed(rule, severity, lineToTest, idx, ctx, masking)) return;
  const actualSeverity = convertWarnings ? "error" : severity;
  const prefix = actualSeverity === "error" ? "ERROR" : "WARN";
  let msg = `${prefix} [${rule.name}] ${ctx.path}:${idx + 1} – ${rule.message}`;
  if (severity === "warn" && exclusionDict[rule.name]) {
    msg += `\n  Possible exclusion codes: ${Object.keys(exclusionDict[rule.name]).join(", ")}`;
  }
  if (masking.masked) msg += `\n  (masked by style-exclude:${masking.code} – ${masking.rationale})`;
  console.log(msg);
  if (!masking.masked) {
    if (actualSeverity === "error") errorCount++;
    else warnCount++;
  }
}

/** Evaluates one rule against one line, reporting any violation. */
function evaluateStyleRuleLine(
  rule: Rule,
  severity: "error" | "warn",
  line: string,
  idx: number,
  ctx: IStyleRuleContext,
): void {
  if (ctx.templateLiteralLines.has(idx + 1) && rule.name !== "test-inline-multiline-fixture") return;
  if ((rule.name === "import-inside-statement" || rule.name === "dynamic-import") && isCommentOnlyLine(line)) {
    return;
  }
  const lineToTest = line;
  const masking = resolveMasking(rule, severity, lineToTest, idx, ctx);
  if (rule.name === "test-inline-multiline-fixture") {
    if (ctx.multilineFixtureExemptLines.has(idx + 1)) return;
    if (ctx.multilineFixtureWarnLines.has(idx + 1)) {
      reportFixtureWarning(rule, severity, idx, ctx, masking);
      return;
    }
  }
  if (!rule.regex.test(lineToTest)) return;
  reportRegexViolation(rule, severity, lineToTest, idx, ctx, masking);
}

/** Evaluates every catalog regex rule over the file's lines. */
function evaluateStyleRules(ctx: IStyleRuleContext): void {
  for (const rule of rules) {
    const severity = ruleEnabled(ctx.catalog, rule.name, ctx.repoPath);
    if (!severity) continue;
    if (rule.name === "re-export-imported" && isTestingCompatibilityShim(ctx.repoPath)) continue;
    for (let idx = 0; idx < ctx.lines.length; idx++) {
      evaluateStyleRuleLine(rule, severity, ctx.lines[idx], idx, ctx);
    }
  }
}

function packageBoundaryLabel(isTestFile: boolean, packageRoot: string): string {
  return isTestFile ? `Package tests under '${packageRoot}/${LAYOUT.testsRoot}'` : `Package module '${packageRoot}'`;
}

interface ICrossPackageImport {
  readonly normalizedImport: string;
  readonly packageRoot: string;
  readonly isTestFile: boolean;
  readonly importPath: string;
  readonly label: string;
}

/** Reports a relative import that reaches code in another package. */
function reportCrossPackageImport(repoPath: string, idx: number, info: ICrossPackageImport): void {
  const isCrossPackage = info.normalizedImport.startsWith(LAYOUT.packageRoot) &&
    !info.normalizedImport.startsWith(`${info.packageRoot}/`) &&
    !(info.isTestFile && info.normalizedImport.includes(LAYOUT.testsSegment)) &&
    !(info.packageRoot === LAYOUT.testingPackageRootBare && info.normalizedImport.startsWith(LAYOUT.aiTestAllow));
  if (!isCrossPackage) return;
  console.log(
    `ERROR [package-boundary] ${repoPath}:${
      idx + 1
    } – ${info.label} must not import code from another package ('${info.importPath}').`,
  );
  errorCount++;
}

/** Reports package-boundary violations for a relative import inside a package. */
function reportPackageBoundary(repoPath: string, line: string, idx: number): void {
  if (!repoPath.startsWith(LAYOUT.packageRoot)) return;
  const match = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
  const importPath = match?.[1];
  if (!importPath || !importPath.startsWith("..")) return;
  const normalizedImport = normalize(join(dirname(repoPath), importPath));
  const packageRoot = repoPath.split("/").slice(0, 2).join("/");
  const isTestFile = repoPath.includes(LAYOUT.testsSegment);
  const label = packageBoundaryLabel(isTestFile, packageRoot);

  if (normalizedImport.startsWith(LAYOUT.srcRoot)) {
    if (repoPath.startsWith(LAYOUT.mcpServerPrefix) || repoPath.startsWith(LAYOUT.mcpTestsPrefix)) return;
    console.log(
      `ERROR [package-boundary] ${repoPath}:${
        idx + 1
      } – ${label} must not import from the retired root ${LAYOUT.srcRoot} directory: '${importPath}'. Use @exaix/ package aliases instead.`,
    );
    errorCount++;
    return;
  }
  if (normalizedImport.startsWith(LAYOUT.testsRoot) && !normalizedImport.startsWith(LAYOUT.rootTestHelpers)) {
    if (!isTestFile) return;
    console.log(
      `ERROR [package-boundary] ${repoPath}:${
        idx + 1
      } – Package tests under '${packageRoot}/${LAYOUT.testsRoot}' must not import test fixtures from the root ${LAYOUT.testsRoot} directory: '${importPath}'.`,
    );
    errorCount++;
    return;
  }
  reportCrossPackageImport(repoPath, idx, { normalizedImport, packageRoot, isTestFile, importPath, label });
}

function reportPromotedSubpackage(
  repoPath: string,
  line: string,
  idx: number,
  normalizedImport: string,
  importPath: string,
): void {
  if (!/^\s*export\b/.test(line) || !isPackageRootEntrypoint(repoPath)) return;
  const promoted = findPromotedSubpackageAliasForParentEntrypoint(normalizedImport, repoPath);
  if (!promoted) return;
  console.log(
    `ERROR [package-subpath-promotion] ${repoPath}:${
      idx + 1
    } – Parent package entrypoints must not re-export canonical subpackage surfaces. Export this API from '${promoted.alias}' instead of promoting '${importPath}' through '${repoPath}'.`,
  );
  errorCount++;
}

function reportPackageTestingImport(
  repoPath: string,
  idx: number,
  normalizedImport: string,
  importPath: string,
): void {
  const info = getPackageTestingAliasForTestImport(normalizedImport);
  if (!info) return;
  const owningRoot = `${LAYOUT.packageRoot}${info.packageName}/${LAYOUT.testsRoot}`;
  if (repoPath.startsWith(owningRoot)) return;
  console.log(
    `ERROR [package-testing-import] ${repoPath}:${
      idx + 1
    } – Import package-specific test support from '${info.alias}' instead of deep-importing '${importPath}' from '${owningRoot}'.`,
  );
  errorCount++;
}

function reportPackageCanonicalAlias(
  repoPath: string,
  idx: number,
  normalizedImport: string,
  importPath: string,
): void {
  const info = findCanonicalPackageAlias(normalizedImport, repoPath);
  if (!info) return;
  console.log(
    `ERROR [package-canonical-import] ${repoPath}:${
      idx + 1
    } – Import from '${info.alias}' instead of deep-importing the package-owned path '${importPath}'.`,
  );
  errorCount++;
}

function reportCanonicalSpecifierAliases(repoPath: string, idx: number, importPath: string): void {
  const specifierInfo = findCanonicalPackageAliasForSpecifier(importPath);
  if (specifierInfo) {
    console.log(
      `ERROR [package-canonical-import] ${repoPath}:${
        idx + 1
      } – Import from '${specifierInfo.alias}' instead of deep-importing the canonical package subpath '${importPath}'.`,
    );
    errorCount++;
    return;
  }
  const teamAlias = publicPackageAliases.find(
    (a) => a.alias.startsWith("@exaix-team") && a.rootPath === a.packageRoot && importPath.startsWith(`${a.alias}/`),
  );
  if (!teamAlias) return;
  console.log(
    `ERROR [package-canonical-import] ${repoPath}:${
      idx + 1
    } – Import from '${teamAlias.alias}' instead of deep-importing the canonical package subpath '${importPath}'.`,
  );
  errorCount++;
}

/** Reports canonical-alias and subpath-promotion import violations for a line. */
function reportCanonicalImports(repoPath: string, line: string, idx: number): void {
  const match = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
  const importPath = match?.[1];
  if (!importPath) return;
  const normalizedImport = resolveRepoImportPath(repoPath, importPath);
  if (normalizedImport) {
    reportPromotedSubpackage(repoPath, line, idx, normalizedImport, importPath);
    reportPackageTestingImport(repoPath, idx, normalizedImport, importPath);
    reportPackageCanonicalAlias(repoPath, idx, normalizedImport, importPath);
  }
  reportCanonicalSpecifierAliases(repoPath, idx, importPath);
}

/** Reports a lower-edition module importing a higher edition (source/build leak). */
function reportEditionLeak(repoPath: string, line: string, lines: string[], idx: number): void {
  if (!isEditionLeakImport(repoPath, line, lines.slice(0, idx))) return;
  console.log(
    `ERROR [edition-leak] ${repoPath}:${
      idx + 1
    } – Lower-edition module must not import a higher edition: '${line.trim()}'. A Solo build must not reference Team/Enterprise code. Use a type-only import for types, or an edition-gated (editionType-guarded) dynamic import() in a dispatch entry; otherwise extract the shared contract into ${LAYOUT.packageRoot}core.`,
  );
  errorCount++;
}

/** Reports a functional deployable module importing from the tests/ folder. */
function reportProductionToTestsImport(repoPath: string, line: string, idx: number): void {
  const match = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
  const importPath = match?.[1];
  if (!importPath || !isProductionToTestsImport(repoPath, importPath)) return;
  console.log(
    `ERROR [package-tests-boundary] ${repoPath}:${
      idx + 1
    } – Functional deployable module must not import from the ${LAYOUT.testsRoot} folder: '${importPath}'. Move shared code into a package under ${LAYOUT.packageRoot} (test code is excluded from a deployed workspace).`,
  );
  errorCount++;
}

/** Reports a package module importing a retired root implementation path. */
function reportPackageSrcBoundary(repoPath: string, line: string, idx: number): void {
  if (!repoPath.startsWith(LAYOUT.packageRoot)) return;
  const match = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
  const importPath = match?.[1];
  if (!importPath) return;
  let normalizedImport: string | null = null;
  if (importPath.startsWith(".")) normalizedImport = normalize(join(dirname(repoPath), importPath));
  else if (importPath.startsWith(LAYOUT.srcRoot)) normalizedImport = normalize(importPath);
  if (normalizedImport === null || !RETIRED_ROOT_PACKAGE_IMPORT_PATHS.has(normalizedImport)) return;
  const packageRoot = repoPath.split("/").slice(0, 2).join("/");
  console.log(
    `ERROR [package-src-boundary] ${repoPath}:${
      idx + 1
    } – Package-owned modules under '${packageRoot}/' must not import retired root implementation paths like '${normalizedImport}'. Use the package-owned source of truth instead.`,
  );
  errorCount++;
}

/** Reports `export { Foo as Bar }` re-exports of imported names. Returns true to skip the line. */
function checkNamedReExport(
  path: string,
  line: string,
  trimmed: string,
  idx: number,
  importedNames: Map<string, number>,
): boolean {
  const namedExportMatch = line.match(/^\s*export\s+(type\s+)?{([^}]*)}\s*;?\s*$/);
  if (!namedExportMatch || path.endsWith("/mod.ts") || path.endsWith("/index.ts")) return false;

  for (const entry of namedExportMatch[2].split(",")) {
    const parts = entry.trim().split(/\s+as\s+/);
    const name = parts[0].trim();
    if (!importedNames.has(name)) continue;
    const importLine = importedNames.get(name)!;
    const isImmediate = importLine === idx; // idx is 0-indexed and importLine is 1-indexed
    const message = isImmediate
      ? `Improper re-export of '${name}' on the next line after its import. Combine into 'export ${
        namedExportMatch[1] || ""
      }{ ... } from ...' or define it locally.`
      : `Exporting imported entity '${name}' (imported on line ${importLine}) is prohibited. Define it locally or export it from its origin.`;
    console.log(`ERROR [re-export-imported] ${path}:${idx + 1} – ${message}`);
    errorCount++;
  }

  return !trimmed.includes("=") && (trimmed.endsWith(";") || trimmed.endsWith("}"));
}

/** Runs every style check over one source unit, with `catalog` supplying the settings. */
interface IScanState {
  inMultiLineComment: boolean;
  inMultiLineImport: boolean;
  inTypeDeclaration: boolean;
  protectedBraceCount: number;
  functionalCodeLineNum: number;
  firstImportLineNum: number;
  lastImportLineNum: number;
  firstInterfaceLineNum: number;
  headerFound: boolean;
  firstContentLineNum: number;
  paramDepth: number;
  importedNames: Map<string, number>;
  inParamList: boolean;
  currentParamCount: number;
  paramListStartLine: number;
  importFollowingInterface: Map<number, number>;
  importFollowingFunctional: Map<number, number>;
}

interface IScanResult {
  readonly headerFound: boolean;
  readonly firstImportLineNum: number;
  readonly lastImportLineNum: number;
  readonly firstInterfaceLineNum: number;
  readonly importFollowingInterface: Map<number, number>;
  readonly importFollowingFunctional: Map<number, number>;
}

/** Returns the net brace count of one trimmed line. */
function countBraces(trimmed: string): number {
  const openers = (trimmed.match(/{/g) || []).length;
  const closers = (trimmed.match(/}/g) || []).length;
  return openers - closers;
}

/** True when the line starts a single-line or multi-line import statement. */
function isImportStartLine(line: string): boolean {
  return (/^\s*import\b/.test(line) && !/^\s*import(\.|\s*\(|\s*:)/.test(line)) ||
    /^\s*export\s+\*\s+from\b/.test(line) ||
    /^\s*export\s+{[^}]*}\s+from\b/.test(line) ||
    /^\s*export\s+type\s+{[^}]*}\s+from\b/.test(line);
}

/** True when the line starts a type, interface, enum, or declare block. */
function isTypeStartLine(line: string): boolean {
  return /^\s*((export|declare)\s+)?(type|interface|enum)\b/.test(line) ||
    /^\s*declare\s+(const|let|var|function|class)\b/.test(line);
}

/** Tracks comment and header state. Returns true when the line is comment content. */
function handleCommentLine(trimmed: string, idx: number, state: IScanState): boolean {
  if (state.inMultiLineComment) {
    if (trimmed.includes("*/")) {
      state.inMultiLineComment = false;
      if (state.firstContentLineNum === -1 && idx < 10) state.headerFound = true;
    }
    return true;
  }
  if (trimmed.startsWith("/*")) {
    if (state.firstContentLineNum === -1 && idx < 5) state.headerFound = true;
    if (!trimmed.includes("*/")) state.inMultiLineComment = true;
    return true;
  }
  if (trimmed.startsWith("//")) {
    if (state.firstContentLineNum === -1 && idx < 5) state.headerFound = true;
    return true;
  }
  return false;
}

/** Collects names from an ongoing multi-line import. Returns true when still inside one. */
function handleMultiLineImportContinue(trimmed: string, idx: number, state: IScanState): boolean {
  if (!state.inMultiLineImport) return false;
  for (const raw of trimmed.replace(/}.*/, "").split(",")) {
    const parts = raw.trim().split(/\s+as\s+/);
    const name = parts.pop()?.trim();
    if (name && name !== "from" && name !== "import") state.importedNames.set(name, idx + 1);
  }
  if (trimmed.includes("} from")) {
    state.inMultiLineImport = false;
    state.lastImportLineNum = idx + 1;
  }
  return true;
}

/** Tracks a protected brace block. Returns true when the line is inside one. */
function handleProtectedBlock(trimmed: string, state: IScanState): boolean {
  if (state.protectedBraceCount <= 0) return false;
  state.protectedBraceCount += countBraces(trimmed);
  if (state.protectedBraceCount === 0 && state.inTypeDeclaration) state.inTypeDeclaration = false;
  return true;
}

/** Tracks a multi-line type declaration. Returns true when the line is inside one. */
function handleTypeDeclarationContinue(line: string, trimmed: string, state: IScanState): boolean {
  if (!state.inTypeDeclaration) return false;
  state.protectedBraceCount += countBraces(trimmed);
  if (
    state.protectedBraceCount === 0 &&
    (trimmed.endsWith(";") || (trimmed.endsWith("}") && !trimmed.includes("{")) || /^\s*}\s*;?\s*$/.test(line))
  ) {
    state.inTypeDeclaration = false;
  }
  return true;
}

/** Handles comment, shebang, import, brace, and template-literal skip lines. */
function skipLeadingBlock(
  line: string,
  trimmed: string,
  idx: number,
  state: IScanState,
  templateLiteralLines: Set<number>,
): boolean {
  if (!trimmed) return true;
  if (handleCommentLine(trimmed, idx, state)) return true;
  if (trimmed.startsWith("#!")) return true;
  if (state.firstContentLineNum === -1) state.firstContentLineNum = idx + 1;
  if (handleMultiLineImportContinue(trimmed, idx, state)) return true;
  if (handleProtectedBlock(trimmed, state)) return true;
  if (templateLiteralLines.has(idx + 1)) return true;
  return handleTypeDeclarationContinue(line, trimmed, state);
}

/** Records names and interface-rename findings from an import clause. */
function collectImportNames(path: string, trimmed: string, idx: number, state: IScanState): void {
  const namedMatch = trimmed.match(/{([^}]*)/);
  if (namedMatch) {
    for (const raw of namedMatch[1].replace(/}.*/, "").split(",")) {
      const parts = raw.trim().split(/\s+as\s+/);
      const name = parts.pop()?.trim();
      const isCompatShim = path.endsWith(LAYOUT.markdownCompatSuffix);
      if (!isCompatShim && parts.length > 0 && /^I[A-Z]/.test(parts[0].trim())) {
        console.log(
          `ERROR [no-interface-rename-on-import] ${path}:${idx + 1} – Renaming interface '${
            parts[0].trim()
          }' to '${name}' is prohibited. Use the original name.`,
        );
        errorCount++;
      }
      if (name && name !== "from" && name !== "import") state.importedNames.set(name, idx + 1);
    }
  }
  const defaultMatch = trimmed.match(/^import\s+([\w$]+)[,\s]/);
  if (defaultMatch && defaultMatch[1] !== "type" && defaultMatch[1] !== "*") {
    state.importedNames.set(defaultMatch[1], idx + 1);
  }
  const namespaceMatch = trimmed.match(/import\s+\*\s+as\s+([\w$]+)/);
  if (namespaceMatch) state.importedNames.set(namespaceMatch[1], idx + 1);
}

/** Runs every import-line check and updates import placement state. */
function scanImportLine(
  path: string,
  line: string,
  trimmed: string,
  idx: number,
  lines: string[],
  isImportStart: boolean,
  state: IScanState,
): void {
  if (isImportStart) {
    if (state.firstImportLineNum === -1) state.firstImportLineNum = idx + 1;
    state.lastImportLineNum = idx + 1;
    if (trimmed.startsWith("import")) collectImportNames(path, trimmed, idx, state);
    if (trimmed.includes("{") && !trimmed.includes("} from")) state.inMultiLineImport = true;
  }

  const relativePath = path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;

  reportProductionToTestsImport(relativePath, line, idx);
  reportEditionLeak(relativePath, line, lines, idx);
  reportPackageBoundary(relativePath, line, idx);
  reportCanonicalImports(relativePath, line, idx);
  reportPackageSrcBoundary(relativePath, line, idx);

  if (state.inMultiLineImport && trimmed.includes("} from")) state.inMultiLineImport = false;
  if (state.firstInterfaceLineNum !== -1) {
    state.importFollowingInterface.set(idx + 1, state.firstInterfaceLineNum);
  }
  if (state.functionalCodeLineNum !== -1) {
    state.importFollowingFunctional.set(idx + 1, state.functionalCodeLineNum);
  }
}

/** Reports an exported interface whose name does not start with a capital I. */
function reportInterfaceNaming(path: string, line: string, idx: number): void {
  const match = line.match(/^\s*export\s+interface\s+([A-Za-z0-9_$]+)/);
  if (!match) return;
  const name = match[1];
  if (name.startsWith("I") && (name.length <= 1 || name[1] === name[1].toUpperCase())) return;
  console.log(
    `ERROR [exported-interface-naming] ${path}:${
      idx + 1
    } – Exported interface '${name}' must start with a capital 'I' (e.g., I${name}).`,
  );
  errorCount++;
}

/** Tracks a type/interface/enum block start and reports placement findings. */
function scanTypeStart(path: string, line: string, trimmed: string, idx: number, state: IScanState): void {
  if (state.firstInterfaceLineNum === -1) state.firstInterfaceLineNum = idx + 1;
  state.protectedBraceCount += countBraces(trimmed);
  if (state.functionalCodeLineNum !== -1 && /^\s*export\s+interface\b/.test(line)) {
    console.log(
      `ERROR [exported-interface-placement] ${path}:${
        idx + 1
      } – Exported interfaces must be at the top, preceding functional code (functional code started at line ${state.functionalCodeLineNum}).`,
    );
    errorCount++;
  }
  if (state.protectedBraceCount > 0 || (!trimmed.endsWith(";") && !trimmed.endsWith("}"))) {
    state.inTypeDeclaration = true;
  }
  reportInterfaceNaming(path, line, idx);
}

/** Adds any top-level comma count in text to the parameter tally. */
function countParamsInText(content: string, state: IScanState): void {
  for (const char of content) {
    if (char === "<" || char === "{") state.paramDepth++;
    if (char === ">" || char === "}") state.paramDepth--;
    if (char === "," && state.paramDepth === 0) state.currentParamCount++;
  }
}

/** Reports a parameter-list that exceeds the configured maximum. */
function reportMaxParamsIfNeeded(path: string, maxParams: number, state: IScanState): void {
  if (state.currentParamCount < maxParams) return;
  console.log(
    `ERROR [max-params] ${path}:${state.paramListStartLine} – Methods and functions must not exceed ${maxParams} parameters (found ${
      state.currentParamCount + 1
    }). Refactor to use a parameter object.`,
  );
  errorCount++;
}

/** Continues counting parameters across the lines of an open parameter list. */
function continueParamList(path: string, line: string, maxParams: number, state: IScanState): void {
  const closingIdx = line.indexOf(")");
  const content = closingIdx !== -1 ? line.substring(0, closingIdx) : line;
  countParamsInText(content, state);
  if (closingIdx === -1) return;
  reportMaxParamsIfNeeded(path, maxParams, state);
  state.inParamList = false;
}

/** True when the line looks like a function signature that opens a parameter list. */
function isParamStartLine(trimmed: string, state: IScanState): boolean {
  const looksLikeFunction = trimmed.includes("function ") || trimmed.includes("constructor") ||
    /\b(private|public|protected|async|static|readonly)\b.*\(/.test(trimmed);
  return looksLikeFunction && !state.inParamList && !state.inTypeDeclaration &&
    !state.inMultiLineComment && !state.inMultiLineImport && !trimmed.startsWith("import");
}

/** Opens a parameter list for the line. Returns true while the list stays open. */
function startParamList(path: string, line: string, idx: number, maxParams: number, state: IScanState): boolean {
  const openingIdx = line.indexOf("(");
  if (openingIdx === -1) return false;
  state.inParamList = true;
  state.paramListStartLine = idx + 1;
  state.currentParamCount = 0;
  state.paramDepth = 0;
  const closingIdx = line.indexOf(")", openingIdx);
  const content = closingIdx !== -1 ? line.substring(openingIdx + 1, closingIdx) : line.substring(openingIdx + 1);
  countParamsInText(content, state);
  if (closingIdx !== -1) {
    reportMaxParamsIfNeeded(path, maxParams, state);
    state.inParamList = false;
  }
  return state.inParamList;
}

/** Pre-scans one source unit, collecting import and interface placement state. */
function scanFileLines(
  path: string,
  lines: string[],
  templateLiteralLines: Set<number>,
  maxParams: number,
): IScanResult {
  const state: IScanState = {
    inMultiLineComment: false,
    inMultiLineImport: false,
    inTypeDeclaration: false,
    protectedBraceCount: 0,
    functionalCodeLineNum: -1,
    firstImportLineNum: -1,
    lastImportLineNum: -1,
    firstInterfaceLineNum: -1,
    headerFound: false,
    firstContentLineNum: -1,
    paramDepth: 0,
    importedNames: new Map<string, number>(),
    inParamList: false,
    currentParamCount: 0,
    paramListStartLine: -1,
    importFollowingInterface: new Map<number, number>(),
    importFollowingFunctional: new Map<number, number>(),
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (skipLeadingBlock(line, trimmed, idx, state, templateLiteralLines)) continue;

    const isImportStart = isImportStartLine(line);
    if (isImportStart || state.inMultiLineImport) {
      scanImportLine(path, line, trimmed, idx, lines, isImportStart, state);
      continue;
    }
    if (checkNamedReExport(path, line, trimmed, idx, state.importedNames)) continue;

    if (isTypeStartLine(line)) {
      scanTypeStart(path, line, trimmed, idx, state);
      continue;
    }

    if (state.inParamList) {
      continueParamList(path, line, maxParams, state);
      continue;
    }
    if (isParamStartLine(trimmed, state) && startParamList(path, line, idx, maxParams, state)) {
      continue;
    }

    if (state.functionalCodeLineNum === -1 && state.protectedBraceCount === 0) {
      state.functionalCodeLineNum = idx + 1;
    }
  }

  return {
    headerFound: state.headerFound,
    firstImportLineNum: state.firstImportLineNum,
    lastImportLineNum: state.lastImportLineNum,
    firstInterfaceLineNum: state.firstInterfaceLineNum,
    importFollowingInterface: state.importFollowingInterface,
    importFollowingFunctional: state.importFollowingFunctional,
  };
}

function checkFileFromText(path: string, text: string, catalog: ICatalog): void {
  const repoPath = path.startsWith(REPO_ROOT + "/") ? path.slice(REPO_ROOT.length + 1) : path;
  const lines = text.split(/\r?\n/);
  const maxParams = Number(ruleSettings(catalog, "max-params").options.max ?? 7);
  const longCommentMaxLines = Number(ruleSettings(catalog, "long-comment").options.maxLines ?? 3);
  const minFixtureLines = Number(ruleSettings(catalog, "test-inline-multiline-fixture").options.minLines ?? 7);

  // Single parse per file: the layer-leak check and the template-literal line
  // ranges both read from this SourceFile.
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

  // AST-based layer-aware constant import check (supersedes the old regex rule)
  checkLayerLeaks(sourceFile, repoPath);

  checkCommentDates(repoPath, text);
  checkTestFileName(repoPath);

  const templateLiteralLines = collectTemplateLiteralLines(sourceFile);

  checkCommentDiscipline(repoPath, lines, templateLiteralLines, longCommentMaxLines);

  const scan = scanFileLines(path, lines, templateLiteralLines, maxParams);

  for (let idx = 0; idx < lines.length; idx++) {
    if (templateLiteralLines.has(idx + 1)) {
      continue;
    }

    const line = lines[idx];
    const namedImportMatch = line.match(/^\s*import(?:\s+type)?\s*{([^}]*)}\s*from\s+["']([^"']+)["'];?/);
    if (!namedImportMatch) {
      continue;
    }

    const importClause = namedImportMatch[1];
    const importPath = namedImportMatch[2];
    const normalizedImport = resolveRepoImportPath(repoPath, importPath);
    if (!normalizedImport) {
      continue;
    }

    const shimInfo = rootTestingShimExports.get(normalizedImport);
    if (!shimInfo) {
      continue;
    }

    const importedSymbols = parseNamedSymbols(importClause);
    const offendingSymbols = importedSymbols.filter((symbol) => shimInfo.exportedNames.has(symbol));
    if (offendingSymbols.length === 0) {
      continue;
    }

    console.log(
      `ERROR [package-testing-import] ${repoPath}:${idx + 1} – Import ${
        offendingSymbols.join(", ")
      } from '${shimInfo.alias}' instead of routing package-owned test support through '${importPath}'.`,
    );
    errorCount++;
  }

  checkModuleHeader(path, repoPath, lines, scan.headerFound);
  checkImportPlacement(path, {
    firstImportLineNum: scan.firstImportLineNum,
    lastImportLineNum: scan.lastImportLineNum,
    firstInterfaceLineNum: scan.firstInterfaceLineNum,
    importFollowingInterface: scan.importFollowingInterface,
    importFollowingFunctional: scan.importFollowingFunctional,
  });

  // TUI and CLI boundary isolation checks (CODE_STYLE.md 8 and 9)
  checkTuiBoundary(path, lines);
  checkCliBoundary(path, lines);

  // Package Module Purity (CODE_STYLE.md 13)
  checkPackagePurity(repoPath, lines);

  const { exempt: multilineFixtureExemptLines, warn: multilineFixtureWarnLines } = collectMultilineFixtureLines(
    lines,
    minFixtureLines,
  );

  evaluateStyleRules({
    path,
    repoPath,
    lines,
    catalog,
    templateLiteralLines,
    multilineFixtureExemptLines,
    multilineFixtureWarnLines,
  });
}

export interface IFinding {
  readonly severity: "error" | "warn";
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const FINDING_LINE = /^(ERROR|WARN) \[([^\]]+)\] (.*):(\d+) – (.*)$/;

/** Runs every style check over one source unit and returns findings, without printing. */
export function checkSource(repoPath: string, text: string, catalog: ICatalog): IFinding[] {
  const captured: string[] = [];
  const originalLog = console.log;
  const savedErrors = errorCount;
  const savedWarnings = warnCount;
  console.log = (...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    checkFileFromText(repoPath, text, catalog);
  } finally {
    console.log = originalLog;
    errorCount = savedErrors;
    warnCount = savedWarnings;
  }
  return captured
    .flatMap((entry) => entry.split("\n"))
    .map((line) => line.match(FINDING_LINE))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      severity: match[1] === "ERROR" ? "error" : "warn",
      rule: match[2],
      file: match[3],
      line: Number(match[4]),
      message: match[5],
    }));
}

/** The tags a rule declares in the catalog (empty when the id is unknown). */
function ruleTags(catalog: ICatalog, ruleName: string): readonly string[] {
  return catalog.rules[ruleName]?.tags ?? [];
}

/** Parses `--tags=` or `--tags <list>`. Exits 2 on an unknown tag. */
function parseTagFilter(catalog: ICatalog): Set<string> | null {
  const equalsArg = Deno.args.find((arg) => arg.startsWith("--tags="));
  let raw: string | undefined = equalsArg?.slice("--tags=".length);
  if (raw === undefined) {
    const index = Deno.args.indexOf("--tags");
    if (index !== -1) raw = Deno.args[index + 1];
  }
  if (raw === undefined) return null;
  const tags = raw.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  const known = new Set(Object.keys(catalog.tagVocabulary));
  for (const tag of tags) {
    if (!known.has(tag)) {
      console.error(`Unknown tag '${tag}'. Known tags: ${[...known].sort().join(", ")}.`);
      Deno.exit(2);
    }
  }
  return new Set(tags);
}

/** True when a captured finding line's rule carries at least one selected tag. */
function findingMatchesTags(catalog: ICatalog, line: string, tags: Set<string>): boolean {
  const match = line.match(FINDING_LINE);
  if (!match) return false;
  return ruleTags(catalog, match[2]).some((tag) => tags.has(tag));
}

/** Prints the tag-filtered findings and per-tag counts. Exits 1 on any error. */
function emitTaggedFindings(buffered: string[], tags: Set<string>): void {
  errorCount = 0;
  warnCount = 0;
  const perTag = new Map<string, { errors: number; warnings: number }>();
  for (const tag of tags) perTag.set(tag, { errors: 0, warnings: 0 });

  for (const line of buffered) {
    if (!findingMatchesTags(CATALOG, line, tags)) continue;
    console.log(line);
    const match = line.match(FINDING_LINE);
    const isError = match?.[1] === "ERROR";
    if (isError) errorCount++;
    else warnCount++;
    for (const tag of ruleTags(CATALOG, match?.[2] ?? "")) {
      if (!tags.has(tag)) continue;
      const counts = perTag.get(tag)!;
      if (isError) counts.errors++;
      else counts.warnings++;
    }
  }

  const summary = [...tags].sort().map((tag) => {
    const counts = perTag.get(tag)!;
    return `${tag}: ${counts.errors} error(s), ${counts.warnings} warning(s)`;
  }).join("; ");
  console.log(
    `\nstyle check completed (tags: ${[...tags].sort().join(",")}): ${errorCount} error(s), ${warnCount} warning(s)`,
  );
  console.log(`per-tag: ${summary}`);
  if (errorCount > 0) Deno.exit(1);
}

/** Walks the requested paths and runs every enabled rule over each file. */
async function runAllChecks(manualPaths: string[]): Promise<void> {
  if (manualPaths.length > 0) {
    for (const p of manualPaths) {
      const fullPath = p.startsWith("/") ? p : join(Deno.cwd(), p);
      try {
        const stat = await Deno.stat(fullPath);
        if (stat.isFile) {
          await checkFile(fullPath);
        } else {
          for await (
            const entry of walk(fullPath, {
              includeDirs: false,
              exts: [".ts", ".tsx"],
              followSymlinks: false,
              skip: IGNORE_GLOBS,
            })
          ) {
            await checkFile(entry.path);
          }
        }
      } catch (e) {
        console.error(`Error checking path ${p}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return;
  }

  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
      skip: IGNORE_GLOBS,
    })
  ) {
    if (!entry.isFile) {
      continue;
    }
    await checkFile(entry.path);
  }
}

async function main() {
  // Request read permission for the repo root if not already granted
  await Deno.permissions.request({ name: "read", path: REPO_ROOT });

  const tagIndex = Deno.args.indexOf("--tags");
  const tagValueIndex = tagIndex !== -1 ? tagIndex + 1 : -1;
  const manualPaths = Deno.args.filter((arg, i) => !arg.startsWith("-") && i !== tagValueIndex);

  const tagFilter = parseTagFilter(CATALOG);
  if (tagFilter) {
    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      captured.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      await runAllChecks(manualPaths);
    } finally {
      console.log = originalLog;
    }
    emitTaggedFindings(captured, tagFilter);
    return;
  }

  await runAllChecks(manualPaths);
  // The duplicate-type pass needs the whole tree, so it runs only on the unscoped run.
  if (manualPaths.length === 0) runDuplicateTypePass();

  console.log(`\nstyle check completed: ${errorCount} error(s), ${warnCount} warning(s)`);
  if (errorCount > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
