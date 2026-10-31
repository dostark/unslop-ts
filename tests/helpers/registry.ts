/**
 * @module RuleRegistryTestHelper
 * @path tests/helpers/registry.ts
 * @description Shared registry, rule packs, and loaders that bind the engine tests to the TypeScript and Deno rule packs.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/engine/registry.ts, src/rules/mod.ts]
 */

import {
  createRuleRegistry,
  DENO_RULE_PACK,
  type ICatalog,
  type IRulePack,
  type IRuleRegistry,
  type JsonValue,
  parseCatalog,
  TYPESCRIPT_RULE_PACK,
} from "../../mod.ts";
import { createDenoPlugin } from "../../deno.ts";

export const TEST_PLUGIN_NAME = "demo";

export const TEST_RULE_PACKS: readonly IRulePack[] = [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK];

export const TEST_REGISTRY: IRuleRegistry = createRuleRegistry(TEST_PLUGIN_NAME, TEST_RULE_PACKS);

/** Parses a catalog against the engine rule packs. */
export function loadTestCatalog(input: JsonValue): ICatalog {
  return parseCatalog(input, { scriptRuleSchemas: null, registry: TEST_REGISTRY });
}

/** Builds the lint plugin for a parsed catalog with the engine rule packs. */
export function createTestPlugin(catalog: ICatalog): Deno.lint.Plugin {
  return createDenoPlugin(TEST_PLUGIN_NAME, catalog, { rulePacks: TEST_RULE_PACKS });
}

/** Builds a one-rule catalog while preserving each fixture's scopes and tags. */
export function singleRuleCatalog(
  key: string,
  options: Record<string, JsonValue>,
  scopes: Record<string, JsonValue>,
  category: string,
  scope: string,
): Record<string, JsonValue> {
  return {
    version: "1",
    scopes,
    tagVocabulary: {
      [category]: { description: "The tested rule category." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      [`${TEST_PLUGIN_NAME}/${key}`]: {
        engine: "plugin",
        severity: "error",
        scope,
        tags: [category, "deslop"],
        options,
      },
    },
  };
}

export const STANDARD_TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

/** The standalone plugin fixture used by both direct and hosted lint tests. */
export function testPluginSource(catalog: JsonValue): string {
  const mod = new URL("../../mod.ts", import.meta.url).href;
  const denoHost = new URL("../../deno.ts", import.meta.url).href;
  return [
    `import { DENO_RULE_PACK, parseCatalog, TYPESCRIPT_RULE_PACK } from ${JSON.stringify(mod)};`,
    `import { createRuleRegistry } from ${JSON.stringify(mod)};`,
    `import { createDenoPlugin } from ${JSON.stringify(denoHost)};`,
    `const registry = createRuleRegistry("demo", [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK]);`,
    `const catalog = parseCatalog(${JSON.stringify(catalog)}, { scriptRuleSchemas: null, registry });`,
    `export default createDenoPlugin("demo", catalog, { rulePacks: [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK] });`,
    "",
  ].join("\n");
}
