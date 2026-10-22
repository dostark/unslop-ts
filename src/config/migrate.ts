/**
 * @module ConfigMigrate
 * @path src/config/migrate.ts
 * @description Maps a version 1 catalog to a version 2 configuration, splits layout, and projects both for semantic comparison.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/config/compile.ts, src/config/descriptor.ts, src/rules/whole_tree/checks.ts]
 */

import type { z } from "zod";
import {
  CatalogError,
  type ICatalog,
  type JsonValue,
  parseCatalog,
  type RuleScope,
  type RuleSeverity,
} from "../engine/catalog.ts";
import { createRuleRegistry } from "../engine/registry.ts";
import { CATEGORY_DESCRIPTIONS, RULE_CATEGORIES, type RuleCategory } from "../rules/meta.ts";
import type { IRuleMeta, RuleEngine } from "../rules/meta.ts";
import { WHOLE_TREE_CHECKS } from "../rules/whole_tree/checks.ts";
import { type IWholeTreeSettings, parseWholeTreeSettings } from "../rules/whole_tree/options.ts";
import type { ICompiledConfig, IProjectDescriptor, IRuleControls } from "./descriptor.ts";
import { hostBaseLevel, PLUGIN_RULE_CONTROLS } from "./descriptor.ts";
import { ConfigError } from "./schema.ts";

/** The four whole-tree checks that a version 2 configuration enables through rule entries. */
const SETTINGS_CHECKS = [
  { id: "magic-literals", section: "magicLiterals" },
  { id: "constant-restatement", section: "constantRestatement" },
  { id: "unused-exports", section: "unusedExports" },
  { id: "optional-params", section: "optionalParams" },
] as const;

type SettingsCheckId = (typeof SETTINGS_CHECKS)[number]["id"];

/** A migrated configuration and the layout that moves out of it. */
export interface IMigrationResult {
  readonly config: JsonValue;
  readonly layout: JsonValue | null;
}

/** One original rule as a comparison projection. */
export interface IRuleProjection {
  readonly severity: RuleSeverity;
  readonly scope: RuleScope;
  readonly include: readonly string[] | null;
  readonly exclude: readonly string[] | null;
  readonly optIn: boolean;
  readonly reason: string | null;
  readonly tags: readonly string[];
  readonly exclusionCodes: Readonly<Record<string, string>> | null;
  readonly options: Record<string, JsonValue>;
  readonly docs: string;
  readonly limits: string | null;
}

/** The comparable projection of a catalog: rules, paths, tags, and whole-tree settings. */
export interface ICatalogProjection {
  readonly scopes: { readonly test: readonly string[]; readonly fixture: readonly string[] };
  readonly ignore: readonly { readonly glob: string; readonly reason: string }[];
  readonly rules: Readonly<Record<string, IRuleProjection>>;
  readonly tags: Readonly<
    Record<string, { readonly description: string; readonly requiresScope?: readonly RuleScope[] }>
  >;
  readonly wholeTree: IWholeTreeSettings;
}

interface IOwner {
  readonly engine: RuleEngine;
  readonly meta: IRuleMeta;
  readonly optionSchema: z.ZodTypeAny | null;
  readonly controls: IRuleControls;
  readonly engineOwned: boolean;
}

function ownersFor(descriptor: IProjectDescriptor): ReadonlyMap<string, IOwner> {
  const owners = new Map<string, IOwner>();
  for (const pack of descriptor.packs) {
    for (const [key, rule] of Object.entries(pack.rules)) {
      owners.set(`${descriptor.pluginName}/${key}`, {
        engine: "plugin",
        meta: rule.meta,
        optionSchema: pack.optionSchemas[key] ?? null,
        controls: PLUGIN_RULE_CONTROLS,
        engineOwned: true,
      });
    }
  }
  for (const [id, check] of Object.entries(WHOLE_TREE_CHECKS)) {
    owners.set(id, {
      engine: "whole-tree",
      meta: check.meta,
      optionSchema: check.optionSchema,
      controls: descriptor.wholeTreeHosts[id]?.controls ?? check.controls,
      engineOwned: true,
    });
  }
  for (const [id, spec] of Object.entries(descriptor.scriptRules)) {
    owners.set(id, {
      engine: "script",
      meta: spec.meta,
      optionSchema: spec.optionSchema,
      controls: spec.controls,
      engineOwned: false,
    });
  }
  return owners;
}

