/**
 * @module ConfigCompile
 * @path src/config/compile.ts
 * @description Pure version 2 compilation: registry index, preset expansion, option validation, resolved rules, and the legacy catalog.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/config/schema.ts, src/config/registry.ts, src/config/presets.ts, src/config/descriptor.ts]
 */

import type { z } from "zod";
import type { ICatalog, JsonValue, RuleScope, RuleSeverity } from "../engine/catalog.ts";
import { CATEGORY_DESCRIPTIONS, RULE_CATEGORIES, type RuleCategory } from "../rules/meta.ts";
import {
  hostBaseLevel,
  type ICompiledConfig,
  type IProjectDescriptor,
  type IResolvedRule,
  type IRuleSources,
  type RuleOrigin,
} from "./descriptor.ts";
import { PRESETS } from "./presets.ts";
import { buildRegistryIndex, type IRegistryEntry } from "./registry.ts";
import { resolveSelectorTokens, SelectorError, selectorSource } from "./selectors.ts";
import { ConfigError, ConfigV2Schema, type IConfigV2, type RuleSettingSchema } from "./schema.ts";

/** The reason a rule carries when the configuration never names it. */
export const NOT_ENABLED_REASON = "Not enabled by the configuration.";

const DEFAULT_SCOPE: RuleScope = "all";
const ERROR: RuleSeverity = "error";
const WARN: RuleSeverity = "warn";
const OFF: RuleSeverity = "off";
const PLUGIN_ENGINE = "plugin";
const SCRIPT_ENGINE = "script";

/** The `wholeTree` section that holds each settings-based check. The duplication checks use catalog rules. */
const WHOLE_TREE_SECTIONS: Readonly<Record<string, string>> = {
  "magic-literals": "magicLiterals",
  "optional-params": "optionalParams",
  "unused-exports": "unusedExports",
  "unused-files": "unusedFiles",
  "constant-restatement": "constantRestatement",
};

type IRawSetting = z.infer<typeof RuleSettingSchema>;
type ICatalogRule = ICatalog["rules"][string];

/** One resolved authoring setting before it becomes a resolved rule. */
interface ISetting {
  readonly origin: RuleOrigin;
  readonly level: RuleSeverity;
  readonly options: Record<string, JsonValue>;
  readonly optionsSupplied: boolean;
  readonly scope: RuleScope | null;
  readonly include: readonly string[] | null;
  readonly exclude: readonly string[] | null;
  readonly optIn: boolean;
  readonly reason: string | null;
  readonly docs: string | null;
  readonly limits: string | null;
  readonly tags: readonly string[] | null;
  readonly exclusionCodes: Readonly<Record<string, string>> | null;
}

interface IOptionState {
  readonly configured: Record<string, JsonValue>;
  readonly defaults: Record<string, JsonValue> | null;
  readonly effective: Record<string, JsonValue>;
}

function issuePath(error: z.ZodError, fallback: string): string {
  const issue = error.issues[0];
  return issue && issue.path.length > 0 ? issue.path.map(String).join(".") : fallback;
}

function firstIssueMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

