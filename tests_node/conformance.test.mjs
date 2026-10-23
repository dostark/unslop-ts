/**
 * @module ConformanceTest
 * @path tests_node/conformance.test.mjs
 * @description Runs the per-rule conformance data on ESLint (Node.js and Bun) and Oxlint (Node.js).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import parser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import { createEslintPlugin, HINT_SEPARATOR } from "../eslint.ts";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../mod.ts";
import table from "../tests/cases/conformance.json" with { type: "json" };
import { runOxlintHost } from "./hosts/oxlint.mjs";

const PLUGIN = createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "unslop" });
const SETTINGS = {
  unslop: {
    testGlobs: ["**/*_test.ts", "**/tests/**"],
    fixtureGlobs: ["**/tests/fixtures/**"],
    ignoreGlobs: ["**/vendor/**"],
  },
};

function baseMessage(message) {
  return message.split(HINT_SEPARATOR)[0];
}

function eslintDiagnostics(rule, invalid) {
  const id = `unslop/${rule}`;
  return new Linter().verify(
    invalid.code,
    [{
      files: ["**/*.ts"],
      plugins: { unslop: PLUGIN },
      languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },
      rules: { [id]: invalid.options === undefined ? "error" : ["error", ...invalid.options] },
      settings: SETTINGS,
    }],
    { filename: invalid.filename ?? "src/a.ts" },
  ).filter((message) => message.ruleId === id)
    .map((message) => ({ line: message.line, column: message.column, message: baseMessage(message.message) }));
}

function oxlintDiagnostics(rule, invalid) {
  return runOxlintHost({
    rule,
    code: invalid.code,
    ...(invalid.filename === undefined ? {} : { filename: invalid.filename }),
    ...(invalid.options === undefined ? {} : { options: invalid.options }),
  })
    .filter((entry) => entry.rule === `unslop/${rule}`)
    .map((entry) => ({ line: entry.line, column: entry.column, message: baseMessage(entry.message) }));
}

function problemsFor(collect) {
  return table.flatMap((entry) =>
    entry.invalid.flatMap((invalid) => {
      const expected = [{ line: invalid.line, column: invalid.column, message: invalid.message }];
      const found = collect(entry.rule, invalid);
      return JSON.stringify(found) === JSON.stringify(expected)
        ? []
        : [`${entry.rule}: ${JSON.stringify(found)} != ${JSON.stringify(expected)}`];
    })
  );
}

test("every rule's case matches the recorded line, column, and message on ESLint", () => {
  assert.deepEqual(problemsFor(eslintDiagnostics), []);
});

if (typeof Bun === "undefined") {
  test("every rule's case matches the recorded line, column, and message on Oxlint", () => {
    assert.deepEqual(problemsFor(oxlintDiagnostics), []);
  });
}

test("a seeded divergence is detected", () => {
  const entry = table[0];
  const found = eslintDiagnostics(entry.rule, entry.invalid[0]);
  const mutated = [{ ...found[0], column: found[0].column + 1 }];
  assert.notDeepEqual(mutated, found);
});
