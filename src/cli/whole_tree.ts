#!/usr/bin/env -S deno run -A
/**
 * @module WholeTreeCli
 * @path packages/lint-rules/src/cli/whole_tree.ts
 * @description Runs a whole-tree rule over the repository.
 * @architectural-layer Tooling
 * @related-files [packages/lint-rules/src/rules/whole_tree/unused_exports.ts]
 *
 * Usage:
 *   deno run -A packages/lint-rules/src/cli/whole_tree.ts --rule=constant-restatement
 *   deno run -A packages/lint-rules/src/cli/whole_tree.ts --rule=unused-exports [--strict]
 */

import { checkRepository as checkConstantRestatement } from "../rules/whole_tree/constant_restatement.ts";
import { checkRepository as checkUnusedExports } from "../rules/whole_tree/unused_exports.ts";
import { WHOLE_TREE_SETTINGS } from "../rules/whole_tree/options.ts";

const RULES: readonly string[] = ["constant-restatement", "unused-exports"];

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

async function main(): Promise<void> {
  const rule = flagValue(Deno.args, "rule");
  if (rule === undefined || !RULES.includes(rule)) {
    console.error(`Usage: whole_tree.ts --rule=<${RULES.join("|")}> [--strict]`);
    Deno.exit(2);
  }
  if (rule === "constant-restatement") await runConstantRestatement();
  if (rule === "unused-exports") await runUnusedExports(Deno.args.includes("--strict"));
}

if (import.meta.main) await main();
