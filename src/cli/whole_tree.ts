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
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=unused-exports [--strict]
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=optional-params [--include-tests] [--verbose] [--fail] [--fix] [--staged]
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=duplicate-type
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=duplicate-constant
 *   deno run -A src/cli/whole_tree.ts --catalog=<path> --rule=magic-literals [--include-tests]
 */

import { fromFileUrl, relative } from "@std/path";
import { CliError } from "./error.ts";
import { loadConfigDescriptor, readAndCompile } from "./project_loader.ts";
import { CatalogError, type JsonValue } from "../engine/catalog.ts";
import { selectionEnvNameForRule } from "../engine/plugin.ts";
import { checkRepository as checkConstantRestatement } from "../rules/whole_tree/constant_restatement.ts";
import {
  checkRepository as checkOptionalParams,
  type IOptionalViolation,
  type TOptionalViolationKind,
} from "../rules/whole_tree/optional_params.ts";
import { checkRepository as checkUnusedExports } from "../rules/whole_tree/unused_exports.ts";
import { checkDuplicates, DUPLICATE_RULES, type DuplicateRuleKey } from "../rules/whole_tree/duplicate_check.ts";
import { checkMagicLiterals } from "../rules/whole_tree/magic_check.ts";
import { formatMagicViolation } from "../rules/whole_tree/magic_literals.ts";
import {
  type IConstantRestatementSettings,
  type IOptionalParamsSettings,
  type IUnusedExportsSettings,
  type IWholeTreeSettings,
  parseWholeTreeSettings,
} from "../rules/whole_tree/options.ts";

const MAGIC_RULE = "magic-literals";
const RULES: readonly string[] = [
  "constant-restatement",
  "unused-exports",
  "optional-params",
  MAGIC_RULE,
  ...DUPLICATE_RULES,
];
const USAGE_EXIT = 2;

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

async function runUnusedExports(strict: boolean, settings: IUnusedExportsSettings): Promise<void> {
  const report = await checkUnusedExports(Deno.cwd(), strict, settings);
  if (report.findings.length === 0) {
    console.log("✅ No unwired exports found.");
    return;
  }
  for (const finding of report.findings) {
    const tail = strict
      ? "This is likely dead code or was never wired. Remove it or wire it."
      : "exported but never imported by production code.";
    const prefix = strict ? "ERROR" : "WARN";
    const lead = strict ? "is exported, NOT re-exported through any barrel, and never imported." : "is";
    console.log(`${prefix} [unwired-export] ${finding.repoPath}:${finding.line} – '${finding.name}' ${lead} ${tail}`);
  }
  if (strict) {
    console.log(`\n❌ ${report.findings.length} strictly unwired export(s) — likely dead code. Fix before commit.`);
    Deno.exit(1);
  }
  console.log(`\n⚠️  ${report.findings.length} unwired export(s) found (relaxed mode).`);
  console.log("  Run with --strict for CI-grade dead-code detection.");
  console.log("\nTop directories:");
  for (const [dir, count] of report.topDirectories) console.log(`  ${dir}: ${count}`);
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
    }> [--strict] [--staged] [--include-tests] [--fail]`,
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
    return structuredClone(compiled.catalog) as JsonValue;
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

async function main(): Promise<void> {
  const rule = flagValue(Deno.args, "rule");
  if (rule === undefined || !RULES.includes(rule)) exitWithUsage("Missing or unknown --rule.");
  const catalog = await loadCatalog(Deno.args);
  if (isDuplicateRule(rule)) return await runDuplicates(rule, catalog);
  if (rule === MAGIC_RULE) return await runMagicLiterals(catalog, Deno.args.includes("--include-tests"));
  const settings = loadSettings(catalog);
  const args = Deno.args;
  if (rule === "constant-restatement") {
    if (!settings.constantRestatement) exitWithUsage("The catalog has no wholeTree.constantRestatement section.");
    await runConstantRestatement(settings.constantRestatement);
  }
  if (rule === "unused-exports") {
    if (!settings.unusedExports) exitWithUsage("The catalog has no wholeTree.unusedExports section.");
    await runUnusedExports(args.includes("--strict"), settings.unusedExports);
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
