/**
 * @module LintRules
 * @path packages/lint-rules/mod.ts
 * @description Generic lint-rule engine: catalog loader, plugin factory, rule registry, and test helpers.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/catalog.ts, packages/lint-rules/src/engine/plugin.ts, packages/lint-rules/src/engine/registry.ts]
 */

export { CatalogError, classifyPath, parseCatalog, PATH_CLASS, ruleSettings } from "./src/engine/catalog.ts";
export { createLintPlugin } from "./src/engine/plugin.ts";
export { createRuleRegistry, RuleRegistryError } from "./src/engine/registry.ts";
export { runPlugin } from "./src/engine/run_plugin.ts";
export { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "./src/rules/mod.ts";
export type { ICatalog, IResolvedRuleSettings, JsonValue, PathClass } from "./src/engine/catalog.ts";
export type { ICatalogLoadOptions, ScriptRuleSchemas } from "./src/engine/catalog.ts";
export type { RuleScope, RuleSeverity } from "./src/engine/catalog.ts";
export type { ILintPluginOptions } from "./src/engine/plugin.ts";
export type { IRulePack, IRuleRegistry } from "./src/engine/registry.ts";
export type { IPluginRule, IPluginRuleContext, LintVisitor } from "./src/rules/types.ts";