function parseConfig(input: JsonValue): IConfigV2 {
  const parsed = ConfigV2Schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new ConfigError(issuePath(parsed.error, "config"), firstIssueMessage(parsed.error, "invalid configuration"));
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function entryFor(
  index: ReadonlyMap<string, IRegistryEntry>,
  key: string,
  pluginName: string,
): IRegistryEntry {
  const entry = index.get(key);
  if (entry) return entry;
  if (key.includes("/") && !key.startsWith(`${pluginName}/`)) {
    throw new ConfigError(`rules.${key}`, `plugin rule ids use the '${pluginName}/' prefix`);
  }
  throw new ConfigError(`rules.${key}`, "no registered rule or check has this id");
}

interface INormalizedInput {
  readonly level: RuleSeverity;
  readonly options: Record<string, JsonValue>;
  readonly optionsSupplied: boolean;
  readonly scope: RuleScope | null;
  readonly include: readonly string[] | null;
  readonly exclude: readonly string[] | null;
  readonly optIn: boolean;
  readonly reason: string | null;
  readonly docs: string | null;
  readonly limits: string | null;
  readonly tags: readonly string[] | null;
  readonly exclusionCodes: Readonly<Record<string, string>> | null;
}

function normalizeInput(raw: IRawSetting): INormalizedInput {
  const empty = {
    options: {},
    optionsSupplied: false,
    scope: null,
    include: null,
    exclude: null,
    optIn: false,
    reason: null,
    docs: null,
    limits: null,
    tags: null,
    exclusionCodes: null,
  };
  if (typeof raw === "string") return { ...empty, level: raw };
  if (Array.isArray(raw)) {
    const [level, options] = raw as [RuleSeverity, Record<string, JsonValue>];
    return { ...empty, level, options, optionsSupplied: Object.keys(options).length > 0 };
  }
  return {
    level: raw.level,
    options: raw.options ?? {},
    optionsSupplied: raw.options !== undefined && Object.keys(raw.options).length > 0,
    scope: raw.scope ?? null,
    include: raw.include ?? null,
    exclude: raw.exclude ?? null,
    optIn: raw.optIn ?? false,
    reason: raw.reason ?? null,
    docs: raw.docs ?? null,
    limits: raw.limits ?? null,
    tags: raw.tags ?? null,
    exclusionCodes: raw.exclusionCodes ?? null,
  };
}

function validateReason(key: string, level: string, optIn: boolean, reason: string | null): void {
  if ((level === OFF || optIn) && !reason?.trim()) {
    throw new ConfigError(`rules.${key}.reason`, "'off' and 'optIn' require a reason");
  }
}

function validateLevel(entry: IRegistryEntry, key: string, level: string): void {
  if (!entry.controls.editable.includes("level")) {
    const base = hostBaseLevel(entry.controls);
    if (level !== base) {
      throw new ConfigError(`rules.${key}.level`, `the ${entry.engine} host fixes the level at '${base}'`);
    }
  } else if (entry.engine === PLUGIN_ENGINE && level === WARN) {
    throw new ConfigError(`rules.${key}.level`, "plugin rules support only 'error' or 'off'");
  }
}

function validateScope(entry: IRegistryEntry, key: string, scope: string | null): void {
  if (scope === null || entry.controls.editable.includes("scope")) return;
  const fixed = entry.controls.fixedScope ?? DEFAULT_SCOPE;
  if (scope !== fixed) {
    throw new ConfigError(`rules.${key}.scope`, `the ${entry.engine} host fixes the scope at '${fixed}'`);
  }
}

function validateLists(
  entry: IRegistryEntry,
  key: string,
  include: readonly string[] | null,
  exclude: readonly string[] | null,
): void {
  if (
    include !== null && !entry.controls.editable.includes("include") &&
    !sameList(include, entry.controls.fixedInclude ?? [])
  ) {
    throw new ConfigError(`rules.${key}.include`, `the ${entry.engine} host fixes the include list`);
  }
  if (
    exclude !== null && !entry.controls.editable.includes("exclude") &&
    !sameList(exclude, entry.controls.fixedExclude ?? [])
  ) {
    throw new ConfigError(`rules.${key}.exclude`, `the ${entry.engine} host fixes the exclude list`);
  }
}

function validateOptions(
  entry: IRegistryEntry,
  key: string,
  options: Record<string, JsonValue>,
  supplied: boolean,
): void {
  if (supplied && Object.keys(options).length > 0 && !entry.controls.editable.includes("options")) {
    throw new ConfigError(`rules.${key}.options`, `the ${entry.engine} host does not read options`);
  }
}

function normalizeSetting(entry: IRegistryEntry, key: string, raw: IRawSetting): ISetting {
  const normalized = normalizeInput(raw);
  validateReason(key, normalized.level, normalized.optIn, normalized.reason);
  validateLevel(entry, key, normalized.level);
  validateScope(entry, key, normalized.scope);
  validateLists(entry, key, normalized.include, normalized.exclude);
  validateOptions(entry, key, normalized.options, normalized.optionsSupplied);
  if (normalized.exclusionCodes !== null && entry.engineOwned) {
    throw new ConfigError(`rules.${key}.exclusionCodes`, "exclusion codes are consumer-only");
  }
  return { origin: `config:rules.${key}`, ...normalized };
}

function presetSetting(entry: IRegistryEntry, presetId: string): ISetting {
  return {
    origin: `preset:${presetId}`,
    level: entry.controls.fixedLevel ?? ERROR,
    options: {},
    optionsSupplied: false,
    scope: entry.controls.fixedScope ?? DEFAULT_SCOPE,
    include: entry.controls.fixedInclude,
    exclude: entry.controls.fixedExclude,
    optIn: false,
    reason: null,
    docs: null,
    limits: null,
    tags: null,
    exclusionCodes: null,
  };
}

function collectSettings(
  config: IConfigV2,
  index: ReadonlyMap<string, IRegistryEntry>,
): Map<string, ISetting> {
  const settings = new Map<string, ISetting>();
  for (const presetId of config.extends) {
    const preset = PRESETS[presetId];
    for (const [id, entry] of index) {
      if (!preset.memberships.includes(entry.meta.preset)) continue;
      settings.set(id, presetSetting(entry, preset.id));
    }
  }
  for (const [key, raw] of Object.entries(config.rules)) {
    const entry = entryFor(index, key, config.plugin);
    settings.set(entry.id, normalizeSetting(entry, key, raw));
  }
  return settings;
}

function defaultOptionsFor(schema: z.ZodTypeAny): Record<string, JsonValue> | null {
  const parsed = schema.safeParse({});
  return parsed.success ? (parsed.data as Record<string, JsonValue>) : null;
}

function configuredOptions(entry: IRegistryEntry, id: string, setting: ISetting): IOptionState {
  if (Object.hasOwn(setting.options, "__proto__")) {
    throw new ConfigError(`rules.${id}.options.__proto__`, "the option name '__proto__' is not allowed");
  }
  if (!entry.optionSchema) {
    if (Object.keys(setting.options).length > 0) {
      throw new ConfigError(`rules.${id}.options`, "this rule accepts no options");
    }
    return { configured: {}, defaults: null, effective: {} };
  }
  const parsed = entry.optionSchema.safeParse(setting.options);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const parts = issue?.path.map(String) ?? [];
    if (issue?.code === "unrecognized_keys" && issue.keys.length > 0) parts.push(issue.keys[0]);
    const field = parts.join(".");
    throw new ConfigError(
      `rules.${id}.options${field ? `.${field}` : ""}`,
      firstIssueMessage(parsed.error, "invalid options"),
    );
  }
  return {
    configured: setting.options,
    defaults: defaultOptionsFor(entry.optionSchema),
    effective: parsed.data as Record<string, JsonValue>,
  };
}

