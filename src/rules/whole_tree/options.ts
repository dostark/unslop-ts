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
const DEFAULT_MIN_CLONE_LINES = 5;
const DEFAULT_MIN_CLONE_TOKENS = 50;

/** The jscpd release that a duplicate-code run installs when the settings name none. */
export const DEFAULT_JSCPD_VERSION = "5.4.2";

/** The magic-literal thresholds. */
export interface IMagicThresholds {
  localString: number;
  globalString: number;
  localNumber: number;
  globalNumber: number;
}

/** The magic-literal thresholds before defaults apply. */
export interface IMagicThresholdsInput {
  localString?: number;
  globalString?: number;
  localNumber?: number;
  globalNumber?: number;
}

/** Options of the magic-literal detector. */
export interface IMagicLiteralOptions {
  checkNumbers: boolean;
  thresholds: IMagicThresholds;
  additionalStrings: string[];
  minStringLength: number;
  minNumber: number;
  roundNumberStep: number;
  roundNumberMax: number;
  httpStatusRange: [number, number];
  metadataProperties: string[];
  structuralArrayProperties: string[];
  statusLiterals: string[];
  definitionFileSuffixes: string[];
  testScaffoldPattern: string;
}

/** Magic-literal options before defaults apply. */
export interface IMagicLiteralOptionsInput {
  checkNumbers?: boolean;
  thresholds?: IMagicThresholdsInput;
  additionalStrings?: string[];
  minStringLength?: number;
  minNumber?: number;
  roundNumberStep?: number;
  roundNumberMax?: number;
  httpStatusRange?: [number, number];
  metadataProperties?: string[];
  structuralArrayProperties?: string[];
  statusLiterals?: string[];
  definitionFileSuffixes?: string[];
  testScaffoldPattern?: string;
}

/** Options of the optional-parameter check. */
export interface IOptionalParamsSettings {
  wrapperType: string;
  wrapperImport: string;
  reasonExamples: string[];
  testSegments: string[];
  testSuffixes: string[];
  skipSegments: string[];
  walkSkipSegments: string[];
  pluginRuleId: string;
}

/** Options of the unused-exports check. */
export interface IUnusedExportsSettings {
  productionRoots: string[];
  testSegments: string[];
  testSuffixes: string[];
  entrypointSuffixes: string[];
  mainEntrypointSuffixes: string[];
  scriptRoot: string;
  walkSkipPatterns: string[];
  strictSkipPrefixes: string[];
  strictSkipSegments: string[];
  severity?: IUnusedSeverity;
}

/** Per-class enforcement: a justified class can report a warning instead of an error. */
export interface IUnusedSeverity {
  type: "warning" | "error";
  value: "warning" | "error";
  parity: "warning" | "error";
}

/** One configured module alias: a bare specifier prefix and the repository path it resolves to. */
export interface IUnusedFilesAlias {
  readonly prefix: string;
  readonly target: string;
}

/** Options of the unused-files check. Every field is project-specific, so none has a default. */
export interface IUnusedFilesSettings {
  productionRoots: string[];
  testSegments: string[];
  testSuffixes: string[];
  entrypointSuffixes: string[];
  mainEntrypointSuffixes: string[];
  scriptRoot: string;
  walkSkipPatterns: string[];
  aliases: IUnusedFilesAlias[];
  skipPrefixes: string[];
  skipSegments: string[];
}

/** One scan group of the duplicate-code check: a set of roots, its filters, and the duplication it may carry. */
export interface IDuplicateCodeGroup {
  name: string;
  paths: string[];
  ignore: string[];
  /** A jscpd glob that narrows the scan to the matching files, or null to scan every file under the paths. */
  pattern: string | null;
  /** The highest duplicated-token percentage that still passes. */
  threshold: number;
}

/** A scan group as the catalog states it, before defaults apply. */
export interface IDuplicateCodeGroupInput {
  name: string;
  paths: string[];
  ignore?: string[];
  pattern?: string | null;
  threshold: number;
}

/** Options of the duplicate-code check after defaults apply. */
export interface IDuplicateCodeSettings {
  jscpdVersion: string;
  minLines: number;
  minTokens: number;
  groups: IDuplicateCodeGroup[];
}

