/**
 * @module OxlintUnslopPlugin
 * @path examples/oxlint/unslop.plugin.mjs
 * @description Default-exports the unslop-ts ESLint plugin for the Oxlint jsPlugins entry.
 */

import { createEslintPlugin } from "../../eslint.ts";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../../mod.ts";

export default createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "unslop" });
