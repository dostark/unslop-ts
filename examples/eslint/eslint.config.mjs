/**
 * @module EslintExampleConfig
 * @path examples/eslint/eslint.config.mjs
 * @description Flat ESLint config that adds unslop-ts on top of a TypeScript baseline.
 */

import parser from "@typescript-eslint/parser";
import { createEslintPlugin } from "../../eslint.ts";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../../mod.ts";

const unslop = createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "unslop" });

export default [
  {
    files: ["**/*.ts"],
    languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },
    plugins: { unslop },
    settings: {
      unslop: {
        testGlobs: ["**/*_test.ts"],
        fixtureGlobs: ["**/fixtures/**"],
        ignoreGlobs: ["**/vendor/**"],
      },
    },
    rules: {
      "unslop/no-explicit-unknown": "error",
      "unslop/no-runtime-typeof": "error",
      "unslop/require-module-header": "error",
    },
  },
];
