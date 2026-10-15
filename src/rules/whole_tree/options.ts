/**
 * @module WholeTreeOptions
 * @path packages/lint-rules/src/rules/whole_tree/options.ts
 * @description Whole-tree rule settings, read from the catalog's `wholeTree` section.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/whole_tree/constant_restatement.ts]
 */

import catalogJson from "../../../../../scripts/config/style_rule_catalog.json" with { type: "json" };

/** Settings for the constant-restatement rule. */
export type IConstantRestatementSettings = typeof catalogJson.wholeTree.constantRestatement;

/** Settings for the unused-exports rule. */
export type IUnusedExportsSettings = typeof catalogJson.wholeTree.unusedExports;

/** Settings for the optional-parameter rule. */
export type IOptionalParamsSettings = typeof catalogJson.wholeTree.optionalParams;

/** The catalog `wholeTree` section. */
export type IWholeTreeSettings = typeof catalogJson.wholeTree;

/** Whole-tree settings, read once from the catalog. */
export const WHOLE_TREE_SETTINGS: IWholeTreeSettings = catalogJson.wholeTree;