/** Options of the duplicate-code check before defaults apply. */
export interface IDuplicateCodeSettingsInput {
  jscpdVersion?: string;
  minLines?: number;
  minTokens?: number;
  groups: IDuplicateCodeGroupInput[];
}

/** Settings for the constant-restatement rule. */
export interface IConstantRestatementSettings {
  constantModules: string[];
  testRoots: string[];
  minRestatedElements: number;
}

/** The catalog `wholeTree` section before defaults apply. */
export interface IWholeTreeSettingsInput {
  optionalParams?: IOptionalParamsSettings;
  unusedExports?: IUnusedExportsSettings;
  unusedFiles?: IUnusedFilesSettings;
  constantRestatement?: IConstantRestatementSettings;
  magicLiterals?: IMagicLiteralOptionsInput;
  duplicateCode?: IDuplicateCodeSettingsInput;
}

/** The catalog `wholeTree` section. */
export interface IWholeTreeSettings {
  optionalParams?: IOptionalParamsSettings;
  unusedExports?: IUnusedExportsSettings;
  unusedFiles?: IUnusedFilesSettings;
  constantRestatement?: IConstantRestatementSettings;
  magicLiterals?: IMagicLiteralOptions;
  duplicateCode?: IDuplicateCodeSettings;
}

/** One allow entry as the schema yields it. */
export interface IDuplicateAllow {
  name: string;
  files: string[];
  reason: string;
}

/** Duplicate-type options after defaults apply. */
export interface IDuplicateType {
  minProperties: number;
  allow: IDuplicateAllow[];
}

/** Duplicate-constant options after defaults apply. */
export interface IDuplicateConstant {
  namePattern: string;
  allow: IDuplicateAllow[];
}

const MagicThresholdsSchema: z.ZodType<IMagicThresholds, IMagicThresholdsInput> = z.object({
  localString: z.number().int().nonnegative().default(DEFAULT_LOCAL_STRING_THRESHOLD),
  globalString: z.number().int().nonnegative().default(DEFAULT_GLOBAL_STRING_THRESHOLD),
  localNumber: z.number().int().nonnegative().default(DEFAULT_LOCAL_NUMBER_THRESHOLD),
  globalNumber: z.number().int().nonnegative().default(DEFAULT_GLOBAL_NUMBER_THRESHOLD),
}).strict();

