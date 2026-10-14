/**
 * @module PluginRules
 * @path packages/lint-rules/src/rules/mod.ts
 * @description Registry of plugin rule implementations, keyed by catalog rule id.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/plugin.ts]
 */

import { createNoChainedTypeAssertions } from "./no_chained_type_assertions.ts";
import {
  createNoConditionalEmptyObjectSpread,
  createNoRuntimeTypeof,
  createRequireSafetyComment,
} from "./evidence_rules.ts";
import {
  createNoAnyEscape,
  createNoExplicitUnknown,
  createNoObjectParameters,
  createNoPassThroughTypeAlias,
  createNoUnsafeDictionary,
} from "./type_safety_rules.ts";
import { createNoBooleanAssert } from "./test_assertion_rules.ts";
import type { IPluginRule } from "./types.ts";

export const PLUGIN_RULE_IMPLEMENTATIONS: Record<string, IPluginRule> = {
  "exaix/no-chained-type-assertions": { create: createNoChainedTypeAssertions },
  "exaix/no-explicit-unknown": { create: createNoExplicitUnknown },
  "exaix/no-unsafe-dictionary": { create: createNoUnsafeDictionary },
  "exaix/no-any-escape": { create: createNoAnyEscape },
  "exaix/no-pass-through-type-alias": { create: createNoPassThroughTypeAlias },
  "exaix/no-object-parameters": { create: createNoObjectParameters },
  "exaix/require-safety-comment": { create: createRequireSafetyComment },
  "exaix/no-runtime-typeof": { create: createNoRuntimeTypeof },
  "exaix/no-conditional-empty-object-spread": { create: createNoConditionalEmptyObjectSpread },
  "exaix/no-boolean-assert": { create: createNoBooleanAssert },
};
