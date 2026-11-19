/**
 * @module CheckRunner
 * @path src/cli/check_runner.ts
 * @description Runs one whole-tree rule over a repository and returns its output, verdict and exit code without exiting or printing.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/cli/whole_tree.ts, src/cli/unslop.ts, src/rules/whole_tree/options.ts]
 */

import { flagValue } from "./flags.ts";
import { relative } from "@std/path";
import { asJsonRecord, asJsonValue, CatalogError, type ICatalogScopes, type JsonValue } from "../engine/catalog.ts";
import { normalize } from "../engine/posix_path.ts";
import { selectionEnvNameForRule } from "../engine/rule_gate.ts";
import { checkRepository as checkConstantRestatement } from "../rules/whole_tree/constant_restatement.ts";
import {
  checkRepository as checkOptionalParams,
  type IOptionalViolation,
  type TOptionalViolationKind,
} from "../rules/whole_tree/optional_params.ts";
import {
  checkRepository as checkUnusedExports,
  type IParityOptions,
  type IUnwiredExport,
} from "../rules/whole_tree/unused_exports.ts";
import { checkRepository as checkUnusedFiles } from "../rules/whole_tree/unused_files.ts";
import { checkManifestRepository as checkManifestFiles } from "../rules/whole_tree/unused_files_manifest.ts";
import {
  checkRepository as checkDuplicateCode,
  CROSS_GROUP_NAME,
  type IClone,
  type ICrossGroupResult,
  type IDuplicateCodeGroupResult,
  type IDuplicateCodeReport,
  saveBaseline,
  selectGroups,
} from "../rules/whole_tree/duplicate_code.ts";
import { toJsonReport } from "../rules/whole_tree/duplicate_format.ts";
import { checkDuplicates, DUPLICATE_RULES, type DuplicateRuleKey } from "../rules/whole_tree/duplicate_check.ts";
import {
  atLeastLines,
  collapseBlocks,
  type DuplicateView,
  parseView,
  rankFiles,
} from "../rules/whole_tree/duplicate_views.ts";
import { checkMagicLiterals } from "../rules/whole_tree/magic_check.ts";
import { formatMagicViolation } from "../rules/whole_tree/magic_literals.ts";
import { cycleJsonReport, cycleSarifReport, cycleTextReport } from "../rules/whole_tree/cycle_report.ts";
import {
  buildCycleBaseline,
  compareToBaseline,
  CycleBaselineError,
  CycleBaselineMissingError,
  type IAllowedUnresolved,
  type ICycleGate,
  loadCycleBaseline,
  resolveInsideRoot,
  saveCycleBaseline,
} from "../rules/whole_tree/cycle_baseline.ts";
import type { ICycleAnalysis } from "../rules/whole_tree/import_cycles.ts";
import { collectCycleAnalysis } from "../report/health.ts";
import { DEFAULT_TOP_CYCLES } from "../report/constants.ts";
import {
  type IConstantRestatementSettings,
  type IDuplicateCodeSettings,
  type IImportCyclesSettings,
  type IOptionalParamsSettings,
  type IUnusedExportsSettings,
  type IUnusedFilesManifestSettings,
  type IUnusedFilesSettings,
  type IWholeTreeSettings,
  parseWholeTreeSettings,
} from "../rules/whole_tree/options.ts";

/** The input of one whole-tree check run. */
export interface ICheckRunInput {
  readonly catalog: JsonValue;
  /** The project root: the cycle gate and its baseline resolve against it. */
  readonly rootPath: string;
  /** The directory a file scan walks. Defaults to `rootPath`; the whole-tree CLI sets the process directory. */
  readonly scanRootPath?: string;
  readonly args: readonly string[];
}

/** The result of one whole-tree check run. */
export interface ICheckRunResult {
  readonly code: number;
  readonly passed: boolean;
  readonly findings: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: JsonValue | null;
  readonly summary: string;
  readonly writes: readonly string[];
}

/** One run's captured output and verdict. The CLI runs one check at a time. */
interface IRunState {
  stdout: string[];
  stderr: string[];
  code: number;
  passed: boolean;
  findings: number;
  json: JsonValue | null;
  summary: string;
  writes: string[];
  rootPath: string;
  scanRootPath: string;
}

/** A stop that aborts the current run after its code is recorded. */
class CheckStop extends Error {}

function emptyState(): IRunState {
  return {
    stdout: [],
    stderr: [],
    code: 0,
    passed: true,
    findings: 0,
    json: null,
    summary: "no findings",
    writes: [],
    rootPath: "",
    scanRootPath: "",
  };
}

let state: IRunState = emptyState();

function out(line: string): void {
  state.stdout.push(line);
}

function err(line: string): void {
  state.stderr.push(line);
}

function finish(passed: boolean, findings: number, summary: string): void {
  state.passed = passed;
  state.findings = findings;
  state.summary = summary;
}

function stop(code: number): never {
  state.code = code;
  throw new CheckStop();
}

/** A usage fault: record code 2 with the message and the usage line, then abort the run. */
function usage(message: string): never {
  err(message);
  err(
    `Usage: whole_tree.ts (--catalog=<path> | --descriptor=<path> | --plugin=<path>) --rule=<${
      RULES.join("|")
    }> [--all] [--fail] [--staged] [--include-tests]`,
  );
  state.passed = false;
  state.summary = "usage error";
  return stop(USAGE_EXIT);
}

