/**
 * @module ConfigEdit
 * @path src/config/edit.ts
 * @description Pure targeted edits: materialize inherited effective fields, change one setting, and return the shortest equivalent form.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/config/compile.ts, src/config/descriptor.ts, src/cli/commands/rules_write.ts]
 */

import type { JsonValue, RuleSeverity } from "../engine/catalog.ts";
import { compileConfig } from "./compile.ts";
import type { ICompiledConfig, IProjectDescriptor, IResolvedRule } from "./descriptor.ts";

const ALLOWED_LEVELS: readonly RuleSeverity[] = ["error", "warn"];
const OFF: RuleSeverity = "off";
const DEFAULT_SCOPE = "all";

/** A refused edit: a capability, selector, or option problem. The CLI maps it to exit 2. */
export class EditRefusalError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "EditRefusalError";
    this.path = path;
  }
}

/** The compiled project an edit validates against. */
export interface IEditContext {
  readonly descriptor: IProjectDescriptor;
  readonly compiled: ICompiledConfig;
}

interface IMaterialized {
  readonly level: RuleSeverity;
  readonly options: Readonly<Record<string, JsonValue>>;
  readonly optIn: boolean;
  readonly reason: string | null;
  readonly exclusionCodes: Readonly<Record<string, string>> | null;
}

function asObject(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;
}

function resolveRule(context: IEditContext, token: string): IResolvedRule {
  const exact = context.compiled.rules[token];
  if (exact) return exact;
  if (token.includes("/")) throw new EditRefusalError(`rules.${token}`, "unknown rule id");
  const matches = Object.keys(context.compiled.rules).filter((id) => {
    const separator = id.lastIndexOf("/");
    return (separator === -1 ? id : id.slice(separator + 1)) === token;
  });
  if (matches.length === 0) throw new EditRefusalError(`rules.${token}`, "unknown rule");
  if (matches.length > 1) {
    throw new EditRefusalError(`rules.${token}`, `ambiguous rule key: ${matches.sort().join(", ")}`);
  }
  return context.compiled.rules[matches[0]];
}

function assertEditable(rule: IResolvedRule, control: "level" | "scope" | "include" | "exclude" | "options"): void {
  if (!rule.controls.editable.includes(control)) {
    throw new EditRefusalError(
      `rules.${rule.id}.${control}`,
      `the ${rule.engine} host does not allow editing ${control}`,
    );
  }
}

function defaultDocs(rule: IResolvedRule): string | null {
  if (rule.engine === "script") return rule.docs === rule.meta.docs ? rule.docs : null;
  return rule.docs.endsWith(rule.meta.docs) ? rule.docs : null;
}

function defaultTags(rule: IResolvedRule): readonly string[] {
  return [rule.meta.category];
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function optionOverrides(
  options: Readonly<Record<string, JsonValue>>,
  defaults: Readonly<Record<string, JsonValue>> | null,
): Record<string, JsonValue> {
  if (defaults === null) return { ...options };
  const overrides: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(options)) {
    if (JSON.stringify(defaults[key]) !== JSON.stringify(value)) overrides[key] = value;
  }
  return overrides;
}

function materialize(rule: IResolvedRule, state: IMaterialized): Record<string, JsonValue> {
  const setting: Record<string, JsonValue> = { level: state.level };
  const overrides = optionOverrides(state.options, rule.defaultOptions);
  if (Object.keys(overrides).length > 0) setting.options = overrides;
  if (rule.controls.editable.includes("scope") && rule.scope !== DEFAULT_SCOPE) setting.scope = rule.scope;
  if (rule.controls.editable.includes("include") && rule.include) setting.include = [...rule.include];
  if (rule.controls.editable.includes("exclude") && rule.exclude) setting.exclude = [...rule.exclude];
  if (state.optIn) setting.optIn = true;
  if (state.reason !== null) setting.reason = state.reason;
  if (state.exclusionCodes !== null && Object.keys(state.exclusionCodes).length > 0) {
    setting.exclusionCodes = { ...state.exclusionCodes };
  }
  if (rule.docs !== defaultDocs(rule)) setting.docs = rule.docs;
  if (rule.meta.limits !== rule.defaultLimits) setting.limits = rule.meta.limits;
  if (!sameList(rule.tags, defaultTags(rule))) setting.tags = [...rule.tags];
  return setting;
}

/** True when two resolved rules carry the same effective and authored fields. */
export function effectiveEquals(left: IResolvedRule, right: IResolvedRule): boolean {
  return left.configuredLevel === right.configuredLevel &&
    left.effectiveLevel === right.effectiveLevel &&
    left.scope === right.scope &&
    sameNullableList(left.include, right.include) &&
    sameNullableList(left.exclude, right.exclude) &&
    left.optIn === right.optIn &&
    left.reason === right.reason &&
    JSON.stringify(left.exclusionCodes) === JSON.stringify(right.exclusionCodes) &&
    left.docs === right.docs &&
    left.meta.limits === right.meta.limits &&
    sameList(left.tags, right.tags) &&
    JSON.stringify(left.effectiveOptions) === JSON.stringify(right.effectiveOptions) &&
    JSON.stringify(left.defaultOptions) === JSON.stringify(right.defaultOptions);
}

