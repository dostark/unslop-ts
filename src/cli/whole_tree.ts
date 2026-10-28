#!/usr/bin/env -S deno run -A
/**
 * @module WholeTreeCli
 * @path src/cli/whole_tree.ts
 * @description Runs a whole-tree rule over the repository.
 * @architectural-layer Tooling
 * @related-files [src/rules/whole_tree/optional_params.ts]
 *
 * Usage:
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=constant-restatement
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=unused-exports [--all] [--parity [--enum-members] [--class-members]] [--severity=warn|error] [--relaxed] [--fail]
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=unused-files [--manifest | --conventions] [--fail]
 *   `--strict` stays as a deprecated alias of `--fail`.
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=optional-params [--include-tests] [--verbose] [--fail] [--fix] [--staged]
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=duplicate-code [--verbose] [--group=<name>]... [--top=<n>] [--by=pair|file|block] [--min-lines=<n>] [--max-gap-lines=<n>] [--format=text|json] [--update-baseline]
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=duplicate-type
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=duplicate-constant
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=magic-literals [--include-tests]
 */

import { fromFileUrl, relative } from "@std/path";
import { CliError } from "./error.ts";
import { loadConfigDescriptor, readAndCompile } from "./project_loader.ts";
import { asJsonValue, CatalogError, type JsonValue } from "../engine/catalog.ts";
import { selectionEnvNameForRule } from "../engine/rule_gate.ts";
import { checkRepository as checkConstantRestatement } from "../rules/whole_tree/constant_restatement.ts";
import {
  checkRepository as checkOptionalParams,
  type IOptionalViolation,
  type TOptionalViolationKind,
} from "../rules/whole_tree/optional_params.ts";
import {
  checkRepository as checkUnusedExports,
  type IMemberReports,
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
import {
  type IConstantRestatementSettings,
  type IDuplicateCodeSettings,
  type IOptionalParamsSettings,
  type IUnusedExportsSettings,
  type IUnusedFilesManifestSettings,
  type IUnusedFilesSettings,
  type IWholeTreeSettings,
  parseWholeTreeSettings,
} from "../rules/whole_tree/options.ts";

const MAGIC_RULE = "magic-literals";
const RULES: readonly string[] = [
  "constant-restatement",
  "unused-exports",
  "unused-files",
  "optional-params",
  "duplicate-code",
  MAGIC_RULE,
  ...DUPLICATE_RULES,
];
const USAGE_EXIT = 2;
const GROUP_FLAG = "--group=";

function parseMinLines(value: string | undefined): number {
  if (value === undefined) return 1;
  const minLines = Number(value);
  if (!Number.isInteger(minLines) || minLines < 1) return exitWithUsage("--min-lines must be a positive integer.");
  return minLines;
}

function parseTop(value: string | undefined): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  const top = Number(value);
  if (!Number.isInteger(top) || top < 1) return exitWithUsage("--top must be a positive integer.");
  return top;
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function runConstantRestatement(settings: IConstantRestatementSettings): Promise<void> {
  const findings = await checkConstantRestatement(Deno.cwd(), settings);
  if (findings.length === 0) {
    console.log("✅ No constant restatements found in tests.");
    return;
  }
  console.error(`❌ ${findings.length} test(s) restate a constant instead of importing it:\n`);
  for (const finding of findings) {
    console.error(`  ${finding.file}`);
    console.error(`    restates ${finding.constant} as "${finding.value}"`);
    console.error(`    fix: import ${finding.constant} and derive the value from it\n`);
  }
  Deno.exit(1);
}

function unwiredScope(finding: IUnwiredExport, includeExempt: boolean): string {
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
    console.log(
      `${prefix} [unwired-export] ${finding.repoPath}:${finding.line} – '${finding.name}' ${
        unwiredScope(finding, includeExempt)
      }`,
    );
  }
  return { errors, warnings: findings.length - errors };
}