function unconfiguredOptions(entry: IRegistryEntry): IOptionState {
  return {
    configured: {},
    defaults: entry.optionSchema ? defaultOptionsFor(entry.optionSchema) : null,
    effective: {},
  };
}

function isCategory(tag: string): tag is RuleCategory {
  return RULE_CATEGORIES.includes(tag as RuleCategory);
}

function validateRuleTags(
  id: string,
  tags: readonly string[],
  scope: RuleScope,
  definitions: IConfigV2["tags"],
): string[] {
  for (const tag of tags) {
    const definition = definitions[tag];
    if (!definition && !isCategory(tag)) {
      throw new ConfigError(`rules.${id}.tags`, `tag '${tag}' is not defined in tags`);
    }
    if (definition?.requiresScope && !definition.requiresScope.includes(scope)) {
      throw new ConfigError(
        `rules.${id}.tags.${tag}`,
        `tag '${tag}' requires a scope in ${definition.requiresScope.join("|")}`,
      );
    }
  }
  return [...tags];
}

function sourcesFor(setting: ISetting | undefined): IRuleSources {
  const fields: Record<string, RuleOrigin> = {
    level: "default",
    options: "default",
    scope: "default",
    docs: "default",
    limits: "default",
    tags: "default",
  };
  if (!setting) return { fields };
  const origin = setting.origin;
  if (origin.startsWith("preset:")) {
    return {
      fields: {
        level: origin,
        options: "default",
        scope: "default",
        docs: "default",
        limits: "default",
        tags: "default",
      },
    };
  }
  fields.level = origin;
  fields.options = setting.optionsSupplied ? origin : "default";
  fields.scope = setting.scope !== null ? origin : "default";
  fields.docs = setting.docs !== null ? origin : "default";
  fields.limits = setting.limits !== null ? origin : "default";
  fields.tags = setting.tags !== null ? origin : "default";
  if (setting.include) fields.include = origin;
  if (setting.exclude) fields.exclude = origin;
  return { fields };
}

