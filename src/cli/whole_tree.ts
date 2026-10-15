#!/usr/bin/env -S deno run -A
/**
 * @module WholeTreeCli
 * @path packages/lint-rules/src/cli/whole_tree.ts
 * @description Runs a whole-tree rule over the repository.
 * @architectural-layer Tooling
 * @related-files [packages/lint-rules/src/rules/whole_tree/constant_restatement.ts]
 *
 * Usage:
 *   deno run --allow-read packages/lint-rules/src/cli/whole_tree.ts --rule=constant-restatement
 */

import { checkRepository } from "../rules/whole_tree/constant_restatement.ts";
import { WHOLE_TREE_SETTINGS } from "../rules/whole_tree/options.ts";

const RULES: readonly string[] = ["constant-restatement"];

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function runConstantRestatement(): Promise<void> {
  const findings = await checkRepository(Deno.cwd(), WHOLE_TREE_SETTINGS.constantRestatement);
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

async function main(): Promise<void> {
  const rule = flagValue(Deno.args, "rule");
  if (rule === undefined || !RULES.includes(rule)) {
    console.error(`Usage: whole_tree.ts --rule=<${RULES.join("|")}>`);
    Deno.exit(2);
  }
  if (rule === "constant-restatement") await runConstantRestatement();
}

if (import.meta.main) await main();
