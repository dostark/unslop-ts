#!/usr/bin/env -S deno run -A
/**
 * @module CheckMagicValues
 * @path packages/lint-rules/src/exaix/check_magic_values.ts
 * @description Magic Value Detector — scans TypeScript sources using the compiler API
 * AST to find repeated string/number literals that should be extracted
 * into named constants or enums.
 * @architectural-layer Tooling
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [packages/lint-rules/src/exaix/check_code_style.ts]
 *
 * Usage:
 *   deno run -A packages/lint-rules/src/exaix/check_magic_values.ts          # strings + numbers
 *   deno run -A packages/lint-rules/src/exaix/check_magic_values.ts --no-numbers  # strings only
 *   deno run -A packages/lint-rules/src/exaix/check_magic_values.ts --include-tests  # include tests
 *
 * The repository root comes from `--root=` or the working directory. Run it from the
 * repository root, as the `check:magic` task does.
 *
 * Thresholds (per-module / global):
 *   strings:  occurrences > 3  (local)  / > 5  (global)
 *   numbers:  occurrences > 4  (local)  / > 6  (global)
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { classifyPath, type PathClass } from "@exaix/lint-rules";
import { LAYOUT } from "./repo_layout.ts";
import catalogJson from "../../../../scripts/config/style_rule_catalog.json" with { type: "json" };

const CATALOG_SCOPES = catalogJson.scopes as { test: string[]; fixture: string[] };

// CLI flags

const args = new Set(Deno.args);
const checkNumbers = !args.has("--no-numbers") && !args.has("--strings-only");
const includeTests = args.has("--include-tests");

function getNumericFlagValue(flag: string): number | undefined {
  const prefix = `${flag}=`;
  for (const arg of Deno.args) {
    if (arg.startsWith(prefix)) {
      const raw = arg.slice(prefix.length).trim();
      if (raw.length === 0) {
        console.error(`Invalid value for ${flag}: value is required`);
        Deno.exit(1);
      }

      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        console.error(`Invalid value for ${flag}: ${raw} (expected non-negative integer)`);
        Deno.exit(1);
      }

      return parsed;
    }
  }
  return undefined;
}

if (args.has("--help") || args.has("-h")) {
  console.log(`Magic Value Detector

Usage:
  deno run -A ${LAYOUT.packageRoot}lint-rules/${LAYOUT.srcRoot}exaix/check_magic_values.ts [options]

Options:
  --no-numbers, --strings-only  Skip number literal checks (strings only)
  --include-tests               Include test files in scan (default: false)
  --local-string-threshold=N    Local threshold for string literals (default: 3)
  --global-string-threshold=N   Global threshold for string literals (default: 5)
  --local-number-threshold=N    Local threshold for number literals (default: 4)
  --global-number-threshold=N   Global threshold for number literals (default: 6)
  --help, -h                    Show this help message

Thresholds (occurrences that trigger a violation):
  Strings  — local: > 3  |  global: > 5
  Numbers  — local: > 4  |  global: > 6

Output is sorted by:
  1. Candidate score (descending)
  2. Scope (GLOBAL before MODULE)
  3. Number of distinct files affected (descending)
  4. Total occurrences (descending)

For each violation, a per-file breakdown is shown.
`);
  Deno.exit(0);
}

// Configuration

const LOCAL_STRING_THRESHOLD = 3;
const GLOBAL_STRING_THRESHOLD = 5;
const LOCAL_NUMBER_THRESHOLD = 4;
const GLOBAL_NUMBER_THRESHOLD = 6;

const localStringThreshold = getNumericFlagValue("--local-string-threshold") ??
  LOCAL_STRING_THRESHOLD;
const globalStringThreshold = getNumericFlagValue("--global-string-threshold") ??
  GLOBAL_STRING_THRESHOLD;
const localNumberThreshold = getNumericFlagValue("--local-number-threshold") ??
  LOCAL_NUMBER_THRESHOLD;
const globalNumberThreshold = getNumericFlagValue("--global-number-threshold") ??
  GLOBAL_NUMBER_THRESHOLD;

const STRING_WHITELIST = new Set([
  "",
  " ",
  "\n",
  "\t",
  "\\n",
  "\\t",
  "true",
  "false",
  "null",
  "undefined",
  // typeof checks — these are structural, not magic values
  "string",
  "number",
  "boolean",
  "object",
  "function",
  "undefined",
  "symbol",
  "bigint",
  "unknown",
  "any",
  "never",
  "void",
  // Common English words that appear in stop-word lists across the codebase
  "other",
]);
const NUMBER_WHITELIST = new Set([0, 1, -1]);

/** Skip numbers below this threshold (below 100 are usually indices, counts, small offsets) */
const MIN_NUMBER_THRESHOLD = 100;

