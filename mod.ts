/**
 * @module LintRules
 * @path mod.ts
 * @description Generic lint-rule engine: catalog loader, plugin factory, registry, metadata, configuration compiler, and descriptor contracts.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/catalog.ts, src/engine/plugin.ts, src/engine/registry.ts, src/rules/meta.ts, src/config/compile.ts]
 */

export { CatalogError, classifyPath, parseCatalog, PATH_CLASS, ruleSettings } from "./src/engine/catalog.ts";
export { createLintPlugin, selectionEnvName } from "./src/engine/plugin.ts";
export { createRuleRegistry, RuleRegistryError } from "./src/engine/registry.ts";
export { runPlugin } from "./src/engine/run_plugin.ts";
export { compileConfig, NOT_ENABLED_REASON } from "./src/config/compile.ts";
export { DEFAULT_HOST_MODE, hostBaseLevel, PLUGIN_RULE_CONTROLS } from "./src/config/descriptor.ts";
export { configJsonSchema } from "./src/config/json_schema.ts";
export { PRESET_IDS, PRESETS } from "./src/config/presets.ts";
export { createUnslopProject } from "./src/config/project.ts";
export { ConfigError, ConfigV2Schema, JsonValueSchema, RuleSettingSchema, ScopeSchema } from "./src/config/schema.ts";
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
export type { IPreset, PresetId } from "./src/config/presets.ts";
export type { IUnslopProject, IUnslopProjectInput } from "./src/config/project.ts";
export type { IRegistryEntry } from "./src/config/registry.ts";
export type { IConfigV2 } from "./src/config/schema.ts";
export type { ICatalog, IResolvedRuleSettings, JsonValue, PathClass } from "./src/engine/catalog.ts";
export type { ICatalogLoadOptions, ScriptRuleSchemas } from "./src/engine/catalog.ts";
export type { RuleScope, RuleSeverity } from "./src/engine/catalog.ts";
export type { ILintPluginOptions } from "./src/engine/plugin.ts";
export type { IRulePack, IRuleRegistry } from "./src/engine/registry.ts";
export type { IRuleMeta, PresetMembership, RuleCategory, RuleEngine } from "./src/rules/meta.ts";
export type { IWholeTreeCheck, WholeTreeCheckKey } from "./src/rules/whole_tree/checks.ts";
export type { IWholeTreeSettings } from "./src/rules/whole_tree/options.ts";
export type { IPluginRule, IPluginRuleContext, LintVisitor } from "./src/rules/types.ts";
