/**
 * @module CliSelection
 * @path src/cli/selection.ts
 * @description Resolves selector tokens and profiles against the compiled rules, and derives each rule's status.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/engine/plugin.ts, src/cli/rules_read.ts, src/config/descriptor.ts]
 */

import type { RuleSeverity } from "../engine/catalog.ts";
import { selectionEnvName } from "../engine/plugin.ts";
import type { ICompiledConfig, IResolvedRule } from "../config/descriptor.ts";
import type { IConfigV2 } from "../config/schema.ts";
import { CliError, USAGE_EXIT } from "./error.ts";

/** The status of a resolved rule for the current selection. */
export type RuleStatus = "active" | "parked" | "off" | "not-selected";

/** Every status a `--status` filter accepts. */
export const RULE_STATUSES: readonly RuleStatus[] = ["active", "parked", "off", "not-selected"];

/** The selected ids and tags. Null means no selection, so every configured rule keeps its own level. */
export interface IResolvedSelection {
  readonly ids: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
}

const TAG_PREFIX = "tag:";
const EFFECTIVE_ERROR: RuleSeverity = "error";

function ruleKey(id: string): string {
  const separator = id.lastIndexOf("/");
  return separator === -1 ? id : id.slice(separator + 1);
}

/** Resolves a full id or an unambiguous bare key to a rule id. */
export function resolveRuleId(compiled: ICompiledConfig, token: string): string {
  if (compiled.rules[token]) return token;
  if (token.includes("/")) throw new CliError(USAGE_EXIT, `unknown rule id '${token}'`);
  const matches = Object.keys(compiled.rules).filter((id) => ruleKey(id) === token);
  if (matches.length === 0) throw new CliError(USAGE_EXIT, `unknown rule '${token}'`);
  if (matches.length > 1) {
    throw new CliError(USAGE_EXIT, `ambiguous rule key '${token}': ${matches.sort().join(", ")}`);
  }
  return matches[0];
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
  select?: string,
  profile?: string,
): IResolvedSelection | null {
  if (select !== undefined && profile !== undefined) {
    throw new CliError(USAGE_EXIT, "--select and --profile cannot be combined.");
  }
  let tokens: string;
  if (profile !== undefined) {
    const selectors = config.profiles[profile];
    if (!selectors) throw new CliError(USAGE_EXIT, `unknown profile '${profile}'`);
    tokens = selectors.join(",");
  } else if (select !== undefined) {
    tokens = select;
  } else {
    tokens = readSelectionVariable(pluginName);
  }
  if (tokens.trim() === "") return null;
  const ids = new Set<string>();
  const tags = new Set<string>();
  for (const raw of tokens.split(",")) {
    const token = raw.trim();
    if (token === "") continue;
    if (token.startsWith(TAG_PREFIX)) {
      const tag = token.slice(TAG_PREFIX.length);
      if (!Object.values(compiled.rules).some((rule) => rule.tags.includes(tag))) {
        throw new CliError(USAGE_EXIT, `unknown tag '${tag}'`);
      }
      tags.add(tag);
      continue;
    }
    ids.add(resolveRuleId(compiled, token));
  }
  return { ids, tags };
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
