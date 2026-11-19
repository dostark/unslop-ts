/**
 * @module CheckCommand
 * @path src/cli/commands/check.ts
 * @description The `check` route: runs one configured whole-tree rule, or every active check, through the shared runner.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/cli/check_runner.ts, src/cli/selection.ts, src/cli/unslop.ts]
 *
 * Usage:
 *   deno run --allow-read --allow-env src/cli/unslop.ts check [--rule=<id>] [--format=text|json|sarif] [--strict]
 */

import { fromFileUrl } from "@std/path";
import { asJsonValue, type JsonValue, type RuleSeverity } from "../../engine/catalog.ts";
import { WHOLE_TREE_SECTIONS } from "../../config/compile.ts";
import type { ICompiledConfig, IProjectDescriptor, IResolvedRule } from "../../config/descriptor.ts";
import { type ICheckRunInput, type ICheckRunResult, runWholeTreeCheck } from "../check_runner.ts";
import { CliError, FAILURE_EXIT, USAGE_EXIT } from "../error.ts";
import { print, printError } from "../output.ts";
import { loadConfigDescriptor, readAndCompile, readConfigObject } from "../project_loader.ts";
import { resolveRuleId, resolveSelection, ruleEffectiveLevel, type RuleStatus, ruleStatus } from "../selection.ts";
import {
  type IResolvedSelection,
  resolveSelectorTokens,
  SelectorError,
  selectorSource,
} from "../../config/selectors.ts";

const TEXT_FORMAT = "text";
const JSON_FORMAT = "json";
const SARIF_FORMAT = "sarif";
const STRICT_FLAG = "strict";
const RULE_OPTION = "rule";
const FORMAT_OPTION = "format";
const DESCRIPTOR_OPTION = "descriptor";
const PLUGIN_OPTION = "plugin";
const CATALOG_OPTION = "catalog";
const SELECT_OPTION = "select";
const PROFILE_OPTION = "profile";
const CATEGORY_OPTION = "category";
const LEVEL_OPTION = "level";
const EXCLUDE_OPTION = "exclude";
const INCLUDE_PARKED_FLAG = "include-parked";
const SUMMARY_VERSION = 1;

/** The formats the route accepts. Only `import-cycles` writes SARIF in this phase. */
type TCheckFormat = typeof TEXT_FORMAT | typeof JSON_FORMAT | typeof SARIF_FORMAT;

const FORMATS: readonly string[] = [TEXT_FORMAT, JSON_FORMAT, SARIF_FORMAT];
const SARIF_RULES: ReadonlySet<string> = new Set(["import-cycles"]);
const JSON_RULES: ReadonlySet<string> = new Set(["import-cycles", "duplicate-code"]);
/** The checks that start a child runner, so the aggregate never runs them. */
const CHILD_RUNNER_RULES: ReadonlySet<string> = new Set(["duplicate-code"]);

/** Every flag a rule's runner consumes. `--format` is common to every route run. */
const CHECK_FLAGS: Readonly<Record<string, readonly string[]>> = {
  "constant-restatement": ["format"],
  "unused-exports": [
    "format",
    "fail",
    "parity",
    "all",
    "severity",
    "relaxed",
    "enum-members",
    "class-members",
    "production",
  ],
  "unused-files": ["format", "fail", "manifest", "conventions"],
  "optional-params": ["format", "fail", "staged", "include-tests", "verbose", "fix"],
  "duplicate-code": ["format", "verbose", "group", "top", "by", "min-lines", "max-gap-lines", "update-baseline"],
  "magic-literals": ["format", "include-tests"],
  "duplicate-type": ["format"],
  "duplicate-constant": ["format"],
  "import-cycles": [
    "format",
    "fail",
    "min-files",
    "include-self",
    "include-type-only",
    "trace",
    "top",
    "baseline",
    "update-baseline",
    "fail-on-new",
    "fail-on-stale",
  ],
};

/** The aggregate filters the command line asks for. */
interface ICheckFilters {
  readonly select: string | null;
  readonly profile: string | null;
  readonly category: string | null;
  readonly level: RuleSeverity | null;
  readonly exclude: readonly string[];
}

/** The filters resolved against the compiled rules. */
interface IResolvedFilters {
  readonly selection: IResolvedSelection | null;
  readonly category: string | null;
  readonly level: RuleSeverity | null;
  readonly excludedIds: ReadonlySet<string>;
  readonly excludedTags: ReadonlySet<string>;
}