/** Options of the magic-literal detector. Every list that names a project vocabulary is an option. */
export const MagicLiteralOptionsSchema: z.ZodType<IMagicLiteralOptions, IMagicLiteralOptionsInput> = z.object({
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
export const OptionalParamsSettingsSchema: z.ZodType<IOptionalParamsSettings, IOptionalParamsSettings> = z.object({
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
export const UnusedExportsSettingsSchema: z.ZodType<IUnusedExportsSettings, IUnusedExportsSettings> = z.object({
  productionRoots: z.array(z.string()),
  testSegments: z.array(z.string()),
  testSuffixes: z.array(z.string()),
  entrypointSuffixes: z.array(z.string()),
  mainEntrypointSuffixes: z.array(z.string()),
  scriptRoot: z.string(),
  walkSkipPatterns: z.array(z.string()),
  strictSkipPrefixes: z.array(z.string()),
  strictSkipSegments: z.array(z.string()),
  severity: z.object({
    type: z.enum(["warning", "error"]),
    value: z.enum(["warning", "error"]),
    parity: z.enum(["warning", "error"]),
  }).strict().optional(),
}).strict();

/** One module alias as the catalog states it. */
const UnusedFilesAliasSchema: z.ZodType<IUnusedFilesAlias, IUnusedFilesAlias> = z.object({
  prefix: z.string(),
  target: z.string(),
}).strict();

/** Options of the unused-files check. Every field is project-specific, so none has a default. */
export const UnusedFilesSettingsSchema: z.ZodType<IUnusedFilesSettings, IUnusedFilesSettings> = z.object({
  productionRoots: z.array(z.string()),
  testSegments: z.array(z.string()),
  testSuffixes: z.array(z.string()),
  entrypointSuffixes: z.array(z.string()),
  mainEntrypointSuffixes: z.array(z.string()),
  scriptRoot: z.string(),
  walkSkipPatterns: z.array(z.string()),
  aliases: z.array(UnusedFilesAliasSchema),
  skipPrefixes: z.array(z.string()),
  skipSegments: z.array(z.string()),
}).strict();

/** Options of the constant-restatement check. Every field is project-specific, so none has a default. */
export const ConstantRestatementSettingsSchema: z.ZodType<IConstantRestatementSettings, IConstantRestatementSettings> =
  z.object({
    constantModules: z.array(z.string()),
    testRoots: z.array(z.string()),
    minRestatedElements: z.number().int().positive(),
  }).strict();

const DuplicateCodeGroupSchema: z.ZodType<IDuplicateCodeGroup, IDuplicateCodeGroupInput> = z.object({
  name: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  ignore: z.array(z.string()).default([]),
  pattern: z.string().min(1).nullable().default(null),
  threshold: z.number().nonnegative(),
}).strict();

/** Options of the duplicate-code check. The scan groups are project-specific; the jscpd limits default to its own. */
export const DuplicateCodeSettingsSchema: z.ZodType<IDuplicateCodeSettings, IDuplicateCodeSettingsInput> = z.object({
  jscpdVersion: z.string().min(1).default(DEFAULT_JSCPD_VERSION),
  minLines: z.number().int().positive().default(DEFAULT_MIN_CLONE_LINES),
  minTokens: z.number().int().positive().default(DEFAULT_MIN_CLONE_TOKENS),
  groups: z.array(DuplicateCodeGroupSchema).min(1).refine(
    (groups) => new Set(groups.map((group) => group.name)).size === groups.length,
    { message: "Scan group names must be unique." },
  ),
}).strict();

/** Schema of the catalog `wholeTree` section. Each section is optional, and an unknown key is rejected. */
const WholeTreeSettingsSchema: z.ZodType<IWholeTreeSettings, IWholeTreeSettingsInput> = z.object({
  optionalParams: OptionalParamsSettingsSchema,
  unusedExports: UnusedExportsSettingsSchema,
  unusedFiles: UnusedFilesSettingsSchema,
  constantRestatement: ConstantRestatementSettingsSchema,
  magicLiterals: MagicLiteralOptionsSchema,
  duplicateCode: DuplicateCodeSettingsSchema,
}).partial().strict();

const DuplicateAllowEntrySchema: z.ZodType<IDuplicateAllow, IDuplicateAllow> = z.object({
  name: z.string(),
  files: z.array(z.string()),
  reason: z.string(),
}).strict();

const DEFAULT_MIN_PROPERTIES = 2;
const DEFAULT_CONSTANT_NAME_PATTERN = "^[A-Z][A-Z0-9_]*$";

/** Options of the duplicate-type check, as a catalog rule entry states them. */
export const DuplicateTypeOptionsSchema: z.ZodType<IDuplicateType, IDuplicateTypeInput> = z.object({
  minProperties: z.number().int().positive().default(DEFAULT_MIN_PROPERTIES),
  allow: z.array(DuplicateAllowEntrySchema).default([]),
}).strict();

/** Options of the duplicate-constant check, as a catalog rule entry states them. */
export const DuplicateConstantOptionsSchema: z.ZodType<IDuplicateConstant, IDuplicateConstantInput> = z.object({
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

const CatalogSettingsSchema = z.object({ [WHOLE_TREE_KEY]: WholeTreeSettingsSchema.optional() }).loose();

/** Reads and validates the `wholeTree` section of a catalog. A catalog without the section gives `{}`. */
export function parseWholeTreeSettings(catalog: unknown): IWholeTreeSettings {
  const parsed = CatalogSettingsSchema.safeParse(catalog);
  if (parsed.success) return parsed.data[WHOLE_TREE_KEY] ?? {};
  const issue = parsed.error.issues[0];
  throw new CatalogError(issue?.path.map(String).join(".") || WHOLE_TREE_KEY, issue?.message ?? "invalid catalog");
}
