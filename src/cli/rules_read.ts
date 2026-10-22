/**
 * @module CliRulesRead
 * @path src/cli/rules_read.ts
 * @description `rules list` and `rules show`: the resolved model with status, controls, host modes, options, and sources.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/cli/selection.ts, src/config/descriptor.ts, src/rules/meta.ts]
 */

import type { JsonValue, RuleScope, RuleSeverity } from "../engine/catalog.ts";
import type {
  ICompiledConfig,
  IProjectDescriptor,
  IResolvedRule,
  IRuleControls,
  IRuleSources,
} from "../config/descriptor.ts";
import type { IRuleMeta, RuleCategory } from "../rules/meta.ts";
import { RULE_CATEGORIES } from "../rules/meta.ts";
import { CliError, USAGE_EXIT } from "./error.ts";
import { jsonText, type OutputFormat, tableText } from "./output.ts";
import { resolveHostCommand } from "../report/commands.ts";
import {
  type IResolvedSelection,
  resolveRuleId,
  RULE_STATUSES,
  ruleEffectiveLevel,
  type RuleStatus,
  ruleStatus,
} from "./selection.ts";

/** Options shared by both read commands. */
export interface IRuleQuery {
  readonly format: OutputFormat;
  readonly category?: string;
  readonly status?: string;
  readonly selection: IResolvedSelection | null;
  readonly descriptor: IProjectDescriptor;
}

const TABLE_HEADERS = ["ID", "STATUS", "LEVEL", "CATEGORY", "CONTROLS", "HOST"] as const;
const NO_VALUE = "-";
const COMPACT_SEPARATOR = ", ";

interface IRuleBase {
  readonly id: string;
  readonly engine: IResolvedRule["engine"];
  readonly status: RuleStatus;
  readonly category: RuleCategory;
  readonly preset: IRuleMeta["preset"];
  readonly description: string;
  readonly configuredLevel: RuleSeverity;
  readonly effectiveLevel: RuleSeverity;
  readonly scope: RuleScope;
  readonly include: readonly string[] | null;
  readonly exclude: readonly string[] | null;
  readonly controls: IRuleControls;
  readonly command: readonly string[] | null;
  readonly docs: string;
  readonly tags: readonly string[];
  readonly exclusionCodes: Readonly<Record<string, string>> | null;
}

function hostModesText(controls: IRuleControls): string {
  return Object.entries(controls.hostModes).map(([mode, level]) => `${mode}=${level}`).join(COMPACT_SEPARATOR);
}

function validateCategory(category: string | undefined): void {
  if (category !== undefined && !RULE_CATEGORIES.includes(category as RuleCategory)) {
    throw new CliError(USAGE_EXIT, `unknown category '${category}'`);
  }
}

function validateStatus(status: string | undefined): void {
  if (status !== undefined && !RULE_STATUSES.includes(status as RuleStatus)) {
    throw new CliError(USAGE_EXIT, `unknown status '${status}'`);
  }
}

function baseView(
  rule: IResolvedRule,
  selection: IResolvedSelection | null,
  descriptor: IProjectDescriptor,
): IRuleBase {
  const status = ruleStatus(rule, selection);
  return {
    id: rule.id,
    engine: rule.engine,
    status,
    category: rule.meta.category,
    preset: rule.meta.preset,
    description: rule.meta.description,
    configuredLevel: rule.configuredLevel,
    effectiveLevel: ruleEffectiveLevel(rule, status),
    scope: rule.scope,
    include: rule.include,
    exclude: rule.exclude,
    controls: rule.controls,
    command: resolveHostCommand(rule.command, descriptor),
    docs: rule.docs,
    tags: rule.tags,
    exclusionCodes: rule.exclusionCodes,
  };
}

function selectedViews(compiled: ICompiledConfig, query: IRuleQuery): IRuleBase[] {
  validateCategory(query.category);
  validateStatus(query.status);
  return Object.values(compiled.rules)
    .map((rule) => baseView(rule, query.selection, query.descriptor))
    .filter((view) => query.category === undefined || view.category === query.category)
    .filter((view) => query.status === undefined || view.status === query.status)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** `rules list`: every resolved rule with its status, level, category, controls, and host modes. */
export function listRules(compiled: ICompiledConfig, query: IRuleQuery): string {
  const views = selectedViews(compiled, query);
  if (query.format === "json") return jsonText({ rules: views });
  const rows = views.map((view) => [
    view.id,
    view.status,
    view.effectiveLevel,
    view.category,
    view.controls.editable.join(COMPACT_SEPARATOR),
    hostModesText(view.controls),
  ]);
  return tableText(TABLE_HEADERS, rows);
}

function optionsText(options: Record<string, JsonValue> | null): string {
  return options === null ? "null" : JSON.stringify(options);
}

function sourcesText(sources: IRuleSources): string {
  return Object.entries(sources.fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, origin]) => `${field}=${origin}`)
    .join(COMPACT_SEPARATOR);
}

function showTable(rule: IResolvedRule, view: IRuleBase): string {
  const lines = [
    `id: ${view.id}`,
    `status: ${view.status}`,
    `engine: ${view.engine}`,
    `level: ${view.configuredLevel} (effective ${view.effectiveLevel})`,
    `scope: ${view.scope}`,
    `category: ${view.category}`,
    `preset: ${view.preset}`,
    `description: ${view.description}`,
    `docs: ${view.docs}`,
    `tags: ${view.tags.join(COMPACT_SEPARATOR)}`,
    `controls: ${view.controls.editable.join(COMPACT_SEPARATOR)}`,
    `host modes: ${hostModesText(view.controls)}`,
    `command: ${view.command === null ? NO_VALUE : view.command.join(" ")}`,
    `configured options: ${optionsText(rule.configuredOptions)}`,
    `default options: ${optionsText(rule.defaultOptions)}`,
    `effective options: ${optionsText(rule.effectiveOptions)}`,
    `exclusion codes: ${view.exclusionCodes === null ? NO_VALUE : JSON.stringify(view.exclusionCodes)}`,
    `sources: ${sourcesText(rule.sources)}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** `rules show <id>`: the full resolved rule, including options and per-field sources. */
export function showRule(compiled: ICompiledConfig, query: IRuleQuery, token: string): string {
  const id = resolveRuleId(compiled, token);
  const rule = compiled.rules[id];
  const view = baseView(rule, query.selection, query.descriptor);
  if (query.format === "table") return showTable(rule, view);
  return jsonText({
    rule: {
      ...view,
      meta: rule.meta,
      optIn: rule.optIn,
      reason: rule.reason,
      configuredOptions: rule.configuredOptions,
      defaultOptions: rule.defaultOptions,
      effectiveOptions: rule.effectiveOptions,
      sources: rule.sources,
    },
  });
}