function resolveRule(
  id: string,
  entry: IRegistryEntry,
  setting: ISetting | undefined,
  config: IConfigV2,
): IResolvedRule {
  const configured = setting !== undefined;
  const level = setting?.level ?? OFF;
  const options = setting ? configuredOptions(entry, id, setting) : unconfiguredOptions(entry);
  const scope = entry.controls.fixedScope ?? setting?.scope ?? DEFAULT_SCOPE;
  const include = entry.controls.fixedInclude ?? setting?.include ?? null;
  const exclude = entry.controls.fixedExclude ?? setting?.exclude ?? null;
  const optIn = setting?.optIn ?? true;
  const reason = setting === undefined ? NOT_ENABLED_REASON : setting.reason;
  const docs = setting?.docs ?? (entry.engineOwned ? `${config.docsBase}${entry.meta.docs}` : entry.meta.docs);
  const limits = setting?.limits ?? entry.meta.limits;
  const meta = limits === entry.meta.limits ? entry.meta : { ...entry.meta, limits };
  const tags = validateRuleTags(id, setting?.tags ?? [entry.meta.category], scope, config.tags);
  return {
    id,
    engine: entry.engine,
    meta,
    configuredLevel: level,
    effectiveLevel: level,
    configuredOptions: options.configured,
    defaultOptions: options.defaults,
    effectiveOptions: configured ? options.effective : null,
    scope,
    include,
    exclude,
    optIn,
    reason,
    exclusionCodes: setting?.exclusionCodes ?? null,
    docs,
    tags,
    defaultLimits: entry.meta.limits,
    controls: entry.controls,
    command: entry.command,
    sources: sourcesFor(setting),
  };
}

function catalogRule(entry: IRegistryEntry, resolved: IResolvedRule): ICatalogRule {
  const options = resolved.effectiveOptions ?? resolved.defaultOptions;
  const exclusionCodes = resolved.exclusionCodes;
  return {
    engine: entry.engine === PLUGIN_ENGINE ? "plugin" : "script",
    severity: resolved.configuredLevel,
    scope: resolved.scope,
    ...(resolved.include ? { include: [...resolved.include] } : {}),
    ...(resolved.exclude ? { exclude: [...resolved.exclude] } : {}),
    codeStyle: resolved.docs,
    ...(resolved.optIn ? { optIn: true } : {}),
    ...(resolved.reason ? { reason: resolved.reason } : {}),
    ...(options && Object.keys(options).length > 0 ? { options } : {}),
    ...(entry.engineOwned || !exclusionCodes ? {} : { exclusionCodes: { ...exclusionCodes } }),
    tags: [...resolved.tags],
    ...(resolved.meta.limits === null ? {} : { limits: resolved.meta.limits }),
  };
}

