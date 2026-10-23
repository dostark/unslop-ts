/**
 * @module ConfigSchema
 * @path src/config/schema.ts
 * @description The strict version 2 configuration schema, its error type, and the recursive JSON value schema.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/config/compile.ts, src/config/json_schema.ts, src/engine/catalog.ts]
 */

import { z } from "zod";
import type { JsonValue, RuleScope } from "../engine/catalog.ts";

/** The plugin name pattern: a lower-case identifier, so a catalog id has one unambiguous prefix. */
export const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** A rule severity level. */
export type RuleLevel = "error" | "warn" | "off";

/** One ignore entry of the `paths` section. */
export interface IIgnoreEntry {
  glob: string;
  reason: string;
}

/** The validated `paths` section. */
export interface IPaths {
  test: string[];
  fixture: string[];
  ignore: IIgnoreEntry[];
}

/** The `paths` section before defaults apply. */
export interface IPathsInput {
  test?: string[];
  fixture?: string[];
  ignore?: IIgnoreEntry[];
}

/** One tag definition of the `tags` section. */
export interface ITagDefinition {
  description: string;
  requiresScope?: RuleScope[];
}

/** The long form of a rule setting. */
export interface ILongRuleSetting {
  level: RuleLevel;
  options?: Record<string, JsonValue>;
  scope?: RuleScope;
  include?: string[];
  exclude?: string[];
  optIn?: boolean;
  reason?: string;
  docs?: string;
  limits?: string;
  tags?: string[];
  exclusionCodes?: Record<string, string>;
}

/** A rule setting: a level, a level and options, or the long form. */
export type RuleSetting = RuleLevel | [RuleLevel, Record<string, JsonValue>] | ILongRuleSetting;

/** A validated version 2 configuration. */
export interface IConfigV2 {
  $schema?: string;
  version: 2;
  plugin: string;
  extends: ("unslop:recommended" | "unslop:strict")[];
  docsBase: string;
  paths: IPaths;
  tags: Record<string, ITagDefinition>;
  rules: Record<string, RuleSetting>;
  profiles: Record<string, string[]>;
}

/** A version 2 configuration before defaults apply. */
export interface IConfigV2Input {
  $schema?: string;
  version: 2;
  plugin: string;
  extends?: ("unslop:recommended" | "unslop:strict")[];
  docsBase?: string;
  paths?: IPathsInput;
  tags?: Record<string, ITagDefinition>;
  rules?: Record<string, RuleSetting>;
  profiles?: Record<string, string[]>;
}

/** The accepted values of a scope field. */
export const ScopeSchema: z.ZodType<RuleScope, RuleScope> = z.enum(["prod", "test", "all"]);

const LEVEL: z.ZodType<RuleLevel, RuleLevel> = z.enum(["error", "warn", "off"]);

/** A JSON value: primitives, arrays, and string-keyed objects. No `undefined` and no non-finite number. */
export const JsonValueSchema: z.ZodType<JsonValue, JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

/** Typed configuration failure that names the JSON path of the offending field. */
export class ConfigError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ConfigError";
    this.path = path;
  }
}

const OPTIONS: z.ZodType<Record<string, JsonValue>, Record<string, JsonValue>> = z.record(z.string(), JsonValueSchema);

const IGNORE_ENTRY: z.ZodType<IIgnoreEntry, IIgnoreEntry> = z.object({
  glob: z.string().min(1),
  reason: z.string().min(1),
}).strict();

const PATHS: z.ZodType<IPaths, IPathsInput> = z.object({
  test: z.array(z.string()).default([]),
  fixture: z.array(z.string()).default([]),
  ignore: z.array(IGNORE_ENTRY).default([]),
}).strict();

const TAG_DEFINITION: z.ZodType<ITagDefinition, ITagDefinition> = z.object({
  description: z.string().min(1),
  requiresScope: z.array(ScopeSchema).optional(),
}).strict();

const LONG_FORM: z.ZodType<ILongRuleSetting, ILongRuleSetting> = z.object({
  level: LEVEL,
  options: OPTIONS.optional(),
  scope: ScopeSchema.optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  optIn: z.boolean().optional(),
  reason: z.string().optional(),
  docs: z.string().optional(),
  limits: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  exclusionCodes: z.record(z.string(), z.string()).optional(),
}).strict();

/** A rule setting: a level, a level and options, or the long form. */
export const RuleSettingSchema: z.ZodType<RuleSetting, RuleSetting> = z.union([
  LEVEL,
  z.tuple([LEVEL, OPTIONS]),
  LONG_FORM,
]);

/** The strict version 2 authoring schema. Registry-aware checks run in {@link compileConfig}. */
export const ConfigV2Schema: z.ZodType<IConfigV2, IConfigV2Input> = z.object({
  $schema: z.string().optional(),
  version: z.literal(2),
  plugin: z.string().regex(PLUGIN_NAME_PATTERN),
  extends: z.array(z.enum(["unslop:recommended", "unslop:strict"])).default([]),
  docsBase: z.string().default(""),
  paths: PATHS.default(() => ({ test: [], fixture: [], ignore: [] })),
  tags: z.record(z.string().min(1), TAG_DEFINITION).default({}),
  rules: z.record(z.string().min(1), RuleSettingSchema).default({}),
  profiles: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)).default({}),
}).strict();