function printParitySummary(total: number, errors: number, fail: boolean): void {
  const mark = fail && errors > 0 ? "❌" : "⚠️ ";
  const warnings = total - errors;
  console.log(
    `\n${mark} ${total} unwired export(s) in the parity report (fallow-aligned): ${errors} error(s), ${warnings} warning(s).`,
  );
  if (errors > 0 && !fail) console.log("  Add `--fail` to make the error findings fail the run.");
}

function printBroadSummary(errors: number, warnings: number): void {
  console.log(
    `\n📋 ${
      errors + warnings
    } unwired export(s) in the broad report (--all): ${errors} error(s), ${warnings} warning(s).`,
  );
  console.log("  Drop `--all` for the trusted set that applies the exemption lists.");
}

function printTrustedSummary(errors: number, warnings: number, fail: boolean): void {
  const mark = fail && errors > 0 ? "❌" : "⚠️ ";
  console.log(
    `\n${mark} ${
      errors + warnings
    } unwired export(s) in the trusted report: ${errors} error(s), ${warnings} warning(s).`,
  );
  if (warnings > 0) console.log("  Type warnings never fail the run; add the pragma or delete the declaration.");
  if (errors === 0) console.log("  No error findings, so `--fail` leaves the exit code at 0.");
  else if (!fail) console.log("  Add `--fail` to the host command to make the error findings fail the run.");
}

async function runUnusedExports(
  includeExempt: boolean,
  fail: boolean,
  settings: IUnusedExportsSettings,
  parity: boolean,
  reports: IMemberReports,
): Promise<void> {
  const report = await checkUnusedExports(Deno.cwd(), includeExempt, settings, parity, reports);
  if (report.findings.length === 0) {
    console.log(includeExempt ? "✅ No unwired exports found." : "✅ No unwired exports found in the broad report.");
    return;
  }
  const { errors, warnings } = printUnwiredExports(report.findings, includeExempt, fail);
  if (parity) {
    printParitySummary(report.findings.length, errors, fail);
  } else if (includeExempt) {
    printTrustedSummary(errors, warnings, fail);
  } else {
    printBroadSummary(errors, warnings);
    console.log("\nTop directories:");
    for (const [dir, count] of report.topDirectories) console.log(`  ${dir}: ${count}`);
  }
  if (fail && errors > 0) Deno.exit(1);
}

const MANIFEST_FLAG = "--manifest";
const CONVENTIONS_FLAG = "--conventions";

/**
 * The unused-files scan starts at the manifest entry points when the catalog has a `manifest` section. `--conventions`
 * selects the path-convention scan instead, and `--manifest` refuses to run without the section.
 */
function selectUnusedFilesScan(
  args: readonly string[],
  settings: IUnusedFilesSettings,
): IUnusedFilesManifestSettings | undefined {
  const manifest = args.includes(MANIFEST_FLAG);
  const conventions = args.includes(CONVENTIONS_FLAG);
  if (manifest && conventions) exitWithUsage(`${MANIFEST_FLAG} and ${CONVENTIONS_FLAG} exclude each other.`);
  if (manifest && !settings.manifest) exitWithUsage("The catalog has no wholeTree.unusedFiles.manifest section.");
  return conventions ? undefined : settings.manifest;
}

async function runUnusedFiles(fail: boolean, settings: IUnusedFilesSettings, args: readonly string[]): Promise<void> {
  const manifest = selectUnusedFilesScan(args, settings);
  const report = manifest
    ? await checkManifestFiles(Deno.cwd(), manifest)
    : await checkUnusedFiles(Deno.cwd(), settings);
  if (report.findings.length === 0) {
    console.log(`✅ No unreachable files found in ${report.scannedFileCount} scanned file(s).`);
    return;
  }
  for (const finding of report.findings) {
    const prefix = fail ? "ERROR" : "WARN";
    console.log(
      `${prefix} [unused-file] ${finding.repoPath} – no entry point reaches this file. Delete it or wire it.`,
    );
  }
  if (fail) {
    console.log(`\n❌ ${report.findings.length} unreachable file(s) — likely dead code. Fix before commit.`);
    Deno.exit(1);
  }
  console.log(`\n⚠️  ${report.findings.length} unreachable file(s) found.`);
  console.log("  Add `--fail` to the host command to make these findings fail the run.");
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
    console.log(`    ${fresh.length} new clone(s) that the baseline does not list:`);
    for (const clone of fresh) console.log(`        ${describeClone(clone)}`);
  }
  if (resolved > 0) {
    console.log(`    ${resolved} baseline clone(s) no longer exist; run with --update-baseline to drop them.`);
  }
}