function sameNullableList(left: readonly string[] | null, right: readonly string[] | null): boolean {
  if (left === null || right === null) return left === right;
  return sameList(left, right);
}

function withRule(config: JsonValue, id: string, setting: JsonValue): JsonValue {
  const root = structuredClone(config);
  const object = asObject(root);
  if (!object) throw new EditRefusalError("config", "the configuration root is not an object");
  const rules = asObject(object.rules) ?? {};
  rules[id] = setting;
  object.rules = rules;
  return object;
}

function compileCandidate(config: JsonValue, id: string, context: IEditContext): IResolvedRule {
  const compiled = compileConfig(config, context.descriptor);
  return compiled.rules[id];
}

/** Chooses the shortest form that compiles to the same effective rule. */
function finalize(
  config: JsonValue,
  id: string,
  setting: Record<string, JsonValue>,
  context: IEditContext,
): JsonValue {
  const withLongForm = withRule(config, id, setting);
  const expected = compileCandidate(withLongForm, id, context);
  const onlyLevel = Object.keys(setting).length === 1 && setting.level !== undefined;
  const levelAndOptions = Object.keys(setting).length === 2 && setting.level !== undefined &&
    setting.options !== undefined;
  const candidates: JsonValue[] = [];
  const optionsAreDefaults = setting.options === undefined ||
    JSON.stringify(setting.options) === JSON.stringify(expected.defaultOptions);
  if (onlyLevel || (levelAndOptions && optionsAreDefaults)) candidates.push(setting.level);
  if (levelAndOptions) candidates.push([setting.level, setting.options]);
  for (const candidate of candidates) {
    const next = withRule(config, id, candidate);
    try {
      if (effectiveEquals(compileCandidate(next, id, context), expected)) return next;
    } catch {
      continue;
    }
  }
  return withLongForm;
}

function baseState(rule: IResolvedRule): IMaterialized {
  return {
    level: rule.configuredLevel,
    options: rule.effectiveOptions ?? rule.defaultOptions ?? {},
    optIn: rule.optIn,
    reason: rule.reason,
    exclusionCodes: rule.exclusionCodes,
  };
}

/** Enables a rule at the requested level, clearing obsolete off fields and preserving other effective settings. */
export function enableRule(
  config: JsonValue,
  context: IEditContext,
  token: string,
  level: RuleSeverity = "error",
): JsonValue {
  const rule = resolveRule(context, token);
  assertEditable(rule, "level");
  if (!ALLOWED_LEVELS.includes(level)) {
    throw new EditRefusalError(`rules.${rule.id}.level`, "enable accepts 'error' or 'warn' only");
  }
  if (rule.engine === "plugin" && level === "warn") {
    throw new EditRefusalError(`rules.${rule.id}.level`, "plugin rules support only 'error'");
  }
  const state = baseState(rule);
  const wasOff = rule.configuredLevel === OFF;
  return finalize(
    config,
    rule.id,
    materialize(rule, {
      ...state,
      level,
      optIn: wasOff ? false : state.optIn,
      reason: wasOff ? null : state.reason,
    }),
    context,
  );
}

/** Disables a rule with a reason, optionally parking it for explicit selection. */
export function disableRule(
  config: JsonValue,
  context: IEditContext,
  token: string,
  reason: string,
  optIn: boolean,
): JsonValue {
  const rule = resolveRule(context, token);
  assertEditable(rule, "level");
  if (reason.trim() === "") throw new EditRefusalError(`rules.${rule.id}.reason`, "disable needs a reason");
  const state = baseState(rule);
  return finalize(config, rule.id, materialize(rule, { ...state, level: OFF, optIn, reason }), context);
}

/** Sets one option and preserves every other effective setting. */
export function setOption(
  config: JsonValue,
  context: IEditContext,
  token: string,
  option: string,
  value: JsonValue,
): JsonValue {
  const rule = resolveRule(context, token);
  assertEditable(rule, "options");
  const state = baseState(rule);
  const options = { ...state.options, [option]: value };
  return finalize(config, rule.id, materialize(rule, { ...state, options }), context);
}

/** Removes one option override so the engine default applies, or refuses when no default exists. */
export function unsetOption(
  config: JsonValue,
  context: IEditContext,
  token: string,
  option: string,
): JsonValue {
  const rule = resolveRule(context, token);
  assertEditable(rule, "options");
  const defaults = rule.defaultOptions;
  if (defaults === null || !(option in defaults)) {
    throw new EditRefusalError(
      `rules.${rule.id}.options.${option}`,
      "the option has no engine default; set an explicit value instead",
    );
  }
  const state = baseState(rule);
  const options = { ...state.options };
  delete options[option];
  return finalize(config, rule.id, materialize(rule, { ...state, options }), context);
}
