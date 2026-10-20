/**
 * @module LintRulesTypes
 * @path src/rules/types.ts
 * @description Shared types for plugin rule implementations.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/engine/catalog.ts]
 */

import type { JsonValue } from "../engine/catalog.ts";

/** The Deno lint visitor type, derived because the namespace exports no `Visitor`. */
export type LintVisitor = ReturnType<Deno.lint.Rule["create"]>;

export interface IPluginRuleContext {
  /** Options parsed and defaulted from the rule's catalog entry. */
  readonly options: Record<string, JsonValue>;
  /** The path of the file under lint, relative to the working directory. */
  readonly repoPath: string;
  /** True when the file under lint is a test file. */
  readonly isTestFile: boolean;
  /** The style guide anchor that the report hint links to. */
  readonly codeStyle?: string;
  /** The name the plugin is registered under, which prefixes its catalog ids. */
  readonly pluginName: string;
}

export interface IPluginRule {
  create(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor;
}
