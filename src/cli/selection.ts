/**
 * @module CliSelection
 * @path src/cli/selection.ts
 * @description Resolves selector tokens and profiles against the compiled rules, and derives each rule's status.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/engine/plugin.ts, src/cli/rules_read.ts, src/config/descriptor.ts]
 */

import type { RuleSeverity } from "../engine/catalog.ts";
import { selectionEnvName } from "../engine/rule_gate.ts";
import type { ICompiledConfig, IResolvedRule } from "../config/descriptor.ts";
import type { IConfigV2 } from "../config/schema.ts";
import {
  type IResolvedSelection,
  resolveRuleId as resolveId,
  resolveSelectorTokens,
  SelectorError,
  selectorSource,
} from "../config/selectors.ts";
import { CliError, USAGE_EXIT } from "./error.ts";

/** The status of a resolved rule for the current selection. */
export type RuleStatus = "active" | "parked" | "off" | "not-selected";

/** Every status a `--status` filter accepts. */
export const RULE_STATUSES: readonly RuleStatus[] = ["active", "parked", "off", "not-selected"];

const EFFECTIVE_ERROR: RuleSeverity = "error";

/** Resolves a full id or an unambiguous bare key to a rule id, as a usage error on failure. */
export function resolveRuleId(compiled: ICompiledConfig, token: string): string {
  try {
    return resolveId(Object.keys(compiled.rules), token);
  } catch (error) {
    if (error instanceof SelectorError) throw new CliError(USAGE_EXIT, error.message);
    throw error;
  }
}

function readSelectionVariable(pluginName: string): string {
  try {
    return Deno.env.get(selectionEnvName(pluginName)) ?? "";
  } catch {
    return "";
  }
}

/** Resolves `--select`, `--profile`, or the inherited selection variable. CLI flags replace the variable. */
export function resolveSelection(
  compiled: ICompiledConfig,
  config: IConfigV2,
  pluginName: string,
  select: string | null,
  profile: string | null,
): IResolvedSelection | null {
  if (select !== null && profile !== null) {
    throw new CliError(USAGE_EXIT, "--select and --profile cannot be combined.");
  }
  let tokens: string;
  if (profile !== null) {
    const selectors = config.profiles[profile];
    if (!selectors) throw new CliError(USAGE_EXIT, `unknown profile '${profile}'`);
    tokens = selectors.join(",");
  } else if (select !== null) {
    tokens = select;
  } else {
    tokens = readSelectionVariable(pluginName);
  }
  if (tokens.trim() === "") return null;
  try {
    return resolveSelectorTokens(selectorSource(compiled.rules), tokens);
  } catch (error) {
    if (error instanceof SelectorError) throw new CliError(USAGE_EXIT, error.message);
    throw error;
  }
}

/** True when the selection includes the rule by id or tag. */
export function isSelected(selection: IResolvedSelection, rule: IResolvedRule): boolean {
  return selection.ids.has(rule.id) || rule.tags.some((tag) => selection.tags.has(tag));
}

/** The status of a rule: a selected parked plugin rule becomes active. Host-controlled checks stay off. */
export function ruleStatus(rule: IResolvedRule, selection: IResolvedSelection | null): RuleStatus {
  const off = rule.configuredLevel === "off";
  if (rule.engine !== "plugin") return off ? "off" : "active";
  if (selection === null) return off ? (rule.optIn ? "parked" : "off") : "active";
  if (!isSelected(selection, rule)) return "not-selected";
  if (!off) return "active";
  return rule.optIn ? "active" : "off";
}

/** The severity the host reports: a selected parked plugin rule is an error, as `deno lint` reports it. */
export function ruleEffectiveLevel(rule: IResolvedRule, status: RuleStatus): RuleSeverity {
  if (rule.engine === "plugin" && status === "active" && rule.configuredLevel === "off") return EFFECTIVE_ERROR;
  return rule.configuredLevel;
}