function printClones(allClones: readonly IClone[], listing: IDuplicateListing): void {
  const clones = atLeastLines(allClones, listing.minLines);
  if (listing.minLines > 1) {
    console.log(
      `    listing ${clones.length} of ${allClones.length} clone(s) with at least ${listing.minLines} lines; the figures above count every clone`,
    );
  }
  if (listing.view === "file") {
    for (const row of rankFiles(clones).slice(0, listing.top)) {
      console.log(
        `    ${row.duplicatedLines} lines  ${row.file}  (${row.clones} clone(s), ${row.partners} partner file(s))`,
      );
    }
    return;
  }
  if (listing.view === "block") {
    for (const block of collapseBlocks(clones).slice(0, listing.top)) {
      console.log(`    ${block.copies} copies, up to ${block.lines} lines`);
      for (const range of block.locations) console.log(`        ${range.file}:${range.start}-${range.end}`);
    }
    return;
  }
  for (const clone of clones.slice(0, listing.top)) console.log(`    ${describeClone(clone)}`);
}

function printDuplicateGroup(group: IDuplicateCodeGroupResult, listing: IDuplicateListing): void {
  const status = group.passed ? "✅" : "❌";
  console.log(
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
  console.log(`${status} ${CROSS_GROUP_NAME}: ${cross.clones.length} clone(s) between scan groups`);
  printNewClones(cross.newClones, cross.resolvedClones);
  if (listing.verbose) printClones(cross.clones, listing);
}

/** The scan groups to run, with the `--max-gap-lines` override applied when the command line gives one. */
function selectDuplicateSettings(settings: IDuplicateCodeSettings, args: readonly string[]): IDuplicateCodeSettings {
  const groupNames = args.filter((arg) => arg.startsWith(GROUP_FLAG)).map((arg) => arg.slice(GROUP_FLAG.length));
  let selected: IDuplicateCodeSettings;
  try {
    selected = selectGroups(settings, groupNames);
  } catch (error) {
    return exitWithUsage(error instanceof Error ? error.message : String(error));
  }
  const gap = flagValue(args, "max-gap-lines");
  if (gap === undefined) return selected;
  const maxGapLines = Number(gap);
  if (!Number.isInteger(maxGapLines) || maxGapLines < 0) {
    return exitWithUsage("--max-gap-lines must be a non-negative integer.");
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
  /** Whether a gap-merge override makes the run a survey that skips the baseline gate. */
  readonly surveying: boolean;
}

function parseDuplicateRun(settings: IDuplicateCodeSettings, args: readonly string[]): IDuplicateRun {
  const format = flagValue(args, "format") ?? "text";
  if (format !== "text" && format !== "json") exitWithUsage("--format must be text or json.");
  const updating = args.includes("--update-baseline");
  const surveying = flagValue(args, "max-gap-lines") !== undefined;
  if (updating && settings.baseline === null) {
    exitWithUsage("--update-baseline needs a `baseline` path in the duplicate-code settings.");
  }
  if (updating && surveying) exitWithUsage("--update-baseline cannot be combined with --max-gap-lines.");
  return {
    listing: {
      verbose: args.includes("--verbose"),
      top: parseTop(flagValue(args, "top")),
      view: parseView(flagValue(args, "by")) ?? exitWithUsage("--by must be pair, file, or block."),
      minLines: parseMinLines(flagValue(args, "min-lines")),
    },
    json: format === "json",
    updating,
    surveying,
  };
}

function printDuplicateReport(report: IDuplicateCodeReport, run: IDuplicateRun): void {
  if (run.json) {
    console.log(JSON.stringify(toJsonReport(report, run.listing.minLines), null, 2));
    return;
  }
  for (const group of report.groups) printDuplicateGroup(group, run.listing);
  if (report.cross !== null) printCrossGroup(report.cross, run.listing);
}

async function runDuplicateCode(settings: IDuplicateCodeSettings, args: readonly string[]): Promise<void> {
  const run = parseDuplicateRun(settings, args);
  const selected = selectDuplicateSettings(settings, args);
  // An update has no baseline to check against yet, and a gap-merged survey changes the clone ids, so both skip the gate.
  const gated = run.updating || run.surveying ? { ...selected, baseline: null } : selected;
  const report = await checkDuplicateCode(Deno.cwd(), gated);
  printDuplicateReport(report, run);
  if (run.updating) {
    console.error(`\nWrote the duplicate-code baseline to ${await saveBaseline(Deno.cwd(), selected, report)}.`);
  }
  const failed = failedGroupNames(report, run.updating);
  if (failed.length === 0) return;
  console.error(`\n❌ ${failed.length} scan group(s) fail the duplication check: ${failed.join(", ")}`);
  if (!run.listing.verbose && !run.json) console.error("  Add `--verbose` to list every clone.");
  Deno.exit(1);
}

const OPTIONAL_SECTIONS: ReadonlyArray<readonly [TOptionalViolationKind, string, boolean]> = [
  ["BARE_OPTIONAL", "🟣 BARE_OPTIONAL — param optional via bare `?` or `| undefined` (not the wrapper):\n", false],
  ["REDUNDANT_OPTIONAL", "🟡 REDUNDANT_OPTIONAL — param marked optional but ALL callers pass it:\n", true],
  ["UNUSED_OPTIONAL", "🔴 UNUSED_OPTIONAL — param optional AND used in body but NO caller passes it:\n", true],
  ["MARKED_NOT_OPTIONAL", "🟠 MARKED_NOT_OPTIONAL — param uses the wrapper but is not actually optional:\n", false],
];

function printOptionalViolations(violations: readonly IOptionalViolation[]): void {
  const root = Deno.cwd();
  for (const [kind, header, showCallers] of OPTIONAL_SECTIONS) {
    const group = violations.filter((violation) => violation.kind === kind);
    if (group.length === 0) continue;
    console.error(header);
    for (const violation of group) {
      console.error(`  ${relative(root, violation.funcFile)}:${violation.funcLine}`);
      console.error(`    ${violation.message}`);
      if (showCallers) {
        console.error(
          `    callers: ${violation.callerCount} total, ${violation.callersPassing} pass, ${violation.callersOmitting} omit`,
        );
      }
    }
    console.error("");
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
  for (const [file, source] of sources) await Deno.writeTextFile(file, source);
  console.error(`✅ Auto-fixed ${redundant.length} REDUNDANT_OPTIONAL violation(s) across ${sources.size} file(s)`);
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
    console.log("✅ No bare-optional (`?` or `| undefined`) params in staged files.");
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
    console.log("✅ No bare-optional (`?` or `| undefined`) params in staged files.");
    return;
  }
  for (const finding of findings) {
    console.error(`  ${finding.filename}:${finding.range?.start?.line ?? 0}`);
  }
  console.error(
    `${findings.length} bare-optional param(s) in staged file(s) — staging a file obliges ` +
      `converting all of its bare optionals. Wrap each in ${settings.wrapperType}<T, Reason.*>.`,
  );
  Deno.exit(1);
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
  const violations = await checkOptionalParams(Deno.cwd(), includeTests, settings);
  if (verbose && violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `\n📋 ${relative(Deno.cwd(), violation.funcFile)}:${violation.funcLine} — ${violation.optionalParam}`,
      );
    }
    console.error("");
  }
  if (fix) await applyOptionalFix(violations);
  const enforceable = violations.filter((violation) => violation.kind !== "BARE_OPTIONAL");
  if (violations.length === 0) {
    console.log("✅ No optional-parameter usage mismatches detected");
    return;
  }
  printOptionalViolations(violations);
  const bareOptionalCount = violations.length - enforceable.length;
  if (bareOptionalCount > 0) {
    console.error(
      `${bareOptionalCount} BARE_OPTIONAL (advisory — grandfathered; enforced on staged files with --staged).`,
    );
  }
  if (fail && enforceable.length > 0) {
    console.error(`${enforceable.length} enforceable violation(s) found`);
    Deno.exit(1);
  }
  if (!fail && !fix) {
    console.error(`${enforceable.length} enforceable violation(s) found (advisory — use --fail to enforce)`);
  }
}

