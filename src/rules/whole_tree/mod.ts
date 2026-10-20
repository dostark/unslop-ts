/**
 * @module WholeTreeEntry
 * @path src/rules/whole_tree/mod.ts
 * @description Deno-only entry for the whole-tree checks that a host script calls in-process.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/whole_tree/duplicate_type.ts, src/rules/whole_tree/duplicate_constant.ts]
 */

export { findDuplicateConstants, validateConstantAllowEntries } from "./duplicate_constant.ts";
export { findDuplicateTypes, validateTypeAllowEntries } from "./duplicate_type.ts";
export type { IDuplicate, IDuplicateAllowEntry, ISourceUnit } from "./duplicate_groups.ts";
export {
  DuplicateConstantOptionsSchema,
  DuplicateTypeOptionsSchema,
  type IDuplicateAllowInput,
  type IDuplicateConstantInput,
  type IDuplicateTypeInput,
} from "./options.ts";
