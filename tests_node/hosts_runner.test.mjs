/**
 * @module HostsRunnerTest
 * @path tests_node/hosts_runner.test.mjs
 * @description Proves the ESLint and Oxlint host runners match their direct CLI runs.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runEslintHost } from "./hosts/eslint.mjs";
import { runOxlintHost } from "./hosts/oxlint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASE = {
  rule: "ignore-needs-reason",
  code: "// eslint-disable-next-line unslop/no-explicit-unknown\nexport const value: unknown = 1;\n",
};
const FILTERED_RULE = `unslop/${CASE.rule}`;

test("the ESLint runner matches a direct CLI run", () => {
  const dir = mkdtempSync(join(ROOT, ".hosts-parity-"));
  try {
    writeFileSync(join(dir, "sample.ts"), CASE.code);
    const eslintPath = JSON.stringify(join(ROOT, "eslint.ts"));
    const modPath = JSON.stringify(join(ROOT, "mod.ts"));
    writeFileSync(
      join(dir, "eslint.config.mjs"),
      [
        `import parser from "@typescript-eslint/parser";`,
        `import { createEslintPlugin } from ${eslintPath};`,
        `import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from ${modPath};`,
        `const plugin = createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "unslop" });`,
        `export default [{`,
        `  files: ["**/*.ts"],`,
        `  languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },`,
        `  plugins: { unslop: plugin },`,
        `  settings: { unslop: { testGlobs: ["**/*_test.ts"], fixtureGlobs: ["**/fixtures/**"], ignoreGlobs: [] } },`,
        `  rules: { ${JSON.stringify(FILTERED_RULE)}: "error" },`,
        `}];`,
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [join(ROOT, "node_modules", "eslint", "bin", "eslint.js"), "--format=json", "sample.ts"],
      { cwd: dir, encoding: "utf8" },
    );
    const reports = JSON.parse(result.stdout);
    const direct = reports[0].messages
      .filter((message) => message.ruleId === FILTERED_RULE)
      .map((message) => ({ rule: message.ruleId, line: message.line, message: message.message }));
    const runner = runEslintHost(CASE).filter((entry) => entry.rule === FILTERED_RULE)
      .map((entry) => ({ rule: entry.rule, line: entry.line, message: entry.message }));
    assert.deepEqual(runner, direct);
    assert.equal(direct.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Oxlint runner matches a direct CLI run", () => {
  const code = "// oxlint-disable-next-line unslop/no-explicit-unknown\nexport const value: unknown = 1;\n";
  const dir = mkdtempSync(join(ROOT, ".hosts-parity-"));
  try {
    writeFileSync(join(dir, "sample.ts"), code);
    writeFileSync(
      join(dir, "oxlintrc.json"),
      JSON.stringify({
        plugins: ["typescript"],
        jsPlugins: [join(ROOT, "examples", "oxlint", "unslop.plugin.mjs")],
        rules: { [FILTERED_RULE]: "error" },
      }),
    );
    const result = spawnSync(
      join(ROOT, "node_modules", ".bin", "oxlint"),
      ["-c", join(dir, "oxlintrc.json"), "--format=json", join(dir, "sample.ts")],
      { cwd: ROOT, encoding: "utf8" },
    );
    const direct = JSON.parse(result.stdout).diagnostics
      .map((entry) => ({
        rule: entry.code.replace(/^unslop\((.+)\)$/, "unslop/$1"),
        line: entry.labels[0].span.line,
        column: entry.labels[0].span.column,
      }))
      .filter((entry) => entry.rule === FILTERED_RULE);
    const runner = runOxlintHost({ rule: CASE.rule, code })
      .filter((entry) => entry.rule === FILTERED_RULE)
      .map((entry) => ({ rule: entry.rule, line: entry.line, column: entry.column }));
    assert.deepEqual(runner, direct);
    assert.equal(direct.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