async function runMagicLiterals(catalog: JsonValue, includeTests: boolean): Promise<void> {
  let violations;
  try {
    violations = await checkMagicLiterals(Deno.cwd(), catalog, includeTests);
  } catch (error) {
    if (error instanceof CatalogError) return exitWithUsage(error.message);
    throw error;
  }
  if (violations.length === 0) {
    console.log("✅ No magic value violations detected");
    return;
  }
  console.error("❌ Magic value violations detected:\n");
  for (const violation of violations) {
    for (const line of formatMagicViolation(violation, (path) => path)) console.error(line);
  }
  console.error(`${violations.length} violation(s) found`);
  Deno.exit(1);
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
    report = await checkDuplicates(Deno.cwd(), catalog, rule);
  } catch (error) {
    if (error instanceof CatalogError) return exitWithUsage(error.message);
    throw error;
  }
  for (const duplicate of report.duplicates) {
    console.log(
      `ERROR [${rule}] ${duplicate.laterFile} – '${duplicate.name}' duplicates ${duplicate.firstFile}. Keep one owner and import it.`,
    );
  }
  for (const name of report.staleAllow) {
    console.log(`ERROR [${rule}] the allow entry '${name}' matches no current duplicate.`);
  }
  if (report.duplicates.length + report.staleAllow.length > 0) Deno.exit(1);
  console.log(`✅ No duplicate ${DUPLICATE_SUBJECT[rule]} found.`);
}

