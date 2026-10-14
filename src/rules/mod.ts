/**
 * @module PluginRules
 * @path packages/lint-rules/src/rules/mod.ts
 * @description Registry of plugin rule implementations, keyed by catalog rule id.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/plugin.ts]
 */

import { createNoChainedTypeAssertions } from "./no_chained_type_assertions.ts";
import type { IPluginRule } from "./types.ts";

export const PLUGIN_RULE_IMPLEMENTATIONS: Record<string, IPluginRule> = {
  "exaix/no-chained-type-assertions": { create: createNoChainedTypeAssertions },
};
