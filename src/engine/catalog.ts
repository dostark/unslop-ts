/**
 * @module LintRuleCatalog
 * @path packages/lint-rules/src/engine/catalog.ts
 * @description Loads and validates the style-rule catalog, classifies repo paths, and resolves rule settings.
 * @architectural-layer Shared
 * @dependencies [@std/path, zod]
 * @related-files [packages/lint-rules/mod.ts, packages/lint-rules/src/rules/rule_options.ts]
 */

import { globToRegExp } from "@std/path";
import { z } from "zod";
import { RULE_OPTION_SCHEMAS } from "../rules/rule_options.ts";

export type PathClass = "prod" | "test" | "fixture";
export type RuleScope = "prod" | "test" | "all";
export type RuleSeverity = "error" | "warn" | "off";

/** A JSON-serializable value. Catalog payloads and option values use this, not a raw unknown. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Per-rule option schemas for script-engine rules, owned by the script that implements them. */
export type ScriptRuleSchemas = Record<string, z.ZodTypeAny>;

/** Loader context. `scriptRuleSchemas` is null when the caller only needs plugin-rule validation. */
export interface ICatalogLoadOptions {
  readonly scriptRuleSchemas: ScriptRuleSchemas | null;
}

export interface IResolvedRuleSettings {
  readonly severity: RuleSeverity;
  readonly scope: RuleScope;
  readonly include?: string[];
  readonly exclude?: string[];
  readonly codeStyle?: string;
  readonly exclusionCodes?: Record<string, string>;
  readonly options: Record<string, JsonValue>;
}

/** Path classes, named once so no bare literal repeats across the engine. */
export const PATH_CLASS = { prod: "prod", test: "test", fixture: "fixture" } as const;

/** Typed loader failure that names the JSON path of the offending catalog entry. */
export class CatalogError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "CatalogError";
    this.path = path;
  }
}

const ScopeSchema = z.enum(["prod", "test", "all"]);
const SeveritySchema = z.enum(["error", "warn", "off"]);
const EngineSchema = z.enum(["script", "plugin"]);

const ScopesSchema = z.object({
  test: z.array(z.string()),
  fixture: z.array(z.string()),
}).strict();

const TagEntrySchema = z.object({
  description: z.string(),
  requiresScope: z.array(ScopeSchema).optional(),
}).strict();

const RuleEntrySchema = z.object({
  engine: EngineSchema,
  severity: SeveritySchema,
  scope: ScopeSchema,
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  codeStyle: z.string().optional(),
  optIn: z.boolean().optional(),
  reason: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  exclusionCodes: z.record(z.string(), z.string()).optional(),
  tags: z.array(z.string()),
  limits: z.string().optional(),
}).strict();

const IgnoreSchema = z.object({ glob: z.string(), reason: z.string() }).strict();

const LayoutSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.array(z.string()),
    z.array(z.object({ path: z.string(), reason: z.string() }).strict()),
  ]),
);

const CatalogSchema = z.object({
  version: z.string(),
  scopes: ScopesSchema,
  layout: LayoutSchema.optional(),
  tagVocabulary: z.record(z.string(), TagEntrySchema),
  rules: z.record(z.string(), RuleEntrySchema),
  ignore: z.array(IgnoreSchema).optional(),
}).strict();

export type ICatalog = z.infer<typeof CatalogSchema>;
export type ICatalogScopes = z.infer<typeof ScopesSchema>;
type IRuleEntry = z.infer<typeof RuleEntrySchema>;

function issuePath(error: z.ZodError, fallback: string): string {
  const issue = error.issues[0];
  return issue && issue.path.length > 0 ? issue.path.join(".") : fallback;
}

function validateRuleTags(id: string, entry: IRuleEntry, catalog: ICatalog): void {
  for (const tag of entry.tags) {
    const vocabulary = catalog.tagVocabulary[tag];
    if (!vocabulary) {
      throw new CatalogError(`rules.${id}.tags`, `tag '${tag}' is not in tagVocabulary`);
    }
    if (vocabulary.requiresScope && !vocabulary.requiresScope.includes(entry.scope)) {
      throw new CatalogError(
        `rules.${id}.tags.${tag}`,
        `tag '${tag}' requires a scope in ${vocabulary.requiresScope.join("|")}`,
      );
    }
  }
}