/** One parsed check invocation: the route inputs, the filters and the flags the runner owns. */
interface IParsedCheck {
  readonly rule: string | null;
  readonly format: TCheckFormat;
  readonly descriptor: string | null;
  readonly plugin: string | null;
  readonly strict: boolean;
  readonly filters: ICheckFilters;
  readonly forwarded: readonly string[];
}

/** One rule's row in the aggregate report. */
interface ICheckRow {
  readonly id: string;
  readonly level: RuleSeverity;
  readonly ran: boolean;
  readonly passed: boolean;
  readonly findings: number;
  readonly summary: string;
  readonly report: JsonValue | null;
}

/** A run row plus the captured output that the text report shows on failure. */
interface ICheckOutcome {
  readonly row: ICheckRow;
  readonly stdout: string;
  readonly stderr: string;
  readonly hosted: boolean;
}

/** The aggregate JSON document. */
interface ICheckEnvelope {
  readonly version: number;
  readonly descriptor: string;
  readonly passed: boolean;
  readonly rules: readonly ICheckRow[];
}

function usage(message: string): never {
  throw new CliError(
    USAGE_EXIT,
    `${message}\nUsage: unslop check [--rule=<id>] [--format=text|json|sarif] [--strict] [--descriptor=<entry>] [--plugin=<entry>]`,
  );
}

function flagName(arg: string): string {
  const equals = arg.indexOf("=");
  return equals === -1 ? arg.slice(2) : arg.slice(2, equals);
}

function optionValue(arg: string): string {
  const equals = arg.indexOf("=");
  if (equals === -1 || equals === arg.length - 1) usage(`--${flagName(arg)} needs a value`);
  return arg.slice(equals + 1);
}

function parseFormat(value: string | undefined): TCheckFormat {
  if (value === undefined) return TEXT_FORMAT;
  if (!FORMATS.includes(value)) usage(`unknown format '${value}'`);
  return value as TCheckFormat;
}

function parseLevel(value: string | null): RuleSeverity | null {
  if (value === null) return null;
  if (value === "error" || value === "warn") return value;
  usage(`unknown level '${value}'; use error or warn`);
}

/** The mutable fields the argument loop fills. */
interface ICheckParseState {
  ruleToken: string | null;
  formatValue: string | undefined;
  descriptor: string | null;
  plugin: string | null;
  strict: boolean;
  select: string | null;
  profile: string | null;
  category: string | null;
  levelValue: string | null;
  exclude: string[];
  forwarded: string[];
}

function emptyParseState(): ICheckParseState {
  return {
    ruleToken: null,
    formatValue: undefined,
    descriptor: null,
    plugin: null,
    strict: false,
    select: null,
    profile: null,
    category: null,
    levelValue: null,
    exclude: [],
    forwarded: [],
  };
}

/** Handles a route or input flag; returns false when the argument belongs to a check. */
function applyRouteArg(state: ICheckParseState, arg: string): boolean {
  const name = flagName(arg);
  if (name === RULE_OPTION) state.ruleToken = optionValue(arg);
  else if (name === FORMAT_OPTION) state.formatValue = optionValue(arg);
  else if (name === DESCRIPTOR_OPTION) state.descriptor = optionValue(arg);
  else if (name === PLUGIN_OPTION) state.plugin = optionValue(arg);
  else if (name === CATALOG_OPTION) optionValue(arg);
  else if (name === STRICT_FLAG && !arg.includes("=")) state.strict = true;
  else return false;
  return true;
}

/** Handles an aggregate filter flag; returns false when the argument is another flag. */
function applyFilterArg(state: ICheckParseState, arg: string): boolean {
  const name = flagName(arg);
  if (name === SELECT_OPTION) state.select = optionValue(arg);
  else if (name === PROFILE_OPTION) state.profile = optionValue(arg);
  else if (name === CATEGORY_OPTION) state.category = optionValue(arg);
  else if (name === LEVEL_OPTION) state.levelValue = optionValue(arg);
  else if (name === EXCLUDE_OPTION) state.exclude.push(optionValue(arg));
  else if (name === INCLUDE_PARKED_FLAG) {
    usage("--include-parked is plugin-only; whole-tree rules have no parked state.");
  } else return false;
  return true;
}