/** Skip strings shorter than this length */
const SHORT_STRING_MIN_LENGTH = 4;

/** Skip strings that look like constant names or env vars (all uppercase with underscores/digits) */
const ALL_CAPS_REGEX = /^[A-Z][A-Z0-9_]*$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FILE_OR_PATH_REGEX = /[\\/]|\.[A-Za-z0-9]{1,8}$/;
const CLI_FLAG_REGEX = /^--?[a-z0-9][a-z0-9-]*$/i;
const MIME_TYPE_REGEX = /^[a-z]+\/[a-z0-9.+-]+$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_WITH_NUMERIC_SUFFIX_REGEX = /^[a-z][a-z0-9_-]*[-_][0-9]+$/i;
const STDIO_PIPE_FIELD_NAMES = new Set(["stdout", "stderr", "stdin"]);
const STRUCTURAL_METADATA_PROPERTY_NAMES = new Set([
  "description",
  "title",
  "label",
  "placeholder",
]);
const STRUCTURAL_STRING_ARRAY_PROPERTY_NAMES = new Set([
  "args",
  "enum",
  "capabilities",
  "tags",
]);

const WAIT_STATE_STATUS_LITERALS = new Set([
  "pending",
  "resumed",
  "fulfilled",
  "rejected",
  "amended",
  "expired",
  "cancelled",
]);

const ROUND_NUMBER_STEP = 50;
const ROUND_NUMBER_MAX = 1_000;
const HTTP_STATUS_MIN = 100;
const HTTP_STATUS_MAX = 599;

const SCORE_SCOPE_GLOBAL_BONUS = 25;
const SCORE_SCOPE_LOCAL_BONUS = 10;
const SCORE_PER_OCCURRENCE = 3;
const SCORE_PER_DISTINCT_FILE = 5;
const SCORE_EXISTING_CONSTANT_BONUS = 40;

/** Classifies a repository-relative path with the shared catalog scopes. */
export function classifyRepoPath(filePath: string): PathClass {
  return classifyPath(filePath, CATALOG_SCOPES);
}

function isTestFilePath(filePath: string): boolean {
  return classifyRepoPath(filePath) === "test";
}

function isConstantOrEnumFilePath(filePath: string): boolean {
  return filePath.endsWith("constants.ts") || filePath.endsWith("enums.ts");
}

function isLikelyStructuralString(value: string): boolean {
  return UUID_REGEX.test(value) ||
    SEMVER_REGEX.test(value) ||
    FILE_OR_PATH_REGEX.test(value) ||
    CLI_FLAG_REGEX.test(value) ||
    MIME_TYPE_REGEX.test(value) ||
    EMAIL_REGEX.test(value) ||
    ID_WITH_NUMERIC_SUFFIX_REGEX.test(value);
}

function isLikelyStructuralNumber(value: number): boolean {
  if (value >= HTTP_STATUS_MIN && value <= HTTP_STATUS_MAX) {
    return true;
  }

  if (value % ROUND_NUMBER_STEP === 0 && value <= ROUND_NUMBER_MAX) {
    return true;
  }

  return false;
}

/** Resolves the repository root from `--root=` or the working directory. */
function resolveRepoRoot(): string {
  const rootArg = Deno.args.find((arg) => arg.startsWith("--root="));
  return rootArg ? rootArg.slice("--root=".length) : Deno.cwd();
}

const REPO_ROOT = resolveRepoRoot();

// Data structures

type LiteralKind = "string" | "number";
type ViolationScope = "global" | "local";