const MAGIC_RULE = "magic-literals";
const IMPORT_CYCLES_RULE = "import-cycles";
const RULES: readonly string[] = [
  "constant-restatement",
  "unused-exports",
  "unused-files",
  "optional-params",
  "duplicate-code",
  MAGIC_RULE,
  ...DUPLICATE_RULES,
  IMPORT_CYCLES_RULE,
];
const USAGE_EXIT = 2;
const GROUP_FLAG = "--group=";
const TEXT_FORMAT = "text";
const JSON_FORMAT = "json";
const SARIF_FORMAT = "sarif";
const REPORT_FORMATS: readonly TReportFormat[] = [TEXT_FORMAT, JSON_FORMAT, SARIF_FORMAT];
const FAIL_FLAG = "--fail";
const INCLUDE_SELF_FLAG = "--include-self";
const INCLUDE_TYPE_ONLY_FLAG = "--include-type-only";
const UPDATE_BASELINE_FLAG = "--update-baseline";
const FAIL_ON_NEW_FLAG = "--fail-on-new";
const FAIL_ON_STALE_FLAG = "--fail-on-stale";
const DRIVE_LETTER = /^[A-Za-z]:/;
const FAILURE_EXIT = 1;

/** A report format a whole-tree check can write. */
type TReportFormat = typeof TEXT_FORMAT | typeof JSON_FORMAT | typeof SARIF_FORMAT;

/** The report format the command line asks for, or the text default. */
function parseReportFormat(
  args: readonly string[],
  allowed: readonly TReportFormat[] = REPORT_FORMATS,
): TReportFormat {
  const format = flagValue(args, "format") ?? TEXT_FORMAT;
  const known = allowed.find((candidate) => candidate === format);
  if (known === undefined) usage(`--format must be ${allowed.join(" or ")}.`);
  return known;
}

function parseMinLines(value: string | undefined): number {
  if (value === undefined) return 1;
  const minLines = Number(value);
  if (!Number.isInteger(minLines) || minLines < 1) return usage("--min-lines must be a positive integer.");
  return minLines;
}

function parseTop(value: string | undefined): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  const top = Number(value);
  if (!Number.isInteger(top) || top < 1) return usage("--top must be a positive integer.");
  return top;
}

