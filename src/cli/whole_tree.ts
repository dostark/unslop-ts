#!/usr/bin/env -S deno run -A
/**
 * @module WholeTreeCli
 * @path packages/lint-rules/src/cli/whole_tree.ts
 * @description Runs a whole-tree rule over the repository.
 * @architectural-layer Tooling
 * @related-files [packages/lint-rules/src/rules/whole_tree/optional_params.ts]
 *
 * Usage:
 *   deno run -A packages/lint-rules/src/cli/whole_tree.ts --rule=constant-restatement
 *   deno run -A packages/lint-rules/src/cli/whole_tree.ts --rule=unused-exports [--strict]
 *   deno run -A packages/lint-rules/src/cli/whole_tree.ts --rule=optional-params [--include-tests] [--verbose] [--fail] [--fix] [--staged]
 */

import { relative } from "@std/path";
import { checkRepository as checkConstantRestatement } from "../rules/whole_tree/constant_restatement.ts";
import {
  checkRepository as checkOptionalParams,
  type IOptionalViolation,
  type TOptionalViolationKind,
} from "../rules/whole_tree/optional_params.ts";
import { checkRepository as checkUnusedExports } from "../rules/whole_tree/unused_exports.ts";
import { WHOLE_TREE_SETTINGS } from "../rules/whole_tree/options.ts";

const RULES: readonly string[] = ["constant-restatement", "unused-exports", "optional-params"];
const PLUGIN_BARE_OPTIONAL_RULE = "exaix/require-optional-wrapper";

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function runConstantRestatement(): Promise<void> {
  const findings = await checkConstantRestatement(Deno.cwd(), WHOLE_TREE_SETTINGS.constantRestatement);
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

async function runUnusedExports(strict: boolean): Promise<void> {
  const report = await checkUnusedExports(Deno.cwd(), strict);
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

async function stagedTargetFiles(includeTests: boolean): Promise<string[]> {
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
    .filter((line) => !line.includes("/.copilot/") && !line.includes("/.exa/") && !line.includes("/types/"))
    .filter((line) => !WHOLE_TREE_SETTINGS.optionalParams.skipSegments.some((segment) => line.includes(segment)))
    .filter((line) =>
      includeTests ||
      !(
        WHOLE_TREE_SETTINGS.optionalParams.testSegments.some((segment) => line.includes(segment)) ||
        WHOLE_TREE_SETTINGS.optionalParams.testSuffixes.some((suffix) => line.endsWith(suffix))
      )
    );
}

/** In staged mode the plugin bare-optional rule enforces the file-level ratchet. */
async function runOptionalParamsStaged(includeTests: boolean): Promise<void> {
  const files = await stagedTargetFiles(includeTests);
  if (files.length === 0) {
    console.log("✅ No bare-optional (`?` or `| undefined`) params in staged files.");
    return;
  }
  const command = new Deno.Command(Deno.execPath(), {
    args: ["lint", "--json", ...files],
    env: { EXAIX_LINT_RULES: PLUGIN_BARE_OPTIONAL_RULE },
    stdout: "piped",
    stderr: "null",
  });
  const { stdout } = await command.output();
  // SAFETY: `deno lint --json` emits exactly this diagnostic shape.
  const report = JSON.parse(new TextDecoder().decode(stdout)) as {
    diagnostics?: ReadonlyArray<{ code?: string; filename?: string; range?: { start?: { line?: number } } }>;
  };
  const findings = (report.diagnostics ?? []).filter((diagnostic) => diagnostic.code === PLUGIN_BARE_OPTIONAL_RULE);
  if (findings.length === 0) {
    console.log("✅ No bare-optional (`?` or `| undefined`) params in staged files.");
    return;
  }
  for (const finding of findings) {
    console.error(`  ${finding.filename}:${finding.range?.start?.line ?? 0}`);
  }
  console.error(
    `${findings.length} bare-optional param(s) in staged file(s) — staging a file obliges ` +
      `converting all of its bare optionals. Wrap each in ${WHOLE_TREE_SETTINGS.optionalParams.wrapperType}<T, Reason.*>.`,
  );
  Deno.exit(1);
}

async function runOptionalParams(
  staged: boolean,
  includeTests: boolean,
  verbose: boolean,
  fail: boolean,
  fix: boolean,
): Promise<void> {
  if (staged) {
    await runOptionalParamsStaged(includeTests);
    return;
  }
  const violations = await checkOptionalParams(Deno.cwd(), includeTests, WHOLE_TREE_SETTINGS.optionalParams);
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

async function main(): Promise<void> {
  const rule = flagValue(Deno.args, "rule");
  if (rule === undefined || !RULES.includes(rule)) {
    console.error(`Usage: whole_tree.ts --rule=<${RULES.join("|")}> [--strict] [--staged] [--include-tests] [--fail]`);
    Deno.exit(2);
  }
  const args = Deno.args;
  if (rule === "constant-restatement") await runConstantRestatement();
  if (rule === "unused-exports") await runUnusedExports(args.includes("--strict"));
  if (rule === "optional-params") {
    await runOptionalParams(
      args.includes("--staged"),
      args.includes("--include-tests"),
      args.includes("--verbose"),
      args.includes("--fail"),
      args.includes("--fix"),
    );
  }
}

if (import.meta.main) await main();
