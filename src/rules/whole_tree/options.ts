/**
 * @module WholeTreeOptions
 * @path src/rules/whole_tree/options.ts
 * @description Whole-tree rule settings: the schema of a catalog's `wholeTree` section and its parser.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/rules/whole_tree/constant_restatement.ts, src/cli/whole_tree.ts]
 */

import { z } from "zod";
import { CatalogError } from "../../engine/catalog.ts";
import { RegexSourceSchema } from "../../engine/regex_option.ts";

const WHOLE_TREE_KEY = "wholeTree";

const DEFAULT_LOCAL_STRING_THRESHOLD = 3;
const DEFAULT_GLOBAL_STRING_THRESHOLD = 5;
const DEFAULT_LOCAL_NUMBER_THRESHOLD = 4;
const DEFAULT_GLOBAL_NUMBER_THRESHOLD = 6;
const DEFAULT_MIN_NUMBER = 100;
const DEFAULT_MIN_STRING_LENGTH = 4;
const DEFAULT_ROUND_NUMBER_STEP = 50;
const DEFAULT_ROUND_NUMBER_MAX = 1000;
const DEFAULT_HTTP_STATUS_MIN = 100;
const DEFAULT_HTTP_STATUS_MAX = 599;
const DEFAULT_TEST_SCAFFOLD_PATTERN = "^(test|mock|fake|dummy)[-_]";

const MagicThresholdsSchema = z.object({
  localString: z.number().int().nonnegative().default(DEFAULT_LOCAL_STRING_THRESHOLD),
  globalString: z.number().int().nonnegative().default(DEFAULT_GLOBAL_STRING_THRESHOLD),
  localNumber: z.number().int().nonnegative().default(DEFAULT_LOCAL_NUMBER_THRESHOLD),
  globalNumber: z.number().int().nonnegative().default(DEFAULT_GLOBAL_NUMBER_THRESHOLD),
}).strict();

/** Options of the magic-literal detector. Every list that names a project vocabulary is an option. */
export const MagicLiteralOptionsSchema = z.object({
  checkNumbers: z.boolean().default(true),
  thresholds: MagicThresholdsSchema.default(() => MagicThresholdsSchema.parse({})),
  /** Strings that never count, on top of the built-in structural words. */
  additionalStrings: z.array(z.string()).default([]),
  minStringLength: z.number().int().nonnegative().default(DEFAULT_MIN_STRING_LENGTH),
  minNumber: z.number().nonnegative().default(DEFAULT_MIN_NUMBER),
  roundNumberStep: z.number().positive().default(DEFAULT_ROUND_NUMBER_STEP),
  roundNumberMax: z.number().nonnegative().default(DEFAULT_ROUND_NUMBER_MAX),
  httpStatusRange: z.tuple([z.number(), z.number()]).default([DEFAULT_HTTP_STATUS_MIN, DEFAULT_HTTP_STATUS_MAX]),
  /** Property names whose string value is descriptive text, not a value. */
  metadataProperties: z.array(z.string()).default(["description", "title", "label", "placeholder"]),
  /** Property names whose array of strings is structural, such as a list of required fields. */
  structuralArrayProperties: z.array(z.string()).default(["required", "args", "enum"]),
  /** Strings that name states of a project domain and never count. */
  statusLiterals: z.array(z.string()).default([]),
  /** Path suffixes of files that define constants or enums. They never count, and they make a literal reusable. */
  definitionFileSuffixes: z.array(z.string()).default(["constants.ts", "enums.ts"]),
  /** A string that matches this pattern in a test file is test scaffolding. */
  testScaffoldPattern: RegexSourceSchema.default(DEFAULT_TEST_SCAFFOLD_PATTERN),
}).strict();

/** Magic-literal options before defaults apply. */
export type IMagicLiteralInput = z.input<typeof MagicLiteralOptionsSchema>;

/** Options of the optional-parameter check. Every field is project-specific, so none has a default. */
export const OptionalParamsSettingsSchema = z.object({
  wrapperType: z.string(),
  wrapperImport: z.string(),
  reasonExamples: z.array(z.string()),
  testSegments: z.array(z.string()),
  testSuffixes: z.array(z.string()),
  skipSegments: z.array(z.string()),
  walkSkipSegments: z.array(z.string()),
  /** Catalog id of the plugin rule that enforces the wrapper on staged files. */
  pluginRuleId: z.string(),
}).strict();

/** Options of the unused-exports check. Every field is project-specific, so none has a default. */
export const UnusedExportsSettingsSchema = z.object({
  productionRoots: z.array(z.string()),
  testSegments: z.array(z.string()),
  testSuffixes: z.array(z.string()),
  entrypointSuffixes: z.array(z.string()),
  mainEntrypointSuffixes: z.array(z.string()),
  scriptRoot: z.string(),
  walkSkipPatterns: z.array(z.string()),
  strictSkipPrefixes: z.array(z.string()),
  strictSkipSegments: z.array(z.string()),
}).strict();

/** Options of the constant-restatement check. Every field is project-specific, so none has a default. */
export const ConstantRestatementSettingsSchema = z.object({
  constantModules: z.array(z.string()),
  testRoots: z.array(z.string()),
  minRestatedElements: z.number().int().positive(),
}).strict();

/** Schema of the catalog `wholeTree` section. Each section is optional, and an unknown key is rejected. */
const WholeTreeSettingsSchema = z.object({
  optionalParams: OptionalParamsSettingsSchema,
  unusedExports: UnusedExportsSettingsSchema,
  constantRestatement: ConstantRestatementSettingsSchema,
  magicLiterals: MagicLiteralOptionsSchema,
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
export function parseWholeTreeSettings(catalog: unknown): IWholeTreeSettings {
  const parsed = CatalogSettingsSchema.safeParse(catalog);
  if (parsed.success) return parsed.data[WHOLE_TREE_KEY] ?? {};
  const issue = parsed.error.issues[0];
  throw new CatalogError(issue?.path.map(String).join(".") || WHOLE_TREE_KEY, issue?.message ?? "invalid catalog");
}
