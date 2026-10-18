/**
 * @module RuleRegistryTestHelper
 * @path packages/lint-rules/tests/helpers/registry.ts
 * @description Shared registry, rule packs, and loaders that bind the engine tests to the TypeScript rule pack.
 * @architectural-layer Test
 * @dependencies [@exaix/lint-rules]
 * @related-files [packages/lint-rules/src/engine/registry.ts, packages/lint-rules/src/rules/mod.ts]
 */

import {
  createLintPlugin,
  createRuleRegistry,
  type ICatalog,
  type IRulePack,
  type IRuleRegistry,
  type JsonValue,
  parseCatalog,
  TYPESCRIPT_RULE_PACK,
} from "@exaix/lint-rules";

export const TEST_PLUGIN_NAME = "exaix";

export const TEST_RULE_PACKS: readonly IRulePack[] = [TYPESCRIPT_RULE_PACK];

export const TEST_REGISTRY: IRuleRegistry = createRuleRegistry(TEST_PLUGIN_NAME, TEST_RULE_PACKS);

/** Parses a catalog against the TypeScript rule pack. */
export function loadTestCatalog(input: JsonValue): ICatalog {
  return parseCatalog(input, { scriptRuleSchemas: null, registry: TEST_REGISTRY });
}

/** Builds the lint plugin for a parsed catalog with the TypeScript rule pack. */
export function createTestPlugin(catalog: ICatalog): Deno.lint.Plugin {
  return createLintPlugin(TEST_PLUGIN_NAME, catalog, { rulePacks: TEST_RULE_PACKS });
}
