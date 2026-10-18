/**
 * @module PluginRules
 * @path packages/lint-rules/src/rules/mod.ts
 * @description The TypeScript and Deno rule packs: the plugin rules the engine ships, keyed by bare rule key.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/registry.ts, packages/lint-rules/src/rules/rule_options.ts]
 */

import { createNoChainedTypeAssertions } from "./no_chained_type_assertions.ts";
import {
  createNoConditionalEmptyObjectSpread,
  createNoRuntimeTypeof,
  createRequireSafetyComment,
} from "./evidence_rules.ts";
import {
  createNoExplicitUnknown,
  createNoObjectParameters,
  createNoPassThroughTypeAlias,
  createNoTypeofEscape,
  createNoUnsafeDictionary,
} from "./type_safety_rules.ts";
import {
  createNoBooleanAssert,
  createNoConstantSubstringAssert,
  createNoRepeatedAssertCall,
} from "./test_assertion_rules.ts";
import { createMaxCyclomaticComplexity } from "./max_cyclomatic_complexity.ts";
import { createMaxClassSize } from "./max_class_size.ts";
import { createRequireOptionalWrapper } from "./require_optional_wrapper.ts";
import { createIgnoreNeedsReason } from "./deno/ignore_needs_reason.ts";
import { createNoForbiddenLintIgnore } from "./deno/no_forbidden_lint_ignore.ts";
import { createRequireDenoShebang } from "./deno/require_deno_shebang.ts";
import type { IRulePack } from "../engine/registry.ts";
import { DENO_OPTION_SCHEMAS, TYPESCRIPT_OPTION_SCHEMAS } from "./rule_options.ts";

/** The generic TypeScript rule pack: every plugin rule the engine ships, keyed by bare rule key. */
export const TYPESCRIPT_RULE_PACK: IRulePack = {
  name: "typescript",
  rules: {
    "no-chained-type-assertions": { create: createNoChainedTypeAssertions },
    "no-explicit-unknown": { create: createNoExplicitUnknown },
    "no-unsafe-dictionary": { create: createNoUnsafeDictionary },
    "no-typeof-escape": { create: createNoTypeofEscape },
    "no-pass-through-type-alias": { create: createNoPassThroughTypeAlias },
    "no-object-parameters": { create: createNoObjectParameters },
    "require-safety-comment": { create: createRequireSafetyComment },
    "no-runtime-typeof": { create: createNoRuntimeTypeof },
    "no-conditional-empty-object-spread": { create: createNoConditionalEmptyObjectSpread },
    "no-boolean-assert": { create: createNoBooleanAssert },
    "no-repeated-assert-call": { create: createNoRepeatedAssertCall },
    "no-constant-substring-assert": { create: createNoConstantSubstringAssert },
    "max-cyclomatic-complexity": { create: createMaxCyclomaticComplexity },
    "max-class-size": { create: createMaxClassSize },
    "require-optional-wrapper": { create: createRequireOptionalWrapper },
  },
  optionSchemas: TYPESCRIPT_OPTION_SCHEMAS,
};

/** The Deno rule pack: rules about `deno-lint-ignore` comments and Deno script headers. */
export const DENO_RULE_PACK: IRulePack = {
  name: "deno",
  rules: {
    "ignore-needs-reason": { create: createIgnoreNeedsReason },
    "no-forbidden-lint-ignore": { create: createNoForbiddenLintIgnore },
    "require-deno-shebang": { create: createRequireDenoShebang },
  },
  optionSchemas: DENO_OPTION_SCHEMAS,
};
