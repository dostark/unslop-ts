/**
 * @module EslintHostRunner
 * @path tests_node/hosts/eslint.mjs
 * @description Runs one rule case on the ESLint host and returns its diagnostics in the shared shape.
 */

import { Linter } from "eslint";
import parser from "@typescript-eslint/parser";
import { createEslintPlugin } from "../../eslint.ts";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../../mod.ts";

const PLUGIN = createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "unslop" });
const FILES = ["**/*.ts"];
const SETTINGS = {
  unslop: {
    testGlobs: ["**/*_test.ts"],
    fixtureGlobs: ["**/fixtures/**"],
    ignoreGlobs: ["**/vendor/**"],
  },
};

/** Runs a case through the in-process ESLint Linter with the adapter plugin. */
export function runEslintHost(testCase) {
  const linter = new Linter();
  const ruleConfig = testCase.options === undefined ? "error" : ["error", testCase.options];
  const messages = linter.verify(
    testCase.code,
    [{
      files: FILES,
      plugins: { unslop: PLUGIN },
      languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },
      rules: { [`unslop/${testCase.rule}`]: ruleConfig },
      settings: SETTINGS,
    }],
    { filename: testCase.filename ?? "src/a.ts" },
  );
  return messages
    .filter((message) => message.ruleId !== null)
    .map((message) => ({
      rule: message.ruleId,
      line: message.line,
      column: message.column,
      message: message.message,
    }));
}
