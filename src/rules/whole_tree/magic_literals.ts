/**
 * @module WholeTreeMagicLiterals
 * @path src/rules/whole_tree/magic_literals.ts
 * @description Finds string and number literals that repeat often enough to need a named constant, and ranks them.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/options.ts, src/rules/whole_tree/mod.ts]
 * @public Exports are the unit-test surface of this module.
 */

import ts from "typescript";
import { type IMagicLiteralInput, MagicLiteralOptionsSchema } from "./options.ts";

/** One source file to scan. `isTest` marks a file whose test scaffolding strings do not count. */
export interface IMagicLiteralFile {
  readonly path: string;
  readonly text: string;
  readonly isTest: boolean;
}

export interface IMagicFileBreakdown {
  readonly file: string;
  readonly count: number;
  readonly firstLine: number;
}

export type MagicLiteralKind = "string" | "number";
export type MagicViolationScope = "global" | "local";

export interface IMagicViolation {
  readonly value: string;
  readonly kind: MagicLiteralKind;
  readonly scope: MagicViolationScope;
  readonly totalOccurrences: number;
  readonly distinctFiles: number;
  readonly score: number;
  readonly hasExistingConstantCandidate: boolean;
  /** Per-file breakdown, sorted by count descending. */
  readonly files: readonly IMagicFileBreakdown[];
}

type Options = ReturnType<typeof MagicLiteralOptionsSchema.parse>;

interface IAccumulator {
  readonly value: string;
  readonly kind: MagicLiteralKind;
  readonly occurrences: { file: string; line: number }[];
  readonly perFile: Map<string, number>;
}

const BASE_STRING_WORDS = [
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
  "string",
  "number",
  "boolean",
  "object",
  "function",
  "symbol",
  "bigint",
  "unknown",
  "any",
  "never",
  "void",
];
const NUMBER_WHITELIST = new Set([0, 1, -1]);
const ALL_CAPS = /^[A-Z][A-Z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FILE_OR_PATH = /[\\/]|\.[A-Za-z0-9]{1,8}$/;
const CLI_FLAG = /^--?[a-z0-9][a-z0-9-]*$/i;
const MIME_TYPE = /^[a-z]+\/[a-z0-9.+-]+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_WITH_NUMERIC_SUFFIX = /^[a-z][a-z0-9_-]*[-_][0-9]+$/i;
const STDIO_FIELDS = new Set(["stdout", "stderr", "stdin"]);
const PIPED_VALUE = "piped";
const CONTENT_TYPE_PROPERTY = "type";
const CONTENT_TYPE_TEXT = "text";
const ENUM_CALL_NAME = "enum";
const MAX_FILES_SHOWN = 10;
const SCORE_SCOPE_GLOBAL_BONUS = 25;
const SCORE_SCOPE_LOCAL_BONUS = 10;
const SCORE_PER_OCCURRENCE = 3;
const SCORE_PER_DISTINCT_FILE = 5;
const SCORE_EXISTING_CONSTANT_BONUS = 40;

interface IClassifier {
  readonly options: Options;
  readonly strings: ReadonlySet<string>;
  readonly metadata: ReadonlySet<string>;
  readonly arrays: ReadonlySet<string>;
  readonly status: ReadonlySet<string>;
  readonly scaffold: RegExp;
}

function classifierFor(options: Options): IClassifier {
  return {
    options,
    strings: new Set([...BASE_STRING_WORDS, ...options.additionalStrings]),
    metadata: new Set(options.metadataProperties),
    arrays: new Set(options.structuralArrayProperties),
    status: new Set(options.statusLiterals),
    scaffold: new RegExp(options.testScaffoldPattern, "i"),
  };
}

function propertyNameOf(name: ts.Node): string {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return "";
}

/** True when a literal is a structural property name or a metadata field value. */
function skipsAsStructural(node: ts.Node, parent: ts.Node, classifier: IClassifier): boolean {
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isStringLiteral(node) && ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const property = propertyNameOf(parent.name);
    if (node.text === PIPED_VALUE && STDIO_FIELDS.has(property)) return true;
    if (node.text === CONTENT_TYPE_TEXT && property === CONTENT_TYPE_PROPERTY) return true;
    if (classifier.metadata.has(property)) return true;
  }
  return false;
}

/** True when a string is an element of a structural array, such as required fields or enum members. */
function skipsAsArrayElement(node: ts.Node, parent: ts.Node, classifier: IClassifier): boolean {
  if (!ts.isStringLiteral(node) || !ts.isArrayLiteralExpression(parent)) return false;
  const container = parent.parent;
  if (ts.isPropertyAssignment(container) && container.initializer === parent) {
    if (classifier.arrays.has(propertyNameOf(container.name))) return true;
  }
  return ts.isCallExpression(container) &&
    container.arguments.length > 0 &&
    container.arguments[0] === parent &&
    ts.isPropertyAccessExpression(container.expression) &&
    container.expression.name.text === ENUM_CALL_NAME;
}