interface FileBreakdown {
  /** Relative path from repo root */
  file: string;
  count: number;
  firstLine: number;
}

interface Violation {
  value: string;
  kind: LiteralKind;
  scope: ViolationScope;
  totalOccurrences: number;
  distinctFiles: number;
  score: number;
  hasExistingConstantCandidate: boolean;
  /** Per-file breakdown, sorted by count descending */
  files: FileBreakdown[];
}

// Counting data (accumulated during AST walk)

/**
 * Accumulated counters keyed by `"string:literal"` or `"number:42"`.
 */
interface ValueAccumulator {
  value: string;
  kind: LiteralKind;
  /** All occurrences across the whole codebase */
  occurrences: Array<{ file: string; line: number }>;
  /** Per-file counts */
  perFile: Map<string, number>;
}

// AST Visitor

/**
 * Should this literal be skipped (whitelisted or irrelevant context)?
 */
function propertyNameOf(name: ts.Node): string {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return "";
}

/** True when a literal is a structural property/field name or a whitelisted metadata field. */
function skipsAsStructuralLiteral(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isStringLiteral(node) && ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const propName = propertyNameOf(parent.name);
    if (node.text === "piped" && STDIO_PIPE_FIELD_NAMES.has(propName)) return true;
    if (node.text === "text" && propName === "type") return true;
    if (STRUCTURAL_METADATA_PROPERTY_NAMES.has(propName)) return true;
  }
  return false;
}

/** True when a string is a structural array element (required fields, Zod enum members). */
function skipsAsArrayElement(node: ts.Node, parent: ts.Node): boolean {
  if (!ts.isStringLiteral(node) || !ts.isArrayLiteralExpression(parent)) return false;
  const container = parent.parent;
  if (ts.isPropertyAssignment(container) && container.initializer === parent) {
    const propName = propertyNameOf(container.name);
    if (propName === "required" || STRUCTURAL_STRING_ARRAY_PROPERTY_NAMES.has(propName)) return true;
  }
  return ts.isCallExpression(container) &&
    container.arguments.length > 0 &&
    container.arguments[0] === parent &&
    ts.isPropertyAccessExpression(container.expression) &&
    container.expression.name.text === "enum";
}

/** True for enum members, wait-state status literals, and UPPER_SNAKE_CASE constant initializers. */
function skipsAsEnumOrConstantLiteral(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isEnumMember(parent) && (parent.name === node || parent.initializer === node)) return true;
  if (ts.isStringLiteral(node) && WAIT_STATE_STATUS_LITERALS.has(node.text)) return true;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    const varName = ts.isIdentifier(parent.name) ? parent.name.text : "";
    if (ALL_CAPS_REGEX.test(varName)) return true;
  }
  return false;
}

/** True for literals in syntax positions that are not values (keys, imports, decorators, JSX, types). */
function skipsAsSyntaxLiteral(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isModuleDeclaration(parent)) return true;
  if (ts.isDecorator(parent)) return true;
  if (ts.isJsxAttribute(parent) && parent.initializer === node) return true;
  if (ts.isTemplateLiteralToken(node)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isIndexedAccessTypeNode(parent)) return true;
  return false;
}

function shouldSkip(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (skipsAsStructuralLiteral(node, parent)) return true;
  if (skipsAsArrayElement(node, parent)) return true;
  if (skipsAsEnumOrConstantLiteral(node, parent)) return true;
  if (skipsAsSyntaxLiteral(node, parent)) return true;
  return false;
}