function parseCheck(args: readonly string[]): IParsedCheck {
  const state = emptyParseState();
  for (const arg of args) {
    if (!arg.startsWith("--")) usage(`check takes no positional argument: '${arg}'`);
    if (applyRouteArg(state, arg)) continue;
    if (applyFilterArg(state, arg)) continue;
    state.forwarded.push(arg);
  }
  const filters = {
    select: state.select,
    profile: state.profile,
    category: state.category,
    level: parseLevel(state.levelValue),
    exclude: state.exclude,
  };
  const filtered = state.select !== null || state.profile !== null || state.category !== null ||
    state.levelValue !== null || state.exclude.length > 0;
  if (state.ruleToken !== null && filtered) usage("filters apply to the aggregate run, not to --rule.");
  if (state.ruleToken === null && state.forwarded.length > 0) usage("check flags need --rule=<id>");
  return {
    rule: state.ruleToken,
    format: parseFormat(state.formatValue),
    descriptor: state.descriptor,
    plugin: state.plugin,
    strict: state.strict,
    filters,
    forwarded: state.forwarded,
  };
}

function assertForwarded(rule: IResolvedRule, forwarded: readonly string[]): void {
  const allowed = CHECK_FLAGS[rule.id] ?? [];
  for (const arg of forwarded) {
    const name = flagName(arg);
    if (!allowed.includes(name)) usage(`rule '${rule.id}' does not accept --${name}`);
  }
}

function refuseHosted(rule: IResolvedRule): void {
  if (rule.engine === "plugin") usage(`rule '${rule.id}' is a plugin rule; run it with \`unslop report\`.`);
  if (rule.engine === "script") {
    const command = rule.command === null ? "its host command" : rule.command.join(" ");
    usage(`rule '${rule.id}' is hosted; run ${command}.`);
  }
}

function assertFormat(rule: IResolvedRule, format: TCheckFormat): void {
  if (format === SARIF_FORMAT && !SARIF_RULES.has(rule.id)) {
    usage(`rule '${rule.id}' does not produce SARIF.`);
  }
  if (format === JSON_FORMAT && !JSON_RULES.has(rule.id)) {
    usage(`rule '${rule.id}' does not produce JSON.`);
  }
}

/** Resolves a rule id and names near matches when the token is unknown. */
function resolveRule(compiled: ICompiledConfig, token: string): string {
  try {
    return resolveRuleId(compiled, token);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    const ids = Object.keys(compiled.rules);
    const word = (token.split("/").pop() ?? token).split("-")[0];
    const exact = ids.filter((id) => id.includes(token));
    const candidates = (exact.length > 0 ? exact : ids.filter((id) => id.includes(word))).slice(0, 5);
    usage(candidates.length === 0 ? error.message : `${error.message}; did you mean ${candidates.join(", ")}?`);
  }
}

/** A named `off` rule runs as a warning: naming it is an explicit override. */
function warnOffRule(rule: IResolvedRule, status: RuleStatus): void {
  if (status !== "off") return;
  printError(`warning: rule '${rule.id}' is off in this project; running it because it was named explicitly.\n`);
}

/** Resolves the selection, category, level and exclusions against the compiled rules. */
async function resolveFilters(
  filters: ICheckFilters,
  compiled: ICompiledConfig,
  descriptor: IProjectDescriptor,
): Promise<IResolvedFilters> {
  let selection: IResolvedSelection | null = null;
  if (filters.select !== null || filters.profile !== null) {
    const config = await readConfigObject(descriptor);
    selection = resolveSelection(compiled, config, descriptor.pluginName, filters.select, filters.profile);
  }
  if (filters.category !== null) {
    const categories = new Set<string>();
    for (const rule of Object.values(compiled.rules)) categories.add(rule.meta.category);
    if (!categories.has(filters.category)) {
      usage(`unknown category '${filters.category}'; known: ${[...categories].sort().join(", ")}`);
    }
  }
  let excludedIds: ReadonlySet<string> = new Set();
  let excludedTags: ReadonlySet<string> = new Set();
  if (filters.exclude.length > 0) {
    try {
      const excluded = resolveSelectorTokens(selectorSource(compiled.rules), filters.exclude.join(","));
      excludedIds = excluded.ids;
      excludedTags = excluded.tags;
    } catch (error) {
      if (error instanceof SelectorError) usage(error.message);
      throw error;
    }
  }
  return { selection, category: filters.category, level: filters.level, excludedIds, excludedTags };
}

function selectedBy(rule: IResolvedRule, selection: IResolvedSelection | null): boolean {
  if (selection === null) return true;
  return selection.ids.has(rule.id) || rule.tags.some((tag) => selection.tags.has(tag));
}

