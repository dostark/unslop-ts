/**
 * @module RuleRegistryTestHelper
 * @path packages/lint-rules/tests/helpers/registry.ts
 * @description Shared registry, rule packs, and loaders that bind the engine tests to the TypeScript and Deno rule packs.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/registry.ts, packages/lint-rules/src/rules/mod.ts]
 */

import {
  createLintPlugin,
  createRuleRegistry,
  DENO_RULE_PACK,
  type ICatalog,
  type IRulePack,
  type IRuleRegistry,
  type JsonValue,
  parseCatalog,
  TYPESCRIPT_RULE_PACK,
} from "../../mod.ts";

export const TEST_PLUGIN_NAME = "demo";

export const TEST_RULE_PACKS: readonly IRulePack[] = [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK];

export const TEST_REGISTRY: IRuleRegistry = createRuleRegistry(TEST_PLUGIN_NAME, TEST_RULE_PACKS);

/** Parses a catalog against the engine rule packs. */
export function loadTestCatalog(input: JsonValue): ICatalog {
  return parseCatalog(input, { scriptRuleSchemas: null, registry: TEST_REGISTRY });
}

/** Builds the lint plugin for a parsed catalog with the engine rule packs. */
export function createTestPlugin(catalog: ICatalog): Deno.lint.Plugin {
  return createLintPlugin(TEST_PLUGIN_NAME, catalog, { rulePacks: TEST_RULE_PACKS });
}