function collectLiterals(
  sourceFile: ts.SourceFile,
  counters: Map<string, ValueAccumulator>,
  checkNumbersFlag: boolean,
): void {
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node)) {
      processLiteral(node, sourceFile, counters);
    } else if (ts.isNumericLiteral(node) && checkNumbersFlag) {
      processLiteral(node, sourceFile, counters);
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

/** True for string literals that must not count (whitelist, short, caps, structural, test scaffolding). */
function isSkippedStringLiteral(sourceFile: ts.SourceFile, val: string): boolean {
  if (STRING_WHITELIST.has(val)) return true;
  if (val.length < SHORT_STRING_MIN_LENGTH) return true;
  if (ALL_CAPS_REGEX.test(val)) return true;
  if (isLikelyStructuralString(val)) return true;
  if (isTestFilePath(sourceFile.fileName) && /^(test|mock|fake|dummy)[-_]/i.test(val)) return true;
  return false;
}

/** True for numeric literals that must not count (whitelist, NaN, small, structural). */
function isSkippedNumericLiteral(num: number): boolean {
  if (NUMBER_WHITELIST.has(num) || isNaN(num)) return true;
  if (Math.abs(num) < MIN_NUMBER_THRESHOLD) return true;
  if (isLikelyStructuralNumber(Math.abs(num))) return true;
  return false;
}

function processLiteral(
  node: ts.StringLiteral | ts.NumericLiteral,
  sourceFile: ts.SourceFile,
  counters: Map<string, ValueAccumulator>,
): void {
  if (shouldSkip(node)) return;

  const rawText = node.getText(sourceFile);
  const kind: LiteralKind = ts.isStringLiteral(node) ? "string" : "number";
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  if (kind === "string" && isSkippedStringLiteral(sourceFile, node.text)) return;
  if (kind === "number" && isSkippedNumericLiteral(parseFloat(rawText))) return;

  const key = `${kind}:${rawText}`;

  let acc = counters.get(key);
  if (!acc) {
    acc = { value: rawText, kind, occurrences: [], perFile: new Map() };
    counters.set(key, acc);
  }
  acc.occurrences.push({ file: sourceFile.fileName, line });
  acc.perFile.set(sourceFile.fileName, (acc.perFile.get(sourceFile.fileName) || 0) + 1);
}

function collectReusableLiteralKeys(
  sourceFile: ts.SourceFile,
  reusableLiteralKeys: Set<string>,
  checkNumbersFlag: boolean,
): void {
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node)) {
      if (!shouldSkip(node)) {
        reusableLiteralKeys.add(`string:${node.getText(sourceFile)}`);
      }
    } else if (ts.isNumericLiteral(node) && checkNumbersFlag) {
      if (!shouldSkip(node)) {
        reusableLiteralKeys.add(`number:${node.getText(sourceFile)}`);
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

function calculateViolationScore(params: {
  scope: ViolationScope;
  totalOccurrences: number;
  distinctFiles: number;
  hasExistingConstantCandidate: boolean;
}): number {
  const scopeBonus = params.scope === "global" ? SCORE_SCOPE_GLOBAL_BONUS : SCORE_SCOPE_LOCAL_BONUS;
  const occurrenceScore = params.totalOccurrences * SCORE_PER_OCCURRENCE;
  const spreadScore = params.distinctFiles * SCORE_PER_DISTINCT_FILE;
  const constantBonus = params.hasExistingConstantCandidate ? SCORE_EXISTING_CONSTANT_BONUS : 0;

  return scopeBonus + occurrenceScore + spreadScore + constantBonus;
}

// Violation detection

function detectViolations(
  counters: Map<string, ValueAccumulator>,
  reusableLiteralKeys: Set<string>,
): Violation[] {
  const violations: Violation[] = [];
  const reportedGlobal = new Set<string>();

  for (const [key, data] of counters) {
    const isString = data.kind === "string";
    const localThreshold = isString ? localStringThreshold : localNumberThreshold;
    const globalThreshold = isString ? globalStringThreshold : globalNumberThreshold;

    // Check global violations first
    if (data.occurrences.length > globalThreshold && !reportedGlobal.has(key)) {
      reportedGlobal.add(key);
      const hasExistingConstantCandidate = reusableLiteralKeys.has(key);
      const files: FileBreakdown[] = [];
      for (const [file, count] of data.perFile) {
        const firstLine = data.occurrences.find((o) => o.file === file)?.line ?? 0;
        files.push({ file, count, firstLine });
      }
      files.sort((a, b) => b.count - a.count);

      const score = calculateViolationScore({
        scope: "global",
        totalOccurrences: data.occurrences.length,
        distinctFiles: data.perFile.size,
        hasExistingConstantCandidate,
      });

      violations.push({
        value: data.value,
        kind: data.kind,
        scope: "global",
        totalOccurrences: data.occurrences.length,
        distinctFiles: data.perFile.size,
        score,
        hasExistingConstantCandidate,
        files,
      });
    }

    // Check local (per-file) violations
    for (const [file, count] of data.perFile) {
      if (count > localThreshold && data.occurrences.length <= globalThreshold) {
        const hasExistingConstantCandidate = reusableLiteralKeys.has(key);
        const fileOccurrences = data.occurrences.filter((o) => o.file === file);
        const firstLine = fileOccurrences[0]?.line ?? 0;

        const score = calculateViolationScore({
          scope: "local",
          totalOccurrences: count,
          distinctFiles: 1,
          hasExistingConstantCandidate,
        });

        violations.push({
          value: data.value,
          kind: data.kind,
          scope: "local",
          totalOccurrences: count,
          distinctFiles: 1,
          score,
          hasExistingConstantCandidate,
          files: [{ file, count, firstLine }],
        });
      }
    }
  }

  return violations;
}

// Sorting

function sortViolations(violations: Violation[]): Violation[] {
  return violations.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    // GLOBAL scope first
    if (a.scope !== b.scope) {
      return a.scope === "global" ? -1 : 1;
    }
    // More files first
    if (a.distinctFiles !== b.distinctFiles) {
      return b.distinctFiles - a.distinctFiles;
    }
    // More occurrences first
    return b.totalOccurrences - a.totalOccurrences;
  });
}