/** The composed filter: drop off rules, then selection, category, level and exclusions. */
function keepRule(rule: IResolvedRule, filters: IResolvedFilters): boolean {
  if (rule.configuredLevel === "off") return false;
  if (!selectedBy(rule, filters.selection)) return false;
  if (filters.category !== null && rule.meta.category !== filters.category) return false;
  if (filters.level !== null && levelOf(rule) !== filters.level) return false;
  if (filters.excludedIds.has(rule.id)) return false;
  return !rule.tags.some((tag) => filters.excludedTags.has(tag));
}

function exitCodeOf(level: RuleSeverity, passed: boolean, strict: boolean): number {
  if (passed) return 0;
  if (level === "error") return FAILURE_EXIT;
  return strict ? FAILURE_EXIT : 0;
}

function reportResult(result: ICheckRunResult): number {
  if (result.code === USAGE_EXIT) {
    printError(result.stderr);
    return USAGE_EXIT;
  }
  print(result.stdout);
  printError(result.stderr);
  return result.code;
}

/** True when the catalog carries the input a whole-tree check reads. */
function hasSettings(rule: IResolvedRule, compiled: ICompiledConfig): boolean {
  const section = WHOLE_TREE_SECTIONS[rule.id];
  if (section === undefined) return compiled.catalog.rules[rule.id] !== undefined;
  const wholeTree = compiled.catalog.wholeTree as Readonly<Record<string, JsonValue>> | undefined;
  return wholeTree?.[section] !== undefined;
}

function runInputOf(compiled: ICompiledConfig, descriptor: IProjectDescriptor): Omit<ICheckRunInput, "args"> {
  return {
    catalog: asJsonValue(compiled.catalog),
    rootPath: fromFileUrl(descriptor.rootUrl),
  };
}

/** The reason an active rule cannot run in the aggregate, or null when it can. */
function skipReasonOf(rule: IResolvedRule, compiled: ICompiledConfig): string | null {
  if (!hasSettings(rule, compiled)) return "no settings";
  if (CHILD_RUNNER_RULES.has(rule.id)) return "needs a child runner";
  return null;
}

function levelOf(rule: IResolvedRule): RuleSeverity {
  return ruleEffectiveLevel(rule, ruleStatus(rule, null));
}

function hostedRow(rule: IResolvedRule): ICheckRow {
  const command = rule.command === null ? "its host command" : rule.command.join(" ");
  return {
    id: rule.id,
    level: levelOf(rule),
    ran: false,
    passed: true,
    findings: 0,
    summary: `run ${command}`,
    report: null,
  };
}

function skippedRow(rule: IResolvedRule, reason: string): ICheckRow {
  return { id: rule.id, level: levelOf(rule), ran: false, passed: true, findings: 0, summary: reason, report: null };
}

async function runAggregateRule(
  rule: IResolvedRule,
  compiled: ICompiledConfig,
  descriptor: IProjectDescriptor,
  json: boolean,
): Promise<ICheckOutcome> {
  const args = json && JSON_RULES.has(rule.id) ? ["--format=json"] : [];
  const result = await runWholeTreeCheck(rule.id, { ...runInputOf(compiled, descriptor), args });
  if (result.code === USAGE_EXIT) {
    return {
      row: skippedRow(rule, "cannot run"),
      stdout: result.stdout,
      stderr: result.stderr,
      hosted: false,
    };
  }
  return {
    row: {
      id: rule.id,
      level: levelOf(rule),
      ran: true,
      passed: result.passed,
      findings: result.findings,
      summary: result.summary,
      report: result.json,
    },
    stdout: result.stdout,
    stderr: result.stderr,
    hosted: false,
  };
}

async function aggregateOutcomes(
  compiled: ICompiledConfig,
  descriptor: IProjectDescriptor,
  json: boolean,
  filters: IResolvedFilters,
): Promise<ICheckOutcome[]> {
  const active = Object.values(compiled.rules)
    .filter((rule) => ruleStatus(rule, null) === "active")
    .filter((rule) => rule.engine === "whole-tree" || rule.engine === "script")
    .filter((rule) => keepRule(rule, filters))
    .sort((left, right) => left.id.localeCompare(right.id));
  const outcomes: ICheckOutcome[] = [];
  for (const rule of active) {
    if (rule.engine === "script") {
      outcomes.push({ row: hostedRow(rule), stdout: "", stderr: "", hosted: true });
      continue;
    }
    const reason = skipReasonOf(rule, compiled);
    if (reason !== null) {
      outcomes.push({ row: skippedRow(rule, reason), stdout: "", stderr: "", hosted: false });
      continue;
    }
    outcomes.push(await runAggregateRule(rule, compiled, descriptor, json));
  }
  return outcomes;
}

