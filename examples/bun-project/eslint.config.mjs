/**
 * @module ExampleEslintConfig
 * @path examples/eslint-project/eslint.config.mjs
 * @description Flat ESLint config that adds the unslop-ts recommended preset over typescript-eslint strict.
 */

import tseslint from "typescript-eslint";
import { createEslintPlugin } from "../../eslint.ts";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../../mod.ts";

const unslop = createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "unslop" });

export default [...tseslint.configs.strict, unslop.configs.recommended];
