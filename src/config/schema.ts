/**
 * @module ConfigSchema
 * @path src/config/schema.ts
 * @description The strict version 2 configuration schema, its error type, and the recursive JSON value schema.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/config/compile.ts, src/config/json_schema.ts, src/engine/catalog.ts]
 */

import { z } from "zod";
import type { JsonValue } from "../engine/catalog.ts";

/** The plugin name pattern: a lower-case identifier, so a catalog id has one unambiguous prefix. */
export const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The accepted values of a scope field. */
export const ScopeSchema = z.enum(["prod", "test", "all"]);

const LEVEL = z.enum(["error", "warn", "off"]);

/** A JSON value: primitives, arrays, and string-keyed objects. No `undefined` and no non-finite number. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
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

const OPTIONS = z.record(z.string(), JsonValueSchema);

const IGNORE_ENTRY = z.object({
  glob: z.string().min(1),
  reason: z.string().min(1),
}).strict();

const PATHS = z.object({
  test: z.array(z.string()).default([]),
  fixture: z.array(z.string()).default([]),
  ignore: z.array(IGNORE_ENTRY).default([]),
}).strict();

const TAG_DEFINITION = z.object({
  description: z.string().min(1),
  requiresScope: z.array(ScopeSchema).optional(),
}).strict();

const LONG_FORM = z.object({
  level: LEVEL,
  options: OPTIONS.optional(),
  scope: ScopeSchema.optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  optIn: z.boolean().optional(),
  reason: z.string().optional(),
  docs: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  exclusionCodes: z.record(z.string(), z.string()).optional(),
}).strict();

/** A rule setting: a level, a level and options, or the long form. */
export const RuleSettingSchema = z.union([LEVEL, z.tuple([LEVEL, OPTIONS]), LONG_FORM]);

/** The strict version 2 authoring schema. Registry-aware checks run in {@link compileConfig}. */
export const ConfigV2Schema = z.object({
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

/** A validated version 2 configuration. */
export type IConfigV2 = z.infer<typeof ConfigV2Schema>;
