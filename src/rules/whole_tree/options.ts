/**
 * @module WholeTreeOptions
 * @path src/rules/whole_tree/options.ts
 * @description Whole-tree rule settings: the schema of a catalog's `wholeTree` section and its parser.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/rules/whole_tree/constant_restatement.ts, src/cli/whole_tree.ts]
 */

import { z } from "zod";
import { CatalogError, type JsonValue } from "../../engine/catalog.ts";

const WHOLE_TREE_KEY = "wholeTree";

/** Schema of the catalog `wholeTree` section. Each section is optional, and an unknown key is rejected. */
const WholeTreeSettingsSchema = z.object({
  optionalParams: z.object({
    wrapperType: z.string(),
    wrapperImport: z.string(),
    reasonExamples: z.array(z.string()),
    testSegments: z.array(z.string()),
    testSuffixes: z.array(z.string()),
    skipSegments: z.array(z.string()),
    walkSkipSegments: z.array(z.string()),
    /** Catalog id of the plugin rule that enforces the wrapper on staged files. */
    pluginRuleId: z.string(),
  }).strict(),
  unusedExports: z.object({
    productionRoots: z.array(z.string()),
    testSegments: z.array(z.string()),
    testSuffixes: z.array(z.string()),
    entrypointSuffixes: z.array(z.string()),
    mainEntrypointSuffixes: z.array(z.string()),
    scriptRoot: z.string(),
    walkSkipPatterns: z.array(z.string()),
    strictSkipPrefixes: z.array(z.string()),
    strictSkipSegments: z.array(z.string()),
  }).strict(),
  constantRestatement: z.object({
    constantModules: z.array(z.string()),
    testRoots: z.array(z.string()),
    minRestatedElements: z.number().int().positive(),
  }).strict(),
}).partial().strict();

const DuplicateAllowEntrySchema = z.object({
  name: z.string(),
  files: z.array(z.string()),
  reason: z.string(),
}).strict();

const DEFAULT_MIN_PROPERTIES = 2;
const DEFAULT_CONSTANT_NAME_PATTERN = "^[A-Z][A-Z0-9_]*$";

/** Options of the duplicate-type check, as a catalog rule entry states them. */
export const DuplicateTypeOptionsSchema = z.object({
  minProperties: z.number().int().positive().default(DEFAULT_MIN_PROPERTIES),
  allow: z.array(DuplicateAllowEntrySchema).default([]),
}).strict();

/** Options of the duplicate-constant check, as a catalog rule entry states them. */
export const DuplicateConstantOptionsSchema = z.object({
  namePattern: z.string().default(DEFAULT_CONSTANT_NAME_PATTERN),
  allow: z.array(DuplicateAllowEntrySchema).default([]),
}).strict();

/** An allow entry as a caller writes it. */
export interface IDuplicateAllowInput {
  readonly name: string;
  readonly files: readonly string[];
  readonly reason: string;
}

/** Duplicate-type options before defaults apply. */
export interface IDuplicateTypeInput {
  readonly minProperties?: number;
  readonly allow?: readonly IDuplicateAllowInput[];
}

/** Duplicate-constant options before defaults apply. */
export interface IDuplicateConstantInput {
  readonly namePattern?: string;
  readonly allow?: readonly IDuplicateAllowInput[];
}

/** The catalog `wholeTree` section. */
export type IWholeTreeSettings = z.infer<typeof WholeTreeSettingsSchema>;

/** Settings for the constant-restatement rule. */
export type IConstantRestatementSettings = NonNullable<IWholeTreeSettings["constantRestatement"]>;

/** Settings for the unused-exports rule. */
export type IUnusedExportsSettings = NonNullable<IWholeTreeSettings["unusedExports"]>;

/** Settings for the optional-parameter rule. */
export type IOptionalParamsSettings = NonNullable<IWholeTreeSettings["optionalParams"]>;

const CatalogSettingsSchema = z.object({ [WHOLE_TREE_KEY]: WholeTreeSettingsSchema.optional() }).loose();

/** Reads and validates the `wholeTree` section of a catalog. A catalog without the section gives `{}`. */
export function parseWholeTreeSettings(catalog: JsonValue): IWholeTreeSettings {
  const parsed = CatalogSettingsSchema.safeParse(catalog);
  if (parsed.success) return parsed.data[WHOLE_TREE_KEY] ?? {};
  const issue = parsed.error.issues[0];
  throw new CatalogError(issue?.path.map(String).join(".") || WHOLE_TREE_KEY, issue?.message ?? "invalid catalog");
}