/** True for enum members, domain status words, and the initializer of an upper-case constant. */
function skipsAsEnumOrConstant(node: ts.Node, parent: ts.Node, classifier: IClassifier): boolean {
  if (ts.isEnumMember(parent) && (parent.name === node || parent.initializer === node)) return true;
  if (ts.isStringLiteral(node) && classifier.status.has(node.text)) return true;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return ALL_CAPS.test(ts.isIdentifier(parent.name) ? parent.name.text : "");
  }
  return false;
}

/** True for literals in syntax positions that hold no value: keys, imports, decorators, JSX, and types. */
function skipsAsSyntax(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isModuleDeclaration(parent)) return true;
  if (ts.isDecorator(parent)) return true;
  if (ts.isJsxAttribute(parent) && parent.initializer === node) return true;
  if (ts.isTemplateLiteralToken(node)) return true;
  return ts.isLiteralTypeNode(parent) || ts.isIndexedAccessTypeNode(parent);
}

function shouldSkip(node: ts.Node, classifier: IClassifier): boolean {
  const parent = node.parent;
  if (!parent) return true;
  return skipsAsStructural(node, parent, classifier) ||
    skipsAsArrayElement(node, parent, classifier) ||
    skipsAsEnumOrConstant(node, parent, classifier) ||
    skipsAsSyntax(node, parent);
}

function isStructuralString(value: string): boolean {
  return UUID.test(value) || SEMVER.test(value) || FILE_OR_PATH.test(value) || CLI_FLAG.test(value) ||
    MIME_TYPE.test(value) || EMAIL.test(value) || ID_WITH_NUMERIC_SUFFIX.test(value);
}

function isStructuralNumber(value: number, options: Options): boolean {
  const [statusMin, statusMax] = options.httpStatusRange;
  if (value >= statusMin && value <= statusMax) return true;
  return value % options.roundNumberStep === 0 && value <= options.roundNumberMax;
}

function isSkippedString(value: string, isTest: boolean, classifier: IClassifier): boolean {
  if (classifier.strings.has(value)) return true;
  if (value.length < classifier.options.minStringLength) return true;
  if (ALL_CAPS.test(value) || isStructuralString(value)) return true;
  return isTest && classifier.scaffold.test(value);
}

function isSkippedNumber(value: number, options: Options): boolean {
  if (NUMBER_WHITELIST.has(value) || isNaN(value)) return true;
  if (Math.abs(value) < options.minNumber) return true;
  return isStructuralNumber(Math.abs(value), options);
}

function literalNodes(sourceFile: ts.SourceFile, checkNumbers: boolean): (ts.StringLiteral | ts.NumericLiteral)[] {
  const found: (ts.StringLiteral | ts.NumericLiteral)[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node)) found.push(node);
    else if (ts.isNumericLiteral(node) && checkNumbers) found.push(node);
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return found;
}

function isDefinitionFile(path: string, options: Options): boolean {
  return options.definitionFileSuffixes.some((suffix) => path.endsWith(suffix));
}

function record(
  counters: Map<string, IAccumulator>,
  node: ts.StringLiteral | ts.NumericLiteral,
  file: IMagicLiteralFile,
  sourceFile: ts.SourceFile,
): void {
  const rawText = node.getText(sourceFile);
  const kind: MagicLiteralKind = ts.isStringLiteral(node) ? "string" : "number";
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const key = `${kind}:${rawText}`;
  let accumulator = counters.get(key);
  if (!accumulator) {
    accumulator = { value: rawText, kind, occurrences: [], perFile: new Map() };
    counters.set(key, accumulator);
  }
  accumulator.occurrences.push({ file: file.path, line });
  accumulator.perFile.set(file.path, (accumulator.perFile.get(file.path) ?? 0) + 1);
}

function scanFile(
  file: IMagicLiteralFile,
  classifier: IClassifier,
  counters: Map<string, IAccumulator>,
  reusable: Set<string>,
): void {
  const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
  const definition = isDefinitionFile(file.path, classifier.options);
  for (const node of literalNodes(sourceFile, classifier.options.checkNumbers)) {
    if (shouldSkip(node, classifier)) continue;
    const kind = ts.isStringLiteral(node) ? "string" : "number";
    if (definition) {
      reusable.add(`${kind}:${node.getText(sourceFile)}`);
      continue;
    }
    const skipped = ts.isStringLiteral(node)
      ? isSkippedString(node.text, file.isTest, classifier)
      : isSkippedNumber(parseFloat(node.getText(sourceFile)), classifier.options);
    if (!skipped) record(counters, node, file, sourceFile);
  }
}