function buildVocabulary(
  rules: Record<string, ICatalogRule>,
  definitions: IConfigV2["tags"],
): ICatalog["tagVocabulary"] {
  const used = new Set(Object.values(rules).flatMap((rule) => rule.tags));
  const vocabulary: ICatalog["tagVocabulary"] = {};
  for (const tag of used) {
    const definition = definitions[tag];
    if (definition) {
      vocabulary[tag] = {
        description: definition.description,
        ...(definition.requiresScope ? { requiresScope: definition.requiresScope } : {}),
      };
    } else if (isCategory(tag)) {
      vocabulary[tag] = { description: CATEGORY_DESCRIPTIONS[tag] };
    }
  }
  return vocabulary;
}

function rawObject(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;
}

/** Rejects `__proto__` in raw rule options before Zod rebuilds the object and hides the own key. */
function rejectPrototypeOptions(input: JsonValue): void {
  const rules = rawObject(rawObject(input)?.rules);
  if (!rules) return;
  for (const [id, setting] of Object.entries(rules)) {
    const options = Array.isArray(setting) ? setting[1] : rawObject(setting)?.options;
    const optionRecord = rawObject(options);
    if (optionRecord && Object.hasOwn(optionRecord, "__proto__")) {
      throw new ConfigError(`rules.${id}.options.__proto__`, "the option name '__proto__' is not allowed");
    }
  }
}

/** Compiles a version 2 configuration against a descriptor. It is pure: no filesystem and no plugin instantiation. */
export function compileConfig(input: JsonValue, descriptor: IProjectDescriptor): ICompiledConfig {
  rejectPrototypeOptions(input);
  const config = parseConfig(input);
  if (config.plugin !== descriptor.pluginName) {
    throw new ConfigError("plugin", `the project plugin name is '${descriptor.pluginName}'`);
  }
  const index = buildRegistryIndex(descriptor);
  const settings = collectSettings(config, index);
  const rules: Record<string, IResolvedRule> = {};
  const catalogRules: Record<string, ICatalogRule> = {};
  const wholeTree: Record<string, Record<string, JsonValue>> = {};
  for (const [id, entry] of index) {
    const setting = settings.get(id);
    const resolved = resolveRule(id, entry, setting, config);
    rules[id] = resolved;
    if (entry.engine === PLUGIN_ENGINE) {
      catalogRules[id] = catalogRule(entry, resolved);
      continue;
    }
    if (!setting) continue;
    if (entry.engine === SCRIPT_ENGINE) {
      catalogRules[id] = catalogRule(entry, resolved);
      continue;
    }
    const section = WHOLE_TREE_SECTIONS[id];
    if (section) {
      wholeTree[section] = resolved.effectiveOptions ?? resolved.defaultOptions ?? {};
    } else {
      catalogRules[id] = catalogRule(entry, resolved);
    }
  }
  const selectorRules = selectorSource(rules);
  for (const [name, tokens] of Object.entries(config.profiles)) {
    for (const [index, token] of tokens.entries()) {
      try {
        resolveSelectorTokens(selectorRules, token);
      } catch (error) {
        if (error instanceof SelectorError) {
          throw new ConfigError(`profiles.${name}.${index}`, error.message);
        }
        throw error;
      }
    }
  }
  const catalog: ICatalog = {
    version: "1",
    scopes: { test: [...config.paths.test], fixture: [...config.paths.fixture] },
    ...(config.paths.ignore.length > 0
      ? { ignore: config.paths.ignore.map(({ glob, reason }) => ({ glob, reason })) }
      : {}),
    ...(Object.keys(wholeTree).length > 0 ? { wholeTree } : {}),
    tagVocabulary: buildVocabulary(catalogRules, config.tags),
    rules: catalogRules,
  };
  return { catalog, rules };
}