function optionSchemaFor(
  id: string,
  entry: IRuleEntry,
  scriptSchemas: ScriptRuleSchemas | null,
): z.ZodTypeAny | null {
  if (entry.engine === "plugin") {
    const schema = RULE_OPTION_SCHEMAS[id];
    if (!schema) {
      throw new CatalogError(`rules.${id}`, "no plugin rule implementation is registered for this id");
    }
    return schema;
  }
  if (!scriptSchemas) return null;
  return scriptSchemas[id] ?? null;
}

function validateRuleOptions(id: string, entry: IRuleEntry, schema: z.ZodTypeAny | null): void {
  if (!schema) return;
  const options = schema.safeParse(entry.options ?? {});
  if (!options.success) {
    throw new CatalogError(`rules.${id}.options`, options.error.issues[0]?.message ?? "invalid options");
  }
}

function validateRuleEntry(
  id: string,
  entry: IRuleEntry,
  catalog: ICatalog,
  scriptSchemas: ScriptRuleSchemas | null,
): void {
  if (entry.engine === "plugin" && entry.severity === "warn") {
    throw new CatalogError(`rules.${id}.severity`, "plugin rules support only 'error' or 'off'");
  }
  if ((entry.severity === "off" || entry.optIn === true) && !entry.reason) {
    throw new CatalogError(`rules.${id}.reason`, "'off' and 'optIn' require a reason");
  }
  if (entry.tags.length === 0) {
    throw new CatalogError(`rules.${id}.tags`, "a rule needs at least one tag");
  }
  validateRuleTags(id, entry, catalog);
  validateRuleOptions(id, entry, optionSchemaFor(id, entry, scriptSchemas));
}

function validateVocabularyUsage(catalog: ICatalog): void {
  const usedTags = new Set(Object.values(catalog.rules).flatMap((entry) => entry.tags));
  for (const tag of Object.keys(catalog.tagVocabulary)) {
    if (!usedTags.has(tag)) {
      throw new CatalogError(`tagVocabulary.${tag}`, "vocabulary tag is unused by any rule");
    }
  }
}

/** Validates `input` and returns the typed catalog, or throws a {@link CatalogError}. */
export function parseCatalog(
  input: JsonValue,
  options: ICatalogLoadOptions = { scriptRuleSchemas: null },
): ICatalog {
  const parsed = CatalogSchema.safeParse(input);
  if (!parsed.success) {
    throw new CatalogError(issuePath(parsed.error, "catalog"), parsed.error.issues[0]?.message ?? "invalid catalog");
  }
  for (const [id, entry] of Object.entries(parsed.data.rules)) {
    validateRuleEntry(id, entry, parsed.data, options.scriptRuleSchemas);
  }
  validateVocabularyUsage(parsed.data);
  return parsed.data;
}

const compiledGlobs = new Map<string, RegExp>();

function globRegex(glob: string): RegExp {
  let regex = compiledGlobs.get(glob);
  if (!regex) {
    regex = globToRegExp(glob, { extended: true, globstar: true });
    compiledGlobs.set(glob, regex);
  }
  return regex;
}

function matchesAny(repoPath: string, globs: string[]): boolean {
  return globs.some((glob) => globRegex(glob).test(repoPath));
}

/** Classifies a repository-relative path as production, test, or fixture. */
export function classifyPath(repoPath: string, scopes: ICatalogScopes): PathClass {
  if (matchesAny(repoPath, scopes.fixture)) return PATH_CLASS.fixture;
  if (matchesAny(repoPath, scopes.test)) return PATH_CLASS.test;
  return PATH_CLASS.prod;
}

/** Returns the effective settings for a rule id, with option defaults applied. */
export function ruleSettings(catalog: ICatalog, id: string): IResolvedRuleSettings {
  const entry = catalog.rules[id];
  if (!entry) throw new CatalogError(`rules.${id}`, "no catalog entry for this rule id");
  const schema = RULE_OPTION_SCHEMAS[id];
  const options = schema
    ? schema.parse(entry.options ?? {}) as Record<string, JsonValue>
    : (entry.options ?? {}) as Record<string, JsonValue>;
  return {
    severity: entry.severity,
    scope: entry.scope,
    include: entry.include,
    exclude: entry.exclude,
    codeStyle: entry.codeStyle,
    exclusionCodes: entry.exclusionCodes,
    options,
  };
}
