/**
 * @module ExampleLintPlugin
 * @path examples/lint_plugin.ts
 * @description Minimal plugin entry for a Deno project: it loads the example catalog and registers the TypeScript rule pack under the name `demo`.
 * @architectural-layer Example
 * @dependencies [@dostark/unslop-ts]
 * @related-files [examples/catalog.json, tests/example_project_test.ts]
 *
 * Usage:
 *   Add `"lint": { "plugins": ["./examples/lint_plugin.ts"] }` to the `deno.json` of the project, then run `deno lint`.
 */

import { createLintPlugin, createRuleRegistry, parseCatalog, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";
import catalog from "./catalog.json" with { type: "json" };

const PLUGIN_NAME = "demo";
const packs = [TYPESCRIPT_RULE_PACK];
const registry = createRuleRegistry(PLUGIN_NAME, packs);

export default createLintPlugin(PLUGIN_NAME, parseCatalog(catalog, { scriptRuleSchemas: null, registry }), {
  rulePacks: packs,
});
