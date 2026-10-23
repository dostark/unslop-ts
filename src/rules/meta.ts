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

/** The published guide every host links to. */
export const ENGINE_DOCS_URL = "https://github.com/dostark/unslop-ts/blob/main/docs/style_guide.md";

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

/** The one-line category description that a compiled tag vocabulary uses by default. */
export const CATEGORY_DESCRIPTIONS: Readonly<Record<RuleCategory, string>> = {
  "type-safety": "Rules that keep type evidence.",
  imports: "Rules about where imports sit and which imports are explicit.",
  boundaries: "Rules about what a file group may import.",
  interfaces: "Rules about interface names, renames, and placement.",
  "magic-values": "Rules about repeated literals and duplicated declarations.",
  "module-structure": "Rules about module layout and exports.",
  "test-quality": "Rules about test fixtures and assertions.",
  scripts: "Rules about runnable script headers.",
  complexity: "Rules about function and class size.",
  "optional-parameters": "Rules about how optional parameters are declared.",
  comments: "Rules about comment content and length.",
};
