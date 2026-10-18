/**
 * @module LintRulesTypes
 * @path packages/lint-rules/src/rules/types.ts
 * @description Shared types for plugin rule implementations.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts, packages/lint-rules/src/engine/catalog.ts]
 */

import type { JsonValue } from "../engine/catalog.ts";

/** The Deno lint visitor type, derived because the namespace exports no `Visitor`. */
export type LintVisitor = ReturnType<Deno.lint.Rule["create"]>;

export interface IPluginRuleContext {
  /** Options parsed and defaulted from the rule's catalog entry. */
  readonly options: Record<string, JsonValue>;
  /** True when the file under lint is a test file. */
  readonly isTestFile: boolean;
  /** CODE_STYLE.md anchor the report hint links to. */
  readonly codeStyle?: string;
  /** The name the plugin is registered under, which prefixes its catalog ids. */
  readonly pluginName: string;
}

export interface IPluginRule {
  create(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor;
}