function exitWithUsage(message: string): never {
  console.error(message);
  console.error(
    `Usage: whole_tree.ts (--catalog=<path> | --descriptor=<path> | --plugin=<path>) --rule=<${
      RULES.join("|")
    }> [--all] [--fail] [--staged] [--include-tests]`,
  );
  Deno.exit(USAGE_EXIT);
}

const NON_FILE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function inputCount(args: readonly string[]): number {
  return ["catalog", "descriptor", "plugin"].filter((name) => flagValue(args, name) !== undefined).length;
}

/** Loads either the legacy catalog or a compiled descriptor, with exactly one explicit input. */
async function loadCatalog(args: readonly string[]): Promise<JsonValue> {
  if (inputCount(args) !== 1) {
    return exitWithUsage("Pass exactly one of --catalog, --descriptor, or --plugin.");
  }
  const catalogPath = flagValue(args, "catalog");
  if (catalogPath !== undefined) {
    if (NON_FILE.test(catalogPath) && !catalogPath.startsWith("file:")) {
      return exitWithUsage(`'${catalogPath}' is not a filesystem path.`);
    }
    try {
      const local = catalogPath.startsWith("file:") ? fromFileUrl(new URL(catalogPath)) : catalogPath;
      return JSON.parse(await Deno.readTextFile(local)) as JsonValue;
    } catch (error) {
      return exitWithUsage(
        `Cannot read the catalog '${catalogPath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const descriptorArg = flagValue(args, "descriptor") ?? null;
  const pluginArg = flagValue(args, "plugin") ?? null;
  for (const value of [descriptorArg, pluginArg]) {
    if (value !== null && NON_FILE.test(value) && !value.startsWith("file:")) {
      return exitWithUsage(`'${value}' is not a filesystem path.`);
    }
  }
  try {
    const descriptor = await loadConfigDescriptor(Deno.cwd(), descriptorArg, pluginArg);
    const compiled = await readAndCompile(descriptor);
    return asJsonValue(structuredClone(compiled.catalog));
  } catch (error) {
    if (error instanceof CliError) return exitWithUsage(error.message);
    throw error;
  }
}

/** Reads the whole-tree settings from the catalog, or exits with a usage error. */
function loadSettings(catalog: JsonValue): IWholeTreeSettings {
  try {
    return parseWholeTreeSettings(catalog);
  } catch (error) {
    if (error instanceof CatalogError) return exitWithUsage(error.message);
    throw error;
  }
}

/** The severity override the command line requests: `--severity=…` beats `--relaxed`. */
function severityOverride(args: readonly string[]): "warning" | "error" | null {
  const flag = args.find((arg) => arg.startsWith("--severity="));
  if (flag !== undefined) {
    const value = flag.slice("--severity=".length);
    if (value === "warn" || value === "warning") return "warning";
    if (value === "error") return "error";
    return exitWithUsage("--severity must be warn or error.");
  }
  return args.includes("--relaxed") ? "warning" : null;
}

async function runUnusedRule(settings: IWholeTreeSettings, args: readonly string[]): Promise<void> {
  if (!settings.unusedExports) exitWithUsage("The catalog has no wholeTree.unusedExports section.");
  const parity = args.includes("--parity");
  const includeExempt = !parity && !args.includes("--all");
  const fail = args.includes("--fail") || args.includes("--strict");
  const override = severityOverride(args);
  const configured = override === null ? settings.unusedExports : {
    ...settings.unusedExports,
    severity: { type: override, value: override, parity: override },
  };
  const reports: IMemberReports = {
    enumMembers: args.includes("--enum-members"),
    classMembers: args.includes("--class-members"),
  };
  if ((reports.enumMembers || reports.classMembers) && !parity) {
    exitWithUsage("--enum-members and --class-members need --parity.");
  }
  await runUnusedExports(includeExempt, fail, configured, parity, reports);
}

async function main(): Promise<void> {
  const rule = flagValue(Deno.args, "rule");
  if (rule === undefined || !RULES.includes(rule)) exitWithUsage("Missing or unknown --rule.");
  const catalog = await loadCatalog(Deno.args);
  if (isDuplicateRule(rule)) return await runDuplicates(rule, catalog);
  if (rule === MAGIC_RULE) return await runMagicLiterals(catalog, Deno.args.includes("--include-tests"));
  await runSettingsRule(rule, loadSettings(catalog), Deno.args);
}

async function runSettingsRule(rule: string, settings: IWholeTreeSettings, args: readonly string[]): Promise<void> {
  if (rule === "constant-restatement") {
    if (!settings.constantRestatement) exitWithUsage("The catalog has no wholeTree.constantRestatement section.");
    await runConstantRestatement(settings.constantRestatement);
  }
  if (rule === "unused-exports") return await runUnusedRule(settings, args);
  if (rule === "unused-files") {
    if (!settings.unusedFiles) exitWithUsage("The catalog has no wholeTree.unusedFiles section.");
    const fail = args.includes("--fail") || args.includes("--strict");
    await runUnusedFiles(fail, settings.unusedFiles, args);
  }
  if (rule === "duplicate-code") {
    if (!settings.duplicateCode) exitWithUsage("The catalog has no wholeTree.duplicateCode section.");
    await runDuplicateCode(settings.duplicateCode, args);
  }
  if (rule === "optional-params") {
    if (!settings.optionalParams) exitWithUsage("The catalog has no wholeTree.optionalParams section.");
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

if (import.meta.main) await main();