/** A positive integer flag, or the fallback when the command line omits it. */
function positiveIntFlag(args: readonly string[], name: string, fallback: number): number {
  const raw = flagValue(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return usage(`--${name} must be a positive integer.`);
  return value;
}

async function runConstantRestatement(settings: IConstantRestatementSettings): Promise<void> {
  const findings = await checkConstantRestatement(state.scanRootPath, settings);
  if (findings.length === 0) {
    out("✅ No constant restatements found in tests.");
    finish(true, 0, "no constant restatements");
    return;
  }
  err(`❌ ${findings.length} test(s) restate a constant instead of importing it:\n`);
  for (const finding of findings) {
    err(`  ${finding.file}`);
    err(`    restates ${finding.constant} as "${finding.value}"`);
    err(`    fix: import ${finding.constant} and derive the value from it\n`);
  }
  finish(false, findings.length, `${findings.length} constant restatement(s)`);
  stop(1);
}

/** The noun phrase of each finding kind in a message. */
const KIND_LABELS: Readonly<Record<IUnwiredExport["kind"], string>> = {
  "export": "an export",
  "interface": "an interface",
  "type-alias": "a type alias",
  "default": "a default export",
  "namespace": "a namespace",
  "enum-member": "an enum member",
  "class-member": "a class member",
};

function unwiredScope(finding: IUnwiredExport, includeExempt: boolean): string {
  if (finding.usedBy === "tests") {
    return `is ${
      KIND_LABELS[finding.kind]
    } used only by test files; move it to the test helpers, wire it into production code, or delete it.`;
  }
  if (finding.kind === "interface" || finding.kind === "type-alias") {
    return finding.kind === "type-alias"
      ? "is a type alias exported and never imported; add `// unslop-ignore-next-line unused-type` above it if it is intentional API."
      : "is an interface exported and never imported; add `// unslop-ignore-next-line unused-type` above it if it is intentional API.";
  }
  if (finding.kind === "class-member") {
    return "is a class member that nothing reads; add `// unslop-ignore-next-line unused-class-member` above it if a caller outside the walk uses it.";
  }
  if (finding.kind === "enum-member") {
    return "is an enum member that no reference reaches; add `// unslop-ignore-next-line unused-enum-member` above it if it is part of a closed set.";
  }
  if (finding.kind === "default") {
    return "is the default export and never imported; add `// unslop-ignore-next-line unused-export` above it if it is intentional API.";
  }
  return includeExempt
    ? "is exported and never imported by a production file under the exemption list."
    : "is exported and never imported anywhere the walk covers.";
}

function printUnwiredExports(
  findings: readonly IUnwiredExport[],
  includeExempt: boolean,
  fail: boolean,
): { readonly errors: number; readonly warnings: number } {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  for (const finding of findings) {
    const prefix = finding.severity === "error" && fail ? "ERROR" : "WARN";
    out(
      `${prefix} [unwired-export] ${finding.repoPath}:${finding.line} – '${finding.name}' ${
        unwiredScope(finding, includeExempt)
      }`,
    );
  }
  return { errors, warnings: findings.length - errors };
}

function printTestOnlyBreakdown(findings: readonly IUnwiredExport[]): void {
  const testOnly = findings.filter((finding) => finding.usedBy === "tests").length;
  out(`  ${findings.length - testOnly} used by nothing, ${testOnly} used only by test files (--production).`);
}

function printParitySummary(total: number, errors: number, fail: boolean): void {
  const mark = fail && errors > 0 ? "❌" : "⚠️ ";
  const warnings = total - errors;
  out(
    `\n${mark} ${total} unwired export(s) in the parity report (fallow-aligned): ${errors} error(s), ${warnings} warning(s).`,
  );
  if (errors > 0 && !fail) out("  Add `--fail` to make the error findings fail the run.");
}

function printBroadSummary(errors: number, warnings: number): void {
  out(
    `\n📋 ${
      errors + warnings
    } unwired export(s) in the broad report (--all): ${errors} error(s), ${warnings} warning(s).`,
  );
  out("  Drop `--all` for the trusted set that applies the exemption lists.");
}

function printTrustedSummary(errors: number, warnings: number, fail: boolean): void {
  const mark = fail && errors > 0 ? "❌" : "⚠️ ";
  out(
    `\n${mark} ${
      errors + warnings
    } unwired export(s) in the trusted report: ${errors} error(s), ${warnings} warning(s).`,
  );
  if (warnings > 0) out("  Type warnings never fail the run; add the pragma or delete the declaration.");
  if (errors === 0) out("  No error findings, so `--fail` leaves the exit code at 0.");
  else if (!fail) out("  Add `--fail` to the host command to make the error findings fail the run.");
}

async function runUnusedExports(
  includeExempt: boolean,
  fail: boolean,
  settings: IUnusedExportsSettings,
  parity: boolean,
  options: IParityOptions,
): Promise<void> {
  const report = await checkUnusedExports(state.scanRootPath, includeExempt, settings, parity, options);
  if (report.findings.length === 0) {
    out(includeExempt ? "✅ No unwired exports found." : "✅ No unwired exports found in the broad report.");
    finish(true, 0, "no unwired exports");
    return;
  }
  const { errors, warnings } = printUnwiredExports(report.findings, includeExempt, fail);
  if (parity) {
    printParitySummary(report.findings.length, errors, fail);
    if (options.production) printTestOnlyBreakdown(report.findings);
  } else if (includeExempt) {
    printTrustedSummary(errors, warnings, fail);
  } else {
    printBroadSummary(errors, warnings);
    out("\nTop directories:");
    for (const [dir, count] of report.topDirectories) out(`  ${dir}: ${count}`);
  }
  finish(!(fail && errors > 0), report.findings.length, `${report.findings.length} unwired export(s)`);
  if (fail && errors > 0) stop(1);
}

const MANIFEST_FLAG = "--manifest";
const CONVENTIONS_FLAG = "--conventions";

/** The manifest scan starts at the catalog entry points; `--conventions` selects the path-convention scan instead. */
function selectUnusedFilesScan(
  args: readonly string[],
  settings: IUnusedFilesSettings,
): IUnusedFilesManifestSettings | undefined {
  const manifest = args.includes(MANIFEST_FLAG);
  const conventions = args.includes(CONVENTIONS_FLAG);
  if (manifest && conventions) usage(`${MANIFEST_FLAG} and ${CONVENTIONS_FLAG} exclude each other.`);
  if (manifest && !settings.manifest) usage("The catalog has no wholeTree.unusedFiles.manifest section.");
  return conventions ? undefined : settings.manifest;
}

async function runUnusedFiles(fail: boolean, settings: IUnusedFilesSettings, args: readonly string[]): Promise<void> {
  const manifest = selectUnusedFilesScan(args, settings);
  const report = manifest
    ? await checkManifestFiles(state.scanRootPath, manifest)
    : await checkUnusedFiles(state.scanRootPath, settings);
  if (report.findings.length === 0) {
    out(`✅ No unreachable files found in ${report.scannedFileCount} scanned file(s).`);
    finish(true, 0, "no unreachable files");
    return;
  }
  for (const finding of report.findings) {
    const prefix = fail ? "ERROR" : "WARN";
    out(
      `${prefix} [unused-file] ${finding.repoPath} – no entry point reaches this file. Delete it or wire it.`,
    );
  }
  finish(!fail, report.findings.length, `${report.findings.length} unreachable file(s)`);
  if (fail) {
    out(`\n❌ ${report.findings.length} unreachable file(s) — likely dead code. Fix before commit.`);
    stop(1);
  }
  out(`\n⚠️  ${report.findings.length} unreachable file(s) found.`);
  out("  Add `--fail` to the host command to make these findings fail the run.");
}

function describeClone(clone: IClone): string {
  const { first, second } = clone;
  return `${first.file}:${first.start}-${first.end} ~ ${second.file}:${second.start}-${second.end} (${clone.lines} lines)`;
}

/** The view and limits of the clone listing. */
interface IDuplicateListing {
  readonly verbose: boolean;
  readonly top: number;
  readonly view: DuplicateView;
  readonly minLines: number;
}

function printNewClones(fresh: readonly IClone[], resolved: number): void {
  if (fresh.length > 0) {
    out(`    ${fresh.length} new clone(s) that the baseline does not list:`);
    for (const clone of fresh) out(`        ${describeClone(clone)}`);
  }
  if (resolved > 0) {
    out(`    ${resolved} baseline clone(s) no longer exist; run with --update-baseline to drop them.`);
  }
}

function printClones(allClones: readonly IClone[], listing: IDuplicateListing): void {
  const clones = atLeastLines(allClones, listing.minLines);
  if (listing.minLines > 1) {
    out(
      `    listing ${clones.length} of ${allClones.length} clone(s) with at least ${listing.minLines} lines; the figures above count every clone`,
    );
  }
  if (listing.view === "file") {
    for (const row of rankFiles(clones).slice(0, listing.top)) {
      out(
        `    ${row.duplicatedLines} lines  ${row.file}  (${row.clones} clone(s), ${row.partners} partner file(s))`,
      );
    }
    return;
  }
  if (listing.view === "block") {
    for (const block of collapseBlocks(clones).slice(0, listing.top)) {
      out(`    ${block.copies} copies, up to ${block.lines} lines`);
      for (const range of block.locations) out(`        ${range.file}:${range.start}-${range.end}`);
    }
    return;
  }
  for (const clone of clones.slice(0, listing.top)) out(`    ${describeClone(clone)}`);
}

function printDuplicateGroup(group: IDuplicateCodeGroupResult, listing: IDuplicateListing): void {
  const status = group.passed ? "✅" : "❌";
  out(
    `${status} ${group.name}: ${
      group.percentage.toFixed(2)
    }% duplicated (threshold ${group.threshold}%, ${group.clones.length} clone(s), ${group.duplicatedLines} line(s); ${
      group.involvedPercentage.toFixed(2)
    }% of lines involved)`,
  );
  printNewClones(group.newClones, group.resolvedClones);
  if (listing.verbose) printClones(group.clones, listing);
}

function printCrossGroup(cross: ICrossGroupResult, listing: IDuplicateListing): void {
  const status = cross.passed ? "✅" : "❌";
  out(`${status} ${CROSS_GROUP_NAME}: ${cross.clones.length} clone(s) between scan groups`);
  printNewClones(cross.newClones, cross.resolvedClones);
  if (listing.verbose) printClones(cross.clones, listing);
}

/** The scan groups to run, with the maximum-gap override applied when the command line gives one. */
function selectDuplicateSettings(settings: IDuplicateCodeSettings, args: readonly string[]): IDuplicateCodeSettings {
  const groupNames = args.filter((arg) => arg.startsWith(GROUP_FLAG)).map((arg) => arg.slice(GROUP_FLAG.length));
  let selected: IDuplicateCodeSettings;
  try {
    selected = selectGroups(settings, groupNames);
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error));
  }
  const gap = flagValue(args, "max-gap-lines");
  if (gap === undefined) return selected;
  const maxGapLines = Number(gap);
  if (!Number.isInteger(maxGapLines) || maxGapLines < 0) {
    return usage("--max-gap-lines must be a non-negative integer.");
  }
  return { ...selected, maxGapLines, groups: selected.groups.map((group) => ({ ...group, maxGapLines: null })) };
}

