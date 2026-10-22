/**
 * @module RuleMetadata
 * @path src/rules/meta.ts
 * @description Metadata contract that every engine rule, whole-tree check, and consumer script declares.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/types.ts, src/rules/mod.ts, src/rules/whole_tree/checks.ts, src/config/descriptor.ts]
 */

/** The engine that owns a rule and runs it. */
export type RuleEngine = "plugin" | "whole-tree" | "script";

/** The subject area of a rule. One category names one section of the engine guide. */
export type RuleCategory =
  | "type-safety"
  | "imports"
  | "boundaries"
  | "interfaces"
  | "magic-values"
  | "module-structure"
  | "test-quality"
  | "scripts"
  | "complexity"
  | "optional-parameters"
  | "comments";

/** The engine preset that enables a rule, or `opt-in` when only an explicit selection enables it. */
export type PresetMembership = "recommended" | "strict" | "opt-in";

/** Metadata every engine descriptor declares. */
export interface IRuleMeta {
  /** One sentence a user reads in `rules list`, at most {@link DESCRIPTION_MAX_LENGTH} characters. */
  readonly description: string;
  readonly category: RuleCategory;
  /** The engine guide anchor, appended to the project docs base. */
  readonly docs: string;
  readonly preset: PresetMembership;
  /** A stated limit of the check, or null when the check has no limit worth stating. */
  readonly limits: string | null;
}

/** The largest accepted description. A longer sentence belongs in the guide. */
export const DESCRIPTION_MAX_LENGTH = 120;

/** Every category a rule may declare, in guide order. */
export const RULE_CATEGORIES: readonly RuleCategory[] = [
  "type-safety",
  "imports",
  "boundaries",
  "interfaces",
  "magic-values",
  "module-structure",
  "test-quality",
  "scripts",
  "complexity",
  "optional-parameters",
  "comments",
];

/** Every preset membership a rule may declare. */
export const PRESET_MEMBERSHIPS: readonly PresetMembership[] = ["recommended", "strict", "opt-in"];
