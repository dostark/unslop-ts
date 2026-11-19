/**
 * @module CheckCommand
 * @path src/cli/commands/check.ts
 * @description The `check` route: resolves one configured rule and runs it through the shared whole-tree runner.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/cli/check_runner.ts, src/cli/selection.ts, src/cli/unslop.ts]
 *
 * Usage:
 *   deno run --allow-read --allow-env src/cli/unslop.ts check --rule=<id> [--format=text|json|sarif]
 */

import { fromFileUrl } from "@std/path";
import { asJsonValue, type RuleSeverity } from "../../engine/catalog.ts";
import type { ICompiledConfig, IResolvedRule } from "../../config/descriptor.ts";
import { type ICheckRunResult, runWholeTreeCheck } from "../check_runner.ts";
import { CliError, FAILURE_EXIT, USAGE_EXIT } from "../error.ts";
import { print, printError } from "../output.ts";
import { loadConfigDescriptor, readAndCompile } from "../project_loader.ts";
import { resolveRuleId, ruleEffectiveLevel, type RuleStatus, ruleStatus } from "../selection.ts";

const TEXT_FORMAT = "text";
const JSON_FORMAT = "json";
const SARIF_FORMAT = "sarif";
const STRICT_FLAG = "strict";
const RULE_OPTION = "rule";
const FORMAT_OPTION = "format";
const DESCRIPTOR_OPTION = "descriptor";
const PLUGIN_OPTION = "plugin";
const CATALOG_OPTION = "catalog";

/** The formats the route accepts. Only `import-cycles` writes SARIF in this phase. */
type TCheckFormat = typeof TEXT_FORMAT | typeof JSON_FORMAT | typeof SARIF_FORMAT;

const FORMATS: readonly string[] = [TEXT_FORMAT, JSON_FORMAT, SARIF_FORMAT];
const SARIF_RULES: ReadonlySet<string> = new Set(["import-cycles"]);
const JSON_RULES: ReadonlySet<string> = new Set(["import-cycles", "duplicate-code"]);

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

/** One parsed check invocation: the route inputs and the flags the runner owns. */
interface IParsedCheck {
  readonly rule: string;
  readonly format: TCheckFormat;
  readonly descriptor: string | null;
  readonly plugin: string | null;
  readonly strict: boolean;
  readonly forwarded: readonly string[];
}

function usage(message: string): never {
  throw new CliError(
    USAGE_EXIT,
    `${message}\nUsage: unslop check --rule=<id> [--format=text|json|sarif] [--strict] [--descriptor=<entry>] [--plugin=<entry>]`,
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

function parseCheck(args: readonly string[]): IParsedCheck {
  let ruleToken: string | null = null;
  let formatValue: string | undefined;
  let descriptor: string | null = null;
  let plugin: string | null = null;
  let strict = false;
  const forwarded: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) usage(`check takes no positional argument: '${arg}'`);
    const name = flagName(arg);
    if (name === RULE_OPTION) ruleToken = optionValue(arg);
    else if (name === FORMAT_OPTION) {
      formatValue = optionValue(arg);
      forwarded.push(arg);
    } else if (name === DESCRIPTOR_OPTION) descriptor = optionValue(arg);
    else if (name === PLUGIN_OPTION) plugin = optionValue(arg);
    else if (name === CATALOG_OPTION) optionValue(arg);
    else if (name === STRICT_FLAG && !arg.includes("=")) strict = true;
    else forwarded.push(arg);
  }
  if (ruleToken === null) usage("check needs --rule=<id>");
  return { rule: ruleToken, format: parseFormat(formatValue), descriptor, plugin, strict, forwarded };
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

/** Runs the `check` route and returns its exit code. */
export async function runCheck(args: readonly string[]): Promise<number> {
  const parsed = parseCheck(args);
  const descriptor = await loadConfigDescriptor(Deno.cwd(), parsed.descriptor, parsed.plugin);
  const compiled = await readAndCompile(descriptor);
  const id = resolveRule(compiled, parsed.rule);
  const rule = compiled.rules[id];
  if (rule === undefined) usage(`rule '${id}' is not registered.`);
  assertForwarded(rule, parsed.forwarded);
  refuseHosted(rule);
  assertFormat(rule, parsed.format);
  const status = ruleStatus(rule, null);
  warnOffRule(rule, status);
  const result = await runWholeTreeCheck(id, {
    catalog: asJsonValue(compiled.catalog),
    rootPath: fromFileUrl(descriptor.rootUrl),
    args: parsed.forwarded,
  });
  if (result.code === USAGE_EXIT) return reportResult(result);
  reportResult(result);
  const level: RuleSeverity = status === "off" ? "warn" : ruleEffectiveLevel(rule, status);
  return exitCodeOf(level, result.passed, parsed.strict);
}