function stateOf(outcome: ICheckOutcome): string {
  if (outcome.hosted) return "hosted";
  if (!outcome.row.ran) return "skipped";
  return outcome.row.passed ? "passed" : "failed";
}

function iconOf(row: ICheckRow): string {
  if (!row.ran) return "⏭️ ";
  return row.passed ? "✅" : "❌";
}

/** Prints one row per rule, the detail of each failure, and the summary line. */
function printAggregateText(outcomes: readonly ICheckOutcome[]): void {
  for (const outcome of outcomes) {
    const { row } = outcome;
    print(`${iconOf(row)} ${row.id} [${row.level}] ${stateOf(outcome)} — ${row.summary}\n`);
  }
  for (const { row, stdout, stderr } of outcomes) {
    if (!row.ran || row.passed) continue;
    print(`\n${row.id}:\n`);
    for (const line of `${stdout}${stderr}`.split("\n")) if (line !== "") print(`  ${line}\n`);
  }
  print(`\n${summaryLine(outcomes)}\n`);
}

function summaryLine(outcomes: readonly ICheckOutcome[]): string {
  const count = (state: string): number => outcomes.filter((outcome) => stateOf(outcome) === state).length;
  return `${count("passed")} passed · ${count("failed")} failed · ${count("skipped")} skipped · ${
    count("hosted")
  } hosted`;
}

function aggregateExitCode(outcomes: readonly ICheckOutcome[], strict: boolean): number {
  let errorFailed = false;
  let warnFailed = false;
  for (const { row } of outcomes) {
    if (!row.ran || row.passed) continue;
    if (row.level === "error") errorFailed = true;
    else warnFailed = true;
  }
  if (errorFailed) return FAILURE_EXIT;
  return warnFailed && strict ? FAILURE_EXIT : 0;
}

function printAggregateJson(outcomes: readonly ICheckOutcome[], descriptor: IProjectDescriptor): void {
  const rules = outcomes.map(({ row }) => row);
  const envelope: ICheckEnvelope = {
    version: SUMMARY_VERSION,
    descriptor: descriptor.pluginName,
    passed: rules.every((row) => row.passed),
    rules,
  };
  print(`${JSON.stringify(envelope, null, 2)}\n`);
}

/** Runs every active whole-tree check and reports the rows, or the JSON envelope. */
async function runAggregate(
  parsed: IParsedCheck,
  compiled: ICompiledConfig,
  descriptor: IProjectDescriptor,
): Promise<number> {
  if (parsed.format === SARIF_FORMAT) usage("the aggregate check does not produce SARIF; name one rule.");
  const filters = await resolveFilters(parsed.filters, compiled, descriptor);
  const outcomes = await aggregateOutcomes(compiled, descriptor, parsed.format === JSON_FORMAT, filters);
  if (parsed.format === JSON_FORMAT) printAggregateJson(outcomes, descriptor);
  else printAggregateText(outcomes);
  return aggregateExitCode(outcomes, parsed.strict);
}

async function runSingle(
  parsed: IParsedCheck,
  id: string,
  rule: IResolvedRule,
  compiled: ICompiledConfig,
  descriptor: IProjectDescriptor,
): Promise<number> {
  assertForwarded(rule, parsed.forwarded);
  refuseHosted(rule);
  assertFormat(rule, parsed.format);
  const status = ruleStatus(rule, null);
  warnOffRule(rule, status);
  const formatArgs = parsed.format === TEXT_FORMAT ? [] : [`--format=${parsed.format}`];
  const result = await runWholeTreeCheck(id, {
    ...runInputOf(compiled, descriptor),
    args: [...parsed.forwarded, ...formatArgs],
  });
  if (result.code === USAGE_EXIT) return reportResult(result);
  reportResult(result);
  const level: RuleSeverity = status === "off" ? "warn" : ruleEffectiveLevel(rule, status);
  return exitCodeOf(level, result.passed, parsed.strict);
}

/** Runs the `check` route and returns its exit code. */
export async function runCheck(args: readonly string[]): Promise<number> {
  const parsed = parseCheck(args);
  const descriptor = await loadConfigDescriptor(Deno.cwd(), parsed.descriptor, parsed.plugin);
  const compiled = await readAndCompile(descriptor);
  if (parsed.rule === null) return await runAggregate(parsed, compiled, descriptor);
  const id = resolveRule(compiled, parsed.rule);
  const rule = compiled.rules[id];
  if (rule === undefined) usage(`rule '${id}' is not registered.`);
  return await runSingle(parsed, id, rule, compiled, descriptor);
}