function isCategory(tag: string): tag is RuleCategory {
  return RULE_CATEGORIES.includes(tag as RuleCategory);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function registryFor(descriptor: IProjectDescriptor) {
  return createRuleRegistry(descriptor.pluginName, descriptor.packs);
}

function scriptSchemasFor(descriptor: IProjectDescriptor): Record<string, z.ZodTypeAny> {
  const schemas: Record<string, z.ZodTypeAny> = {};
  for (const [id, spec] of Object.entries(descriptor.scriptRules)) {
    if (spec.optionSchema) schemas[id] = spec.optionSchema;
  }
  return schemas;
}

function readV1(v1: JsonValue, descriptor: IProjectDescriptor): ICatalog {
  try {
    return parseCatalog(v1, { registry: registryFor(descriptor), scriptRuleSchemas: scriptSchemasFor(descriptor) });
  } catch (error) {
    if (error instanceof CatalogError) throw new ConfigError(error.path, error.message);
    if (error instanceof Error) throw new ConfigError("catalog", error.message);
    throw error;
  }
}

function readSettings(v1: JsonValue): IWholeTreeSettings {
  try {
    return parseWholeTreeSettings(v1);
  } catch (error) {
    if (error instanceof CatalogError) throw new ConfigError(error.path, error.message);
    throw error;
  }
}

function docsBaseFor(
  catalog: ICatalog,
  owners: ReadonlyMap<string, IOwner>,
): string {
  const counts = new Map<string, number>();
  for (const [id, entry] of Object.entries(catalog.rules)) {
    const owner = owners.get(id);
    if (!owner || !owner.engineOwned || entry.codeStyle === undefined) continue;
    const anchor = owner.meta.docs;
    if (!entry.codeStyle.endsWith(anchor)) continue;
    const base = entry.codeStyle.slice(0, entry.codeStyle.length - anchor.length);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [base, count] of counts) {
    if (count > bestCount || (count === bestCount && base.length < best.length)) {
      best = base;
      bestCount = count;
    }
  }
  return best;
}

function effectiveOptions(
  id: string,
  entry: ICatalog["rules"][string],
  owner: IOwner,
): Record<string, JsonValue> {
  if (!owner.optionSchema) return (entry.options ?? {}) as Record<string, JsonValue>;
  const parsed = owner.optionSchema.safeParse(entry.options ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.map(String).join(".") ?? "";
    throw new ConfigError(
      `rules.${id}.options${field ? `.${field}` : ""}`,
      issue?.message ?? "invalid options",
    );
  }
  return parsed.data as Record<string, JsonValue>;
}

function settingFor(
  id: string,
  entry: ICatalog["rules"][string],
  owner: IOwner,
  docsBase: string,
): Record<string, JsonValue> {
  const controls = owner.controls;
  const base = hostBaseLevel(controls);
  if (!controls.editable.includes("level") && entry.severity !== base) {
    throw new ConfigError(`rules.${id}.level`, `the ${owner.engine} host fixes the level at '${base}'`);
  }
  const fixedScope = controls.fixedScope ?? "all";
  if (!controls.editable.includes("scope") && entry.scope !== fixedScope) {
    throw new ConfigError(`rules.${id}.scope`, `the ${owner.engine} host fixes the scope at '${fixedScope}'`);
  }
  if (!controls.editable.includes("include") && !sameList(entry.include ?? [], controls.fixedInclude ?? [])) {
    throw new ConfigError(`rules.${id}.include`, `the ${owner.engine} host fixes the include list`);
  }
  if (!controls.editable.includes("exclude") && !sameList(entry.exclude ?? [], controls.fixedExclude ?? [])) {
    throw new ConfigError(`rules.${id}.exclude`, `the ${owner.engine} host fixes the exclude list`);
  }
  if (entry.options && Object.keys(entry.options).length > 0 && !controls.editable.includes("options")) {
    throw new ConfigError(`rules.${id}.options`, `the ${owner.engine} host does not read options`);
  }

  const setting: Record<string, JsonValue> = { level: entry.severity };
  if (entry.options && Object.keys(entry.options).length > 0) {
    setting.options = entry.options as Record<string, JsonValue>;
  }
  if (entry.scope !== "all" && controls.editable.includes("scope")) setting.scope = entry.scope;
  if (entry.include && controls.editable.includes("include")) setting.include = entry.include;
  if (entry.exclude && controls.editable.includes("exclude")) setting.exclude = entry.exclude;
  if (entry.optIn === true) setting.optIn = true;
  if (entry.reason !== undefined) setting.reason = entry.reason;
  const defaultDocs = owner.engineOwned ? `${docsBase}${owner.meta.docs}` : owner.meta.docs;
  if (entry.codeStyle !== undefined && entry.codeStyle !== defaultDocs) setting.docs = entry.codeStyle;
  if (entry.limits !== undefined && entry.limits !== owner.meta.limits) setting.limits = entry.limits;
  if (!sameList(entry.tags, [owner.meta.category])) setting.tags = entry.tags;
  if (entry.exclusionCodes !== undefined) {
    if (owner.engine !== "script") {
      throw new ConfigError(`rules.${id}.exclusionCodes`, "exclusion codes are consumer-only");
    }
    setting.exclusionCodes = entry.exclusionCodes;
  }
  return setting;
}

function tagDefinitions(catalog: ICatalog): Record<string, JsonValue> {
  const used = new Set(Object.values(catalog.rules).flatMap((entry) => entry.tags));
  const definitions: Record<string, JsonValue> = {};
  for (const tag of used) {
    const definition = catalog.tagVocabulary[tag];
    if (!definition) continue;
    const defaultDescription = isCategory(tag) ? CATEGORY_DESCRIPTIONS[tag] : null;
    if (defaultDescription === definition.description && definition.requiresScope === undefined) continue;
    definitions[tag] = {
      description: definition.description,
      ...(definition.requiresScope ? { requiresScope: definition.requiresScope } : {}),
    };
  }
  return definitions;
}

/** Maps a version 1 catalog to a version 2 configuration and returns the layout separately. */
export function migrateCatalog(v1: JsonValue, descriptor: IProjectDescriptor): IMigrationResult {
  const catalog = readV1(v1, descriptor);
  const wholeTree = readSettings(v1);
  const owners = ownersFor(descriptor);
  const docsBase = docsBaseFor(catalog, owners);
  const rules: Record<string, JsonValue> = {};
  for (const [id, entry] of Object.entries(catalog.rules)) {
    const owner = owners.get(id);
    if (!owner) {
      throw new ConfigError(
        `rules.${id}`,
        "no engine rule, whole-tree check, or consumer script descriptor owns this id",
      );
    }
    rules[id] = settingFor(id, entry, owner, docsBase);
  }
  for (const check of SETTINGS_CHECKS) {
    const section = wholeTree[check.section];
    if (!section) continue;
    const owner = owners.get(check.id);
    if (!owner) throw new ConfigError(`rules.${check.id}`, "no whole-tree check descriptor owns this id");
    rules[check.id] = { level: hostBaseLevel(owner.controls), options: section as JsonValue };
  }

  const config: Record<string, JsonValue> = { version: 2, plugin: descriptor.pluginName };
  if (docsBase !== "") config.docsBase = docsBase;
  config.paths = {
    test: [...catalog.scopes.test],
    fixture: [...catalog.scopes.fixture],
    ignore: (catalog.ignore ?? []).map(({ glob, reason }) => ({ glob, reason })),
  };
  const tags = tagDefinitions(catalog);
  if (Object.keys(tags).length > 0) config.tags = tags;
  config.rules = rules;
  return { config, layout: catalog.layout ?? null };
}

function projectRule(
  id: string,
  entry: ICatalog["rules"][string] | undefined,
  owner: IOwner,
  docsBase: string,
  settings: Record<string, JsonValue> | undefined,
): IRuleProjection {
  if (entry) {
    const defaultDocs = owner.engineOwned ? `${docsBase}${owner.meta.docs}` : owner.meta.docs;
    return {
      severity: entry.severity,
      scope: entry.scope,
      include: entry.include ?? null,
      exclude: entry.exclude ?? null,
      optIn: entry.optIn === true,
      reason: entry.reason ?? null,
      tags: [...entry.tags],
      exclusionCodes: entry.exclusionCodes ?? null,
      options: effectiveOptions(id, entry, owner),
      docs: entry.codeStyle ?? defaultDocs,
      limits: entry.limits ?? owner.meta.limits,
    };
  }
  const defaults = owner.controls;
  return {
    severity: hostBaseLevel(defaults),
    scope: defaults.fixedScope ?? "all",
    include: defaults.fixedInclude,
    exclude: defaults.fixedExclude,
    optIn: false,
    reason: null,
    tags: [owner.meta.category],
    exclusionCodes: null,
    options: (settings ?? {}) as Record<string, JsonValue>,
    docs: `${docsBase}${owner.meta.docs}`,
    limits: owner.meta.limits,
  };
}

function usedTagDefinitions(
  catalog: ICatalog,
  originalIds?: readonly string[],
): ICatalogProjection["tags"] {
  const used = new Set<string>();
  for (const [id, entry] of Object.entries(catalog.rules)) {
    if (originalIds !== undefined && !originalIds.includes(id)) continue;
    for (const tag of entry.tags) used.add(tag);
  }
  const definitions: Record<string, { description: string; requiresScope?: readonly RuleScope[] }> = {};
  for (const tag of used) {
    const definition = catalog.tagVocabulary[tag];
    if (!definition) continue;
    definitions[tag] = {
      description: definition.description,
      ...(definition.requiresScope ? { requiresScope: definition.requiresScope } : {}),
    };
  }
  return definitions;
}

function projectScopes(catalog: ICatalog): ICatalogProjection["scopes"] {
  return { test: catalog.scopes.test, fixture: catalog.scopes.fixture };
}

/** Projects a version 1 catalog for equality checks against its compiled version 2 form. */
export function semanticCatalogProjection(
  v1: JsonValue,
  descriptor: IProjectDescriptor,
  originalIds: readonly string[],
): ICatalogProjection {
  const catalog = readV1(v1, descriptor);
  const wholeTree = readSettings(v1);
  const owners = ownersFor(descriptor);
  const docsBase = docsBaseFor(catalog, owners);
  const rules: Record<string, IRuleProjection> = {};
  for (const id of originalIds) {
    const owner = owners.get(id);
    if (!owner) throw new ConfigError(`rules.${id}`, "no descriptor owns this id");
    const settingsCheck = SETTINGS_CHECKS.find((check) => check.id === id);
    if (settingsCheck) {
      const section = wholeTree[settingsCheck.section];
      if (!section) throw new ConfigError(`rules.${id}`, "the version 1 catalog does not configure this check");
      rules[id] = projectRule(id, undefined, owner, docsBase, section as Record<string, JsonValue>);
      continue;
    }
    const entry = catalog.rules[id];
    if (!entry) throw new ConfigError(`rules.${id}`, "the version 1 catalog has no entry for this id");
    rules[id] = projectRule(id, entry, owner, docsBase, undefined);
  }
  return {
    scopes: projectScopes(catalog),
    ignore: (catalog.ignore ?? []).map(({ glob, reason }) => ({ glob, reason })),
    rules,
    tags: usedTagDefinitions(catalog),
    wholeTree,
  };
}

function compiledOptions(id: string, compiled: ICompiledConfig): Record<string, JsonValue> {
  const rule = compiled.rules[id];
  if (!rule) throw new ConfigError(`rules.${id}`, "the compiled model has no rule with this id");
  return rule.effectiveOptions ?? rule.defaultOptions ?? {};
}

/** Projects a compiled version 2 model in the same shape as the version 1 projection. */
export function semanticCompiledProjection(
  compiled: ICompiledConfig,
  descriptor: IProjectDescriptor,
  originalIds: readonly string[],
): ICatalogProjection {
  const owners = ownersFor(descriptor);
  const rules: Record<string, IRuleProjection> = {};
  for (const id of originalIds) {
    const owner = owners.get(id);
    const rule = compiled.rules[id];
    if (!owner || !rule) throw new ConfigError(`rules.${id}`, "the compiled model does not own this id");
    rules[id] = {
      severity: rule.configuredLevel,
      scope: rule.scope,
      include: rule.include,
      exclude: rule.exclude,
      optIn: rule.optIn,
      reason: rule.reason,
      tags: [...rule.tags],
      exclusionCodes: compiled.catalog.rules[id]?.exclusionCodes ?? null,
      options: compiledOptions(id, compiled),
      docs: rule.docs,
      limits: rule.meta.limits,
    };
  }
  return {
    scopes: projectScopes(compiled.catalog),
    ignore: (compiled.catalog.ignore ?? []).map(({ glob, reason }) => ({ glob, reason })),
    rules,
    tags: usedTagDefinitions(compiled.catalog, originalIds),
    wholeTree: parseWholeTreeSettings(compiled.catalog),
  };
}