// Reporting

/** Maximum number of files to show per violation before summarising */
const MAX_FILES_TO_SHOW = 10;

function reportViolations(violations: Violation[]): void {
  for (const v of violations) {
    const scopeTag = v.scope === "global" ? "GLOBAL" : "MODULE";
    const filesLabel = v.distinctFiles === 1 ? "1 file" : `${v.distinctFiles} files`;
    const existingConstantTag = v.hasExistingConstantCandidate ? "yes" : "no";
    console.error(
      `[${scopeTag}] score=${v.score} existing-constant=${existingConstantTag} ${v.value} (${v.kind}) appears ${v.totalOccurrences}x across ${filesLabel}`,
    );
    console.error("    ┃");
    console.error("    ┃ per-file breakdown:");

    const shown = v.files.slice(0, MAX_FILES_TO_SHOW);
    for (const fb of shown) {
      const shortPath = relative(REPO_ROOT, fb.file);
      const label = fb.count === 1 ? "1 occurrence" : `${fb.count} occurrences`;
      console.error(`    ┃   ${shortPath}: ${label} (line ${fb.firstLine})`);
    }

    if (v.files.length > MAX_FILES_TO_SHOW) {
      const remaining = v.files.length - MAX_FILES_TO_SHOW;
      const remainingCount = v.files.slice(MAX_FILES_TO_SHOW).reduce((sum, fb) => sum + fb.count, 0);
      console.error(`    ┃   … and ${remaining} more file(s) with ${remainingCount} occurrence(s)`);
    }
    console.error("");
  }
}

// Main

interface IConstantAllowEntry {
  readonly name: string;
  readonly files: readonly string[];
  readonly reason: string;
}

interface IDuplicateConstantOptions {
  readonly namePattern?: string;
  readonly allow?: readonly IConstantAllowEntry[];
}

interface ISourceUnit {
  readonly path: string;
  readonly text: string;
}

interface IDuplicateConstant {
  readonly name: string;
  readonly firstFile: string;
  readonly laterFile: string;
}

/** Canonical text for a static literal value, or null when the value is not static. */
function staticValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return `s:${node.text}`;
  if (ts.isNumericLiteral(node)) return `n:${node.text}`;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "b:true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "b:false";
  if (ts.isArrayLiteralExpression(node)) {
    const parts: string[] = [];
    for (const element of node.elements) {
      const value = staticValue(element);
      if (value === null) return null;
      parts.push(value);
    }
    return `a:[${parts.join(",")}]`;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const parts: string[] = [];
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return null;
      const value = staticValue(property.initializer);
      if (value === null) return null;
      parts.push(`${property.name.text}=${value}`);
    }
    parts.sort();
    return `o:{${parts.join(",")}}`;
  }
  return null;
}

