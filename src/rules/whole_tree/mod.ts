/**
 * @module WholeTreeEntry
 * @path src/rules/whole_tree/mod.ts
 * @description Deno-only entry for the whole-tree checks that a host script calls in-process.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/whole_tree/duplicate_type.ts, src/rules/whole_tree/duplicate_constant.ts]
 */

export {
  buildJscpdArgs,
  checkRepository as checkDuplicateCode,
  type IClone,
  type IDuplicateCodeGroupResult,
  type IDuplicateCodeReport,
  npxRunner,
  type TJscpdRunner,
} from "./duplicate_code.ts";
export { findDuplicateConstants, validateConstantAllowEntries } from "./duplicate_constant.ts";
export { findDuplicateTypes, validateTypeAllowEntries } from "./duplicate_type.ts";
export {
  detectMagicLiterals,
  formatMagicViolation,
  type IMagicFileBreakdown,
  type IMagicLiteralFile,
  type IMagicViolation,
  type MagicLiteralKind,
  type MagicViolationScope,
} from "./magic_literals.ts";
export type { IDuplicate, IDuplicateAllowEntry, ISourceUnit } from "./duplicate_groups.ts";
export {
  DuplicateCodeSettingsSchema,
  DuplicateConstantOptionsSchema,
  DuplicateTypeOptionsSchema,
  type IDuplicateAllowInput,
  type IDuplicateCodeSettingsInput,
  type IDuplicateConstantInput,
  type IDuplicateTypeInput,
  type IMagicLiteralInput,
  MagicLiteralOptionsSchema,
} from "./options.ts";
