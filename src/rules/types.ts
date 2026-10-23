/**
 * @module LintRulesTypes
 * @path src/rules/types.ts
 * @description Shared types for plugin rule implementations.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/engine/catalog.ts]
 */

import type { JsonValue } from "../engine/catalog.ts";
import type { IRuleMeta } from "./meta.ts";

/**
 * A node of the host linter AST.
 * This is the subset that Deno lint, ESLint, and Oxlint share: every host node has a type and a range.
 * Rule handlers narrow it through the `ILintNode` helpers in `type_environment.ts` to read dynamic keys.
 */
export interface IRuleNode {
  readonly type: string;
  readonly range?: readonly [number, number];
}

/** A line or block comment as every host reports it. */
export interface IRuleComment {
  readonly type: "Line" | "Block";
  readonly range: readonly [number, number];
  readonly value: string;
}

/** The source unit of the file under lint: text, root node, and comment queries. */
export interface IRuleSourceCode {
  readonly text: string;
  readonly ast: IRuleNode;
  getText(node?: IRuleNode): string;
  getAllComments(): readonly IRuleComment[];
  getCommentsBefore(node: IRuleNode): readonly IRuleComment[];
}

/** A finding a rule reports. Deno shows `hint`; the ESLint adapter appends it to `message`. */
export interface IRuleReport {
  readonly node?: IRuleNode;
  readonly range?: readonly [number, number];
  readonly message: string;
  readonly hint?: string;
}

/** The rule context every host adapter supplies to a rule. */
export interface IRuleContext {
  readonly filename: string;
  readonly sourceCode: IRuleSourceCode;
  report(descriptor: IRuleReport): void;
}

/** A visitor map keyed by node type or selector, as the host linter dispatches them. */
export type LintVisitor = Record<string, (node: IRuleNode) => void>;

/** A suppression-comment dialect the comment rules can check. */
export type SuppressionDialect = "deno" | "eslint" | "oxlint";

export interface IPluginRuleContext {
  /** Options parsed and defaulted from the rule's catalog entry. */
  readonly options: Record<string, JsonValue>;
  /** The path of the file under lint, relative to the working directory. */
  readonly repoPath: string;
  /** True when the file under lint is a test file. */
  readonly isTestFile: boolean;
  /** A consumer-provided guide anchor that replaces the rule default. */
  readonly codeStyle?: string;
  /** The name the plugin is registered under, which prefixes its catalog ids. */
  readonly pluginName: string;
  /** The suppression dialects the host honors. Absent means Deno only. */
  readonly dialects?: readonly SuppressionDialect[];
}

/** A linter whose rule overlaps an engine rule. */
export type OverlapEcosystem = "deno" | "eslint" | "typescript-eslint" | "oxlint" | "biome" | "eslint-comments";

/** One overlap of an engine rule with another linter's rule. */
export interface IRuleOverlap {
  readonly ecosystem: OverlapEcosystem;
  readonly rule: string;
  readonly kind: "duplicate" | "related";
}

export interface IPluginRule {
  /** Description, category, guide anchor, preset, and limits of the rule. */
  readonly meta: IRuleMeta;
  /** True when the rule reads `ctx.isTestFile`, so a host must supply test globs. */
  readonly requiresTestGlobs: boolean;
  /** How this rule relates to rules of other linters, per ecosystem. */
  readonly overlaps: readonly IRuleOverlap[];
  create(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor;
}

export const TYPE_SAFETY_GUIDE = "docs/style_guide.md#strict-type-safety";