/** The `const NAME = <static>` pairs declared at the top level of a unit. */
function topLevelConstants(unit: ISourceUnit, namePattern: RegExp): Map<string, string> {
  const result = new Map<string, string>();
  const source = ts.createSourceFile(unit.path, unit.text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const name = declaration.name.text;
      if (!namePattern.test(name)) continue;
      const value = staticValue(declaration.initializer);
      if (value !== null) result.set(name, value);
    }
  }
  return result;
}

/** Duplicate `const` names with the same static value across separate files. */
export function findDuplicateConstants(
  units: readonly ISourceUnit[],
  options: IDuplicateConstantOptions,
): IDuplicateConstant[] {
  const pattern = new RegExp(options.namePattern ?? "^[A-Z][A-Z0-9_]*$");
  const allow = options.allow ?? [];
  const groups = new Map<string, string[]>();
  for (const unit of units) {
    for (const [name, value] of topLevelConstants(unit, pattern)) {
      const key = `${name}\u0000${value}`;
      const files = groups.get(key) ?? [];
      if (!files.includes(unit.path)) files.push(unit.path);
      groups.set(key, files);
    }
  }

  const duplicates: IDuplicateConstant[] = [];
  for (const [key, files] of groups) {
    if (files.length < 2) continue;
    const [name] = key.split("\u0000");
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
export function validateConstantAllowEntries(
  units: readonly ISourceUnit[],
  options: IDuplicateConstantOptions,
): string[] {
  const pattern = new RegExp(options.namePattern ?? "^[A-Z][A-Z0-9_]*$");
  const groups = new Map<string, string[]>();
  for (const unit of units) {
    for (const [name, value] of topLevelConstants(unit, pattern)) {
      const key = `${name}\u0000${value}`;
      const files = groups.get(key) ?? [];
      if (!files.includes(unit.path)) files.push(unit.path);
      groups.set(key, files);
    }
  }
  const stale: string[] = [];
  for (const entry of options.allow ?? []) {
    const matches = [...groups.entries()].some(([key, files]) =>
      key.split("\u0000")[0] === entry.name && entry.files.every((file) => files.includes(file)) && files.length >= 2
    );
    if (!matches) stale.push(entry.name);
  }
  return stale;
}

async function main(): Promise<void> {
  const counters = new Map<string, ValueAccumulator>();
  const reusableLiteralKeys = new Set<string>();

  const tsFiles: string[] = [];

  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
      skip: [
        /[/\\]\.git[/\\]/,
        /[/\\]node_modules[/\\]/,
        /[/\\]dist[/\\]/,
        /[/\\]coverage[/\\]/,
        // Self-tooling skip: the checkers' own literals are rule regexes and messages,
        // not extractable magic values (mirrors check_code_style's catalog self-exemption).
        /check_magic_values\.ts$/,
        /check_code_style\.ts$/,
        /repo_layout\.ts$/,
        /[/\\]whole_tree[/\\]/,
      ],
    })
  ) {
    if (entry.path.includes(LAYOUT.copilotSegment)) continue;
    if (entry.path.includes(LAYOUT.scriptsSegment)) continue;
    if (!includeTests && isTestFilePath(entry.path)) continue;
    if (entry.path.includes(LAYOUT.fixturesSegment)) continue;
    tsFiles.push(entry.path);
  }

  for (const filePath of tsFiles) {
    const source = await Deno.readTextFile(filePath);
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const isCanonicalDefinitionFile = isConstantOrEnumFilePath(filePath);

    if (isCanonicalDefinitionFile) {
      // Capture literals from canonical definition files for scoring/reuse hints,
      // but do not count them as violations in the defining module itself.
      collectReusableLiteralKeys(sourceFile, reusableLiteralKeys, checkNumbers);
      continue;
    }

    collectLiterals(sourceFile, counters, checkNumbers);
  }

  const violations = sortViolations(detectViolations(counters, reusableLiteralKeys));

  if (violations.length > 0) {
    console.error("❌ Magic value violations detected:\n");
    reportViolations(violations);
    console.error(`${violations.length} violation(s) found`);
    Deno.exit(1);
  }

  console.log("✅ No magic value violations detected");
}

if (import.meta.main) {
  main();
}