function failedGroupNames(report: IDuplicateCodeReport, updating: boolean): string[] {
  const failed = report.groups.filter((group) => (updating ? group.percentage > group.threshold : !group.passed));
  const names = failed.map((group) => group.name);
  if (!updating && report.cross?.passed === false) names.push(CROSS_GROUP_NAME);
  return names;
}

/** What the command line asks of one duplicate-code run. */
interface IDuplicateRun {
  readonly listing: IDuplicateListing;
  readonly json: boolean;
  /** Whether the run rewrites the baseline file. */
  readonly updating: boolean;
  /** Whether a maximum-gap override makes the run a survey that skips the baseline gate. */
  readonly surveying: boolean;
}

function parseDuplicateRun(settings: IDuplicateCodeSettings, args: readonly string[]): IDuplicateRun {
  const format = parseReportFormat(args, [TEXT_FORMAT, JSON_FORMAT]);
  const updating = args.includes("--update-baseline");
  const surveying = flagValue(args, "max-gap-lines") !== undefined;
  if (updating && settings.baseline === null) {
    usage("--update-baseline needs a `baseline` path in the duplicate-code settings.");
  }
  if (updating && surveying) usage("--update-baseline cannot be combined with --max-gap-lines.");
  return {
    listing: {
      verbose: args.includes("--verbose"),
      top: parseTop(flagValue(args, "top")),
      view: parseView(flagValue(args, "by")) ?? usage("--by must be pair, file, or block."),
      minLines: parseMinLines(flagValue(args, "min-lines")),
    },
    json: format === JSON_FORMAT,
    updating,
    surveying,
  };
}

function printDuplicateReport(report: IDuplicateCodeReport, run: IDuplicateRun): void {
  if (run.json) {
    const document = toJsonReport(report, run.listing.minLines);
    state.json = asJsonValue(document);
    out(JSON.stringify(document, null, 2));
    return;
  }
  for (const group of report.groups) printDuplicateGroup(group, run.listing);
  if (report.cross !== null) printCrossGroup(report.cross, run.listing);
}

function duplicateSummaryOf(failed: readonly string[]): string {
  return failed.length === 0 ? "no duplicate regressions" : `${failed.length} failing scan group(s)`;
}

async function runDuplicateCode(settings: IDuplicateCodeSettings, args: readonly string[]): Promise<void> {
  const run = parseDuplicateRun(settings, args);
  const selected = selectDuplicateSettings(settings, args);
  // An update has no baseline to check against, and a merge survey changes the clone ids, so both skip the gate.
  const gated = run.updating || run.surveying ? { ...selected, baseline: null } : selected;
  const report = await checkDuplicateCode(state.scanRootPath, gated);
  printDuplicateReport(report, run);
  if (run.updating) {
    const written = await saveBaseline(state.scanRootPath, selected, report);
    state.writes.push(written);
    err(`\nWrote the duplicate-code baseline to ${written}.`);
  }
  const failed = failedGroupNames(report, run.updating);
  finish(failed.length === 0, failed.length, duplicateSummaryOf(failed));
  if (failed.length === 0) return;
  err(`\n❌ ${failed.length} scan group(s) fail the duplication check: ${failed.join(", ")}`);
  if (!run.listing.verbose && !run.json) err("  Add `--verbose` to list every clone.");
  stop(1);
}

/** The catalog fields that select the files a scan reads. */
interface ICycleScan {
  readonly scopes: ICatalogScopes;
  readonly ignoreGlobs: readonly string[];
}

function recordOrEmpty(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? asJsonRecord(value) : {};
}

function stringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The catalog scopes and ignore globs of one cycle scan. A legacy catalog without them scans every file. */
function cycleScanOf(catalog: JsonValue): ICycleScan {
  const root = recordOrEmpty(catalog);
  const scopes = recordOrEmpty(root.scopes);
  const ignore = Array.isArray(root.ignore) ? root.ignore : [];
  return {
    scopes: { test: stringList(scopes.test), fixture: stringList(scopes.fixture) },
    ignoreGlobs: ignore.map((entry) => recordOrEmpty(entry).glob).filter((glob): glob is string =>
      typeof glob === "string"
    ),
  };
}

/** The repository-relative path that `--trace` names, or null when the command line omits it. */
function tracePathOf(args: readonly string[]): string | null {
  const raw = flagValue(args, "trace");
  if (raw === undefined) return null;
  const path = normalize(raw);
  if (path === "." || path === ".." || path.startsWith("../") || path.startsWith("/") || DRIVE_LETTER.test(path)) {
    return usage("--trace must be a file path inside the project root.");
  }
  return path;
}

/** The baseline path the run reads: a command-line flag wins over the catalog setting. */
function baselinePathOf(settings: IImportCyclesSettings, args: readonly string[]): string | null {
  return flagValue(args, "baseline") ?? settings.baseline;
}

/** One prepared baseline update: the checked path and the reviewed allowlist that survives the write. */
interface ICycleBaselineUpdate {
  readonly relative: string;
  readonly allowed: readonly IAllowedUnresolved[];
}

/** Reports a baseline rejection with its exit code. */
function failBaseline(error: Error): never {
  if (error instanceof CycleBaselineError) {
    err(error.message);
    stop(error.exitCode);
  }
  throw error;
}