function scoreOf(
  violation: Pick<IMagicViolation, "scope" | "totalOccurrences" | "distinctFiles" | "hasExistingConstantCandidate">,
): number {
  const scopeBonus = violation.scope === "global" ? SCORE_SCOPE_GLOBAL_BONUS : SCORE_SCOPE_LOCAL_BONUS;
  const constantBonus = violation.hasExistingConstantCandidate ? SCORE_EXISTING_CONSTANT_BONUS : 0;
  return scopeBonus + violation.totalOccurrences * SCORE_PER_OCCURRENCE +
    violation.distinctFiles * SCORE_PER_DISTINCT_FILE + constantBonus;
}

function violationFrom(
  accumulator: IAccumulator,
  scope: MagicViolationScope,
  files: IMagicFileBreakdown[],
  hasExistingConstantCandidate: boolean,
): IMagicViolation {
  const totalOccurrences = scope === "global" ? accumulator.occurrences.length : files[0].count;
  const base = { scope, totalOccurrences, distinctFiles: files.length, hasExistingConstantCandidate };
  return {
    value: accumulator.value,
    kind: accumulator.kind,
    ...base,
    score: scoreOf(base),
    files,
  };
}

function firstLineIn(accumulator: IAccumulator, file: string): number {
  return accumulator.occurrences.find((occurrence) => occurrence.file === file)?.line ?? 0;
}

function violationsOf(
  key: string,
  accumulator: IAccumulator,
  options: Options,
  reusable: ReadonlySet<string>,
): IMagicViolation[] {
  const isString = accumulator.kind === "string";
  const localThreshold = isString ? options.thresholds.localString : options.thresholds.localNumber;
  const globalThreshold = isString ? options.thresholds.globalString : options.thresholds.globalNumber;
  const candidate = reusable.has(key);
  const found: IMagicViolation[] = [];
  if (accumulator.occurrences.length > globalThreshold) {
    const files = [...accumulator.perFile]
      .map(([file, count]) => ({ file, count, firstLine: firstLineIn(accumulator, file) }))
      .sort((a, b) => b.count - a.count);
    found.push(violationFrom(accumulator, "global", files, candidate));
  }
  for (const [file, count] of accumulator.perFile) {
    if (count > localThreshold && accumulator.occurrences.length <= globalThreshold) {
      found.push(
        violationFrom(accumulator, "local", [{ file, count, firstLine: firstLineIn(accumulator, file) }], candidate),
      );
    }
  }
  return found;
}

function compareViolations(a: IMagicViolation, b: IMagicViolation): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.scope !== b.scope) return a.scope === "global" ? -1 : 1;
  if (a.distinctFiles !== b.distinctFiles) return b.distinctFiles - a.distinctFiles;
  return b.totalOccurrences - a.totalOccurrences;
}

/** The magic-literal violations of a set of files, ranked from most to least worth fixing. */
export function detectMagicLiterals(files: readonly IMagicLiteralFile[], input: IMagicLiteralInput): IMagicViolation[] {
  const classifier = classifierFor(MagicLiteralOptionsSchema.parse(input));
  const counters = new Map<string, IAccumulator>();
  const reusable = new Set<string>();
  for (const file of files) scanFile(file, classifier, counters, reusable);
  const violations: IMagicViolation[] = [];
  for (const [key, accumulator] of counters) {
    violations.push(...violationsOf(key, accumulator, classifier.options, reusable));
  }
  return violations.sort(compareViolations);
}

/** The report lines of one violation. `display` turns a stored path into the path to show. */
export function formatMagicViolation(violation: IMagicViolation, display: (path: string) => string): string[] {
  const tag = violation.scope === "global" ? "GLOBAL" : "MODULE";
  const filesLabel = violation.distinctFiles === 1 ? "1 file" : `${violation.distinctFiles} files`;
  const existing = violation.hasExistingConstantCandidate ? "yes" : "no";
  const lines = [
    `[${tag}] score=${violation.score} existing-constant=${existing} ${violation.value} (${violation.kind}) appears ${violation.totalOccurrences}x across ${filesLabel}`,
    "    ┃",
    "    ┃ per-file breakdown:",
  ];
  for (const entry of violation.files.slice(0, MAX_FILES_SHOWN)) {
    const label = entry.count === 1 ? "1 occurrence" : `${entry.count} occurrences`;
    lines.push(`    ┃   ${display(entry.file)}: ${label} (line ${entry.firstLine})`);
  }
  if (violation.files.length > MAX_FILES_SHOWN) {
    const rest = violation.files.slice(MAX_FILES_SHOWN);
    const remaining = rest.reduce((sum, entry) => sum + entry.count, 0);
    lines.push(`    ┃   … and ${rest.length} more file(s) with ${remaining} occurrence(s)`);
  }
  lines.push("");
  return lines;
}
