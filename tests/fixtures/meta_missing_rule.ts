/**
 * @module MissingRuleMetaFixture
 * @path tests/fixtures/meta_missing_rule.ts
 * @description Compile fixture: a plugin rule without metadata must not type-check.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/registry_test.ts, src/rules/types.ts]
 */

import type { IPluginRule } from "../../src/rules/types.ts";

// @ts-expect-error a plugin rule must declare its metadata
export const RULE_WITHOUT_META: IPluginRule = { create: () => ({}) };
