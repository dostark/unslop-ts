/**
 * @module LintRules
 * @path mod.ts
 * @description Generic lint-rule engine: catalog loader, plugin factory, rule registry, metadata, and descriptor contracts.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/catalog.ts, src/engine/plugin.ts, src/engine/registry.ts, src/rules/meta.ts]
 */

export { CatalogError, classifyPath, parseCatalog, PATH_CLASS, ruleSettings } from "./src/engine/catalog.ts";
export { createLintPlugin, selectionEnvName } from "./src/engine/plugin.ts";
export { createRuleRegistry, RuleRegistryError } from "./src/engine/registry.ts";
export { runPlugin } from "./src/engine/run_plugin.ts";
export { DEFAULT_HOST_MODE, PLUGIN_RULE_CONTROLS } from "./src/config/descriptor.ts";
export { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "./src/rules/mod.ts";
export { DESCRIPTION_MAX_LENGTH, PRESET_MEMBERSHIPS, RULE_CATEGORIES } from "./src/rules/meta.ts";
export { WHOLE_TREE_CHECKS } from "./src/rules/whole_tree/checks.ts";
export { parseWholeTreeSettings } from "./src/rules/whole_tree/options.ts";
export type {
  ICompiledConfig,
  IProjectDescriptor,
  IResolvedRule,
  IRuleControls,
  IRuleSources,
  IScriptRuleSpec,
  IWholeTreeHostSpec,
  RuleControl,
  RuleOrigin,
} from "./src/config/descriptor.ts";
export type { ICatalog, IResolvedRuleSettings, JsonValue, PathClass } from "./src/engine/catalog.ts";
export type { ICatalogLoadOptions, ScriptRuleSchemas } from "./src/engine/catalog.ts";
export type { RuleScope, RuleSeverity } from "./src/engine/catalog.ts";
export type { ILintPluginOptions } from "./src/engine/plugin.ts";
export type { IRulePack, IRuleRegistry } from "./src/engine/registry.ts";
export type { IRuleMeta, PresetMembership, RuleCategory, RuleEngine } from "./src/rules/meta.ts";
export type { IWholeTreeCheck, WholeTreeCheckKey } from "./src/rules/whole_tree/checks.ts";
export type { IWholeTreeSettings } from "./src/rules/whole_tree/options.ts";
export type { IPluginRule, IPluginRuleContext, LintVisitor } from "./src/rules/types.ts";