/** Checks the baseline path and reads its allowlist before the analysis runs. */
async function prepareCycleBaselineUpdate(
  baselinePath: string | null,
  rootPath: string,
): Promise<ICycleBaselineUpdate> {
  if (baselinePath === null) {
    usage("--update-baseline needs a `baseline` path in the import-cycles settings.");
  }
  try {
    await resolveInsideRoot(rootPath, baselinePath);
    const previous = await loadCycleBaseline(rootPath, baselinePath);
    return { relative: baselinePath, allowed: previous.allowed_unresolved };
  } catch (error) {
    if (error instanceof CycleBaselineMissingError) return { relative: baselinePath, allowed: [] };
    return failBaseline(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Writes the baseline from the measured runtime cycles and the reviewed allowlist. */
async function writeCycleBaseline(
  input: ICheckRunInput,
  update: ICycleBaselineUpdate,
  analysis: ICycleAnalysis,
  settings: IImportCyclesSettings,
): Promise<void> {
  try {
    const path = await saveCycleBaseline(
      input.rootPath,
      update.relative,
      buildCycleBaseline(analysis, update.allowed, settings.gateRoots),
    );
    const written = relative(input.rootPath, path);
    state.writes.push(written);
    err(`Wrote the import-cycle baseline to ${written}.`);
    finish(true, analysis.totals.runtime_sccs, `wrote ${written}`);
  } catch (error) {
    if (error instanceof Deno.errors.NotCapable) {
      err("--update-baseline needs the --allow-write permission.");
      stop(FAILURE_EXIT);
    }
    failBaseline(error instanceof Error ? error : new Error(String(error)));
  }
}

/** The gate result as JSON: counts and the failing groups, without the full finding objects. */
function gateSummaryOf(gate: ICycleGate): JsonValue {
  return asJsonValue({
    matched: gate.matched,
    added: gate.added.map((cycle) => ({ id: cycle.id, files: cycle.files })),
    changed: gate.changed,
    stale: gate.stale.map((cycle) => ({ id: cycle.id, files: cycle.files })),
    unlisted_unresolved: gate.unlisted_unresolved,
    parse_error_count: gate.parse_error_count,
    nonliteral_dynamic: gate.nonliteral_dynamic,
    passed: gate.passed,
  });
}

/** Loads the baseline and compares the measured cycles with it. */
async function cycleGateOf(
  baselinePath: string,
  rootPath: string,
  analysis: ICycleAnalysis,
  settings: IImportCyclesSettings,
  args: readonly string[],
): Promise<ICycleGate> {
  try {
    const baseline = await loadCycleBaseline(rootPath, baselinePath);
    return compareToBaseline(analysis, baseline, {
      gateRoots: settings.gateRoots,
      failOnNew: settings.failOnNew || args.includes(FAIL_ON_NEW_FLAG),
      failOnStale: settings.failOnStale || args.includes(FAIL_ON_STALE_FLAG),
    });
  } catch (error) {
    if (error instanceof CycleBaselineMissingError) {
      err(error.message);
      stop(FAILURE_EXIT);
    }
    return failBaseline(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Prints the gate result and the failing groups. */
function printCycleGate(gate: ICycleGate): void {
  err(
    `\nImport-cycle gate: ${gate.matched} matched · ${gate.added.length} new · ` +
      `${gate.changed.length} changed · ${gate.stale.length} stale`,
  );
  for (const cycle of gate.added) {
    err(`  NEW runtime ${cycle.id} · ${cycle.files.join(", ")}`);
  }
  for (const cycle of gate.changed) {
    err(
      `  CHANGED runtime ${cycle.id} · was ${cycle.expected.join(", ")} · now ${cycle.actual.join(", ")}`,
    );
  }
  for (const cycle of gate.stale) {
    err(`  STALE ${cycle.id} · no longer measured; run --update-baseline to drop it`);
  }
  for (const reference of gate.unlisted_unresolved) {
    err(
      `  UNRESOLVED ${reference.from} imports '${reference.specifier}'; add it to allowed_unresolved with a reason`,
    );
  }
  for (const error of gate.parse_errors) {
    err(`  INCOMPLETE parse error in ${error.path}; the graph may hide a cycle`);
  }
  if (gate.nonliteral_dynamic > 0) {
    err(
      `  INCOMPLETE ${gate.nonliteral_dynamic} nonliteral dynamic import(s); the graph may hide a cycle`,
    );
  }
  err(gate.passed ? "✅ import-cycle gate passed" : "❌ import-cycle gate failed");
}

/** Writes the selected cycle report in the requested format and records its JSON when it has one. */
function emitCycleReport(
  format: TReportFormat,
  analysis: ICycleAnalysis,
  rows: ICycleAnalysis["cycles"],
  top: number,
  trace: string | null,
  gate: ICycleGate | null,
  rootPath: string,
): void {
  if (format === SARIF_FORMAT) {
    const sarif = cycleSarifReport(rows, top, rootPath).sarif;
    state.json = asJsonValue(sarif);
    out(JSON.stringify(sarif, null, 2));
  } else if (format === JSON_FORMAT) {
    const document = cycleJsonReport(analysis, rows, top);
    const payload = gate === null ? document : { ...document, baseline: gateSummaryOf(gate) };
    state.json = asJsonValue(payload);
    out(JSON.stringify(payload, null, 2));
  } else {
    out(cycleTextReport(analysis, rows, top, trace).text);
  }
}

async function runImportCycles(
  settings: IImportCyclesSettings,
  input: ICheckRunInput,
  args: readonly string[],
): Promise<void> {
  const format = parseReportFormat(args);
  const trace = tracePathOf(args);
  const options = {
    minFiles: positiveIntFlag(args, "min-files", settings.minFiles),
    includeSelf: settings.includeSelf || args.includes(INCLUDE_SELF_FLAG),
    includeTypeOnly: settings.includeTypeOnly || args.includes(INCLUDE_TYPE_ONLY_FLAG),
  };
  const baselinePath = baselinePathOf(settings, args);
  const update = args.includes(UPDATE_BASELINE_FLAG)
    ? await prepareCycleBaselineUpdate(baselinePath, input.rootPath)
    : null;
  const scan = cycleScanOf(input.catalog);
  const analysis = await collectCycleAnalysis(
    { rootPath: input.rootPath, ignoreGlobs: scan.ignoreGlobs, scopes: scan.scopes },
    options,
  );
  if (update !== null) return await writeCycleBaseline(input, update, analysis, settings);
  const gate = baselinePath === null ? null : await cycleGateOf(baselinePath, input.rootPath, analysis, settings, args);
  const rows = trace === null ? analysis.cycles : analysis.cycles.filter((cycle) => cycle.files.includes(trace));
  const top = positiveIntFlag(args, "top", DEFAULT_TOP_CYCLES);
  emitCycleReport(format, analysis, rows, top, trace, gate, input.rootPath);
  if (gate !== null) printCycleGate(gate);
  const findings = analysis.totals.runtime_sccs;
  const failOnCycles = args.includes(FAIL_FLAG) && findings > 0;
  // A baseline is the verdict when one exists; without one, any runtime cycle is a finding.
  finish(gate === null ? findings === 0 : gate.passed, findings, cycleSummaryOf(findings));
  if (gate !== null && !gate.passed) stop(FAILURE_EXIT);
  if (failOnCycles) {
    err(`\n❌ ${findings} runtime cycle(s) found — break the cycle.`);
    stop(1);
  }
}

function cycleSummaryOf(findings: number): string {
  return findings === 0 ? "no runtime cycles" : `${findings} runtime cycle(s)`;
}

const OPTIONAL_SECTIONS: ReadonlyArray<readonly [TOptionalViolationKind, string, boolean]> = [
  ["BARE_OPTIONAL", "🟣 BARE_OPTIONAL — param optional via bare `?` or `| undefined` (not the wrapper):\n", false],
  ["REDUNDANT_OPTIONAL", "🟡 REDUNDANT_OPTIONAL — param marked optional but ALL callers pass it:\n", true],
  ["UNUSED_OPTIONAL", "🔴 UNUSED_OPTIONAL — param optional AND used in body but NO caller passes it:\n", true],
  ["MARKED_NOT_OPTIONAL", "🟠 MARKED_NOT_OPTIONAL — param uses the wrapper but is not actually optional:\n", false],
];

function printOptionalViolations(violations: readonly IOptionalViolation[]): void {
  const root = state.scanRootPath;
  for (const [kind, header, showCallers] of OPTIONAL_SECTIONS) {
    const group = violations.filter((violation) => violation.kind === kind);
    if (group.length === 0) continue;
    err(header);
    for (const violation of group) {
      err(`  ${relative(root, violation.funcFile)}:${violation.funcLine}`);
      err(`    ${violation.message}`);
      if (showCallers) {
        err(
          `    callers: ${violation.callerCount} total, ${violation.callersPassing} pass, ${violation.callersOmitting} omit`,
        );
      }
    }
    err("");
  }
}

/** Remove the `?` token from REDUNDANT_OPTIONAL parameters, rewriting the files in place. */
async function applyOptionalFix(violations: readonly IOptionalViolation[]): Promise<void> {
  const redundant = violations.filter((v) => v.kind === "REDUNDANT_OPTIONAL" && v.qTokenPos >= 0);
  if (redundant.length === 0) return;
  const sources = new Map<string, string>();
  for (const violation of [...redundant].sort((a, b) => b.qTokenPos - a.qTokenPos)) {
    if (!sources.has(violation.funcFile)) sources.set(violation.funcFile, await Deno.readTextFile(violation.funcFile));
    const source = sources.get(violation.funcFile)!;
    sources.set(violation.funcFile, source.slice(0, violation.qTokenPos) + source.slice(violation.qTokenPos + 1));
  }
  for (const file of sources.keys()) state.writes.push(relative(state.scanRootPath, file));
  for (const [file, source] of sources) await Deno.writeTextFile(file, source);
  err(`✅ Auto-fixed ${redundant.length} REDUNDANT_OPTIONAL violation(s) across ${sources.size} file(s)`);
}

async function stagedTargetFiles(includeTests: boolean, settings: IOptionalParamsSettings): Promise<string[]> {
  const result = await new Deno.Command("git", {
    args: ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
    env: { LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!result.success) return [];
  return new TextDecoder().decode(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".ts") || line.endsWith(".tsx"))
    .filter((line) => !settings.walkSkipSegments.some((segment) => line.includes(segment)))
    .filter((line) => !settings.skipSegments.some((segment) => line.includes(segment)))
    .filter((line) =>
      includeTests ||
      !(
        settings.testSegments.some((segment) => line.includes(segment)) ||
        settings.testSuffixes.some((suffix) => line.endsWith(suffix))
      )
    );
}

/** In staged mode the plugin bare-optional rule enforces the file-level ratchet. */
async function runOptionalParamsStaged(includeTests: boolean, settings: IOptionalParamsSettings): Promise<void> {
  const files = await stagedTargetFiles(includeTests, settings);
  if (files.length === 0) {
    out("✅ No bare-optional (`?` or `| undefined`) params in staged files.");
    finish(true, 0, "no bare-optional params in staged files");
    return;
  }
  const command = new Deno.Command(Deno.execPath(), {
    args: ["lint", "--json", ...files],
    env: { [selectionEnvNameForRule(settings.pluginRuleId)]: settings.pluginRuleId },
    stdout: "piped",
    stderr: "null",
  });
  const { stdout } = await command.output();
  // SAFETY: `deno lint --json` emits exactly this diagnostic shape.
  const report = JSON.parse(new TextDecoder().decode(stdout)) as {
    diagnostics?: ReadonlyArray<{ code?: string; filename?: string; range?: { start?: { line?: number } } }>;
  };
  const findings = (report.diagnostics ?? []).filter((diagnostic) => diagnostic.code === settings.pluginRuleId);
  if (findings.length === 0) {
    out("✅ No bare-optional (`?` or `| undefined`) params in staged files.");
    finish(true, 0, "no bare-optional params in staged files");
    return;
  }
  for (const finding of findings) {
    err(`  ${finding.filename}:${finding.range?.start?.line ?? 0}`);
  }
  err(
    `${findings.length} bare-optional param(s) in staged file(s) — staging a file obliges ` +
      `converting all of its bare optionals. Wrap each in ${settings.wrapperType}<T, Reason.*>.`,
  );
  finish(false, findings.length, `${findings.length} bare-optional param(s) in staged files`);
  stop(1);
}

async function runOptionalParams(
  settings: IOptionalParamsSettings,
  staged: boolean,
  includeTests: boolean,
  verbose: boolean,
  fail: boolean,
  fix: boolean,
): Promise<void> {
  if (staged) {
    await runOptionalParamsStaged(includeTests, settings);
    return;
  }
  const violations = await checkOptionalParams(state.scanRootPath, includeTests, settings);
  if (verbose && violations.length > 0) {
    for (const violation of violations) {
      err(
        `\n📋 ${relative(state.scanRootPath, violation.funcFile)}:${violation.funcLine} — ${violation.optionalParam}`,
      );
    }
    err("");
  }
  if (fix) await applyOptionalFix(violations);
  const enforceable = violations.filter((violation) => violation.kind !== "BARE_OPTIONAL");
  if (violations.length === 0) {
    out("✅ No optional-parameter usage mismatches detected");
    finish(true, 0, "no optional-parameter mismatches");
    return;
  }
  printOptionalViolations(violations);
  const bareOptionalCount = violations.length - enforceable.length;
  finish(!(fail && enforceable.length > 0), violations.length, `${violations.length} optional-parameter violation(s)`);
  if (bareOptionalCount > 0) {
    err(
      `${bareOptionalCount} BARE_OPTIONAL (advisory — grandfathered; enforced on staged files with --staged).`,
    );
  }
  if (fail && enforceable.length > 0) {
    err(`${enforceable.length} enforceable violation(s) found`);
    stop(1);
  }
  if (!fail && !fix) {
    err(`${enforceable.length} enforceable violation(s) found (advisory — use --fail to enforce)`);
  }
}

async function runMagicLiterals(catalog: JsonValue, includeTests: boolean): Promise<void> {
  let violations;
  try {
    violations = await checkMagicLiterals(state.scanRootPath, catalog, includeTests);
  } catch (error) {
    if (error instanceof CatalogError) return usage(error.message);
    throw error;
  }
  if (violations.length === 0) {
    out("✅ No magic value violations detected");
    finish(true, 0, "no magic values");
    return;
  }
  err("❌ Magic value violations detected:\n");
  for (const violation of violations) {
    for (const line of formatMagicViolation(violation, (path) => path)) err(line);
  }
  err(`${violations.length} violation(s) found`);
  finish(false, violations.length, `${violations.length} magic value violation(s)`);
  stop(1);
}

function isDuplicateRule(rule: string): rule is DuplicateRuleKey {
  return DUPLICATE_RULES.some((candidate) => candidate === rule);
}

const DUPLICATE_SUBJECT: Readonly<Record<DuplicateRuleKey, string>> = {
  "duplicate-type": "types",
  "duplicate-constant": "constants",
};

async function runDuplicates(rule: DuplicateRuleKey, catalog: JsonValue): Promise<void> {
  let report;
  try {
    report = await checkDuplicates(state.scanRootPath, catalog, rule);
  } catch (error) {
    if (error instanceof CatalogError) return usage(error.message);
    throw error;
  }
  for (const duplicate of report.duplicates) {
    out(
      `ERROR [${rule}] ${duplicate.laterFile} – '${duplicate.name}' duplicates ${duplicate.firstFile}. Keep one owner and import it.`,
    );
  }
  for (const name of report.staleAllow) {
    out(`ERROR [${rule}] the allow entry '${name}' matches no current duplicate.`);
  }
  const findings = report.duplicates.length + report.staleAllow.length;
  finish(
    findings === 0,
    findings,
    findings === 0 ? `no duplicate ${DUPLICATE_SUBJECT[rule]}` : `${findings} duplicate ${DUPLICATE_SUBJECT[rule]}`,
  );
  if (findings > 0) stop(1);
  out(`✅ No duplicate ${DUPLICATE_SUBJECT[rule]} found.`);
}

/** Reads the whole-tree settings from the catalog, or exits with a usage error. */
function loadSettings(catalog: JsonValue): IWholeTreeSettings {
  try {
    return parseWholeTreeSettings(catalog);
  } catch (error) {
    if (error instanceof CatalogError) return usage(error.message);
    throw error;
  }
}

/** The two severity values a command-line override can request. */
type TSeverityOverride = "warning" | "error";

/** The severity override the command line requests: `--severity=…` beats `--relaxed`. */
function severityOverride(args: readonly string[]): TSeverityOverride | null {
  const flag = args.find((arg) => arg.startsWith("--severity="));
  if (flag !== undefined) {
    const value = flag.slice("--severity=".length);
    if (value === "warn" || value === "warning") return "warning";
    if (value === "error") return "error";
    return usage("--severity must be warn or error.");
  }
  return args.includes("--relaxed") ? "warning" : null;
}

async function runUnusedRule(settings: IWholeTreeSettings, args: readonly string[]): Promise<void> {
  if (!settings.unusedExports) usage("The catalog has no wholeTree.unusedExports section.");
  const parity = args.includes("--parity");
  const includeExempt = !parity && !args.includes("--all");
  const fail = args.includes("--fail") || args.includes("--strict");
  const override = severityOverride(args);
  const configured = override === null ? settings.unusedExports : {
    ...settings.unusedExports,
    severity: { type: override, value: override, parity: override },
  };
  const options: IParityOptions = {
    enumMembers: args.includes("--enum-members"),
    classMembers: args.includes("--class-members"),
    production: args.includes("--production"),
  };
  if ((options.enumMembers || options.classMembers || options.production) && !parity) {
    usage("--enum-members, --class-members, and --production need --parity.");
  }
  await runUnusedExports(includeExempt, fail, configured, parity, options);
}

async function runSettingsRule(
  rule: string,
  settings: IWholeTreeSettings,
  args: readonly string[],
  input: ICheckRunInput,
): Promise<void> {
  if (rule === "constant-restatement") {
    if (!settings.constantRestatement) usage("The catalog has no wholeTree.constantRestatement section.");
    await runConstantRestatement(settings.constantRestatement);
  }
  if (rule === "unused-exports") return await runUnusedRule(settings, args);
  if (rule === "unused-files") {
    if (!settings.unusedFiles) usage("The catalog has no wholeTree.unusedFiles section.");
    const fail = args.includes("--fail") || args.includes("--strict");
    await runUnusedFiles(fail, settings.unusedFiles, args);
  }
  if (rule === "duplicate-code") {
    if (!settings.duplicateCode) usage("The catalog has no wholeTree.duplicateCode section.");
    await runDuplicateCode(settings.duplicateCode, args);
  }
  if (rule === IMPORT_CYCLES_RULE) {
    if (!settings.importCycles) usage("The catalog has no wholeTree.importCycles section.");
    await runImportCycles(settings.importCycles, input, args);
  }
  if (rule === "optional-params") {
    if (!settings.optionalParams) usage("The catalog has no wholeTree.optionalParams section.");
    await runOptionalParams(
      settings.optionalParams,
      args.includes("--staged"),
      args.includes("--include-tests"),
      args.includes("--verbose"),
      args.includes("--fail"),
      args.includes("--fix"),
    );
  }
}

/** Runs one whole-tree rule over the input and returns a result. A usage fault is code 2, not an exit. */
export async function runWholeTreeCheck(rule: string, input: ICheckRunInput): Promise<ICheckRunResult> {
  state = { ...emptyState(), rootPath: input.rootPath, scanRootPath: input.scanRootPath ?? input.rootPath };
  try {
    if (!RULES.includes(rule)) usage("Missing or unknown --rule.");
    if (isDuplicateRule(rule)) await runDuplicates(rule, input.catalog);
    else if (rule === MAGIC_RULE) await runMagicLiterals(input.catalog, input.args.includes("--include-tests"));
    else await runSettingsRule(rule, loadSettings(input.catalog), input.args, input);
  } catch (error) {
    if (!(error instanceof CheckStop)) throw error;
  }
  return {
    code: state.code,
    passed: state.passed,
    findings: state.findings,
    stdout: state.stdout.map((line) => `${line}\n`).join(""),
    stderr: state.stderr.map((line) => `${line}\n`).join(""),
    json: state.json,
    summary: state.summary,
    writes: [...state.writes],
  };
}

/** The rules the whole-tree CLI accepts, in guide order. */
export const WHOLE_TREE_RULES: readonly string[] = RULES;
