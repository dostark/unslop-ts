/**
 * @module HealthCommand
 * @path src/cli/commands/health.ts
 * @description The `health` route: resolves the project, collects the report, and renders text or JSON.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/cli/unslop.ts, src/report/health.ts, src/report/health_model.ts]
 *
 * Usage:
 *   deno run --allow-read --allow-env --allow-run=git,node src/cli/unslop.ts health [--format=text|json]
 */

import { fromFileUrl, join, toFileUrl } from "@std/path";
import type { ICompiledConfig } from "../../config/descriptor.ts";
import type { JsonValue } from "../../engine/catalog.ts";
import {
  DEFAULT_COUNT_NULLISH,
  DEFAULT_MAX_COGNITIVE,
  DEFAULT_MAX_CYCLOMATIC,
  DEFAULT_MAX_FUNCTION_LINES,
  DEFAULT_METRIC_VARIANT,
} from "../../metrics/constants.ts";
import type { MetricVariant } from "../../metrics/types.ts";
import { DEFAULT_HEALTH_FORMAT, DEFAULT_HEALTH_SORT, DEFAULT_HEALTH_TOP } from "../../report/constants.ts";
import { collectHealth, type HealthSortKey, type IHealthSettings } from "../../report/health.ts";
import type { IHealthReport } from "../../report/health_model.ts";
import { CliError, FAILURE_EXIT, USAGE_EXIT } from "../error.ts";
import { print, printError } from "../output.ts";
import { loadConfigDescriptor, readAndCompile } from "../project_loader.ts";

/** The value flags the health command accepts in this checkpoint. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "root",
  "descriptor",
  "plugin",
  "format",
  "max-cyclomatic",
  "max-cognitive",
  "max-lines",
  "variant",
  "count-nullish",
  "top",
  "sort",
]);

/** The formats the command writes. */
const FORMATS: ReadonlySet<string> = new Set(["text", "json"]);

/** The sort keys the command accepts. */
const SORT_KEYS: ReadonlySet<string> = new Set(["cyclomatic", "cognitive", "lines", "severity"]);

/** The variants the command accepts. */
const VARIANTS: ReadonlySet<string> = new Set(["classic", "extended"]);

/** The usage text of one flag failure. */
function usage(message: string): CliError {
  return new CliError(USAGE_EXIT, `${message}\nUsage: unslop health [--format=text|json] [--descriptor=<entry>]`);
}

/** The flag values of the command, with strict duplicate, name and value checks. */
function flagValues(args: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const arg of args) {
    if (!arg.startsWith("--")) throw usage(`health takes no positional argument: '${arg}'`);
    const equals = arg.indexOf("=");
    if (equals === -1) throw usage(`'${arg}' needs a value`);
    const name = arg.slice(2, equals);
    const value = arg.slice(equals + 1);
    if (!VALUE_FLAGS.has(name)) throw usage(`unknown health flag '--${name}'`);
    if (values.has(name)) throw usage(`--${name} is given more than once`);
    if (value.length === 0) throw usage(`--${name} needs a non-empty value`);
    values.set(name, value);
  }
  return values;
}

/** Reads a positive integer flag. */
function positiveInteger(name: string, value: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw usage(`--${name} needs a positive integer`);
  return Number(value);
}

/** The compiled option record of one rule, or undefined when the catalog does not list it. */
function optionsOf(compiled: ICompiledConfig, pluginName: string, bareId: string): Record<string, JsonValue> | null {
  const rule = compiled.rules[`${pluginName}/${bareId}`];
  if (rule === undefined) return null;
  return rule.effectiveOptions ?? rule.defaultOptions ?? null;
}

/** The number an option record carries, or the engine default. */
function numberOption(options: Record<string, JsonValue> | null, name: string, fallback: number): number {
  const value = options?.[name];
  return typeof value === "number" ? value : fallback;
}

/** The resolved settings, with CLI overrides above the compiled catalog and the engine defaults. */
function settingsOf(compiled: ICompiledConfig, pluginName: string, values: Map<string, string>): IHealthSettings {
  const cyclomatic = optionsOf(compiled, pluginName, "max-cyclomatic-complexity");
  const cognitive = optionsOf(compiled, pluginName, "max-cognitive-complexity");
  const lines = optionsOf(compiled, pluginName, "max-function-lines");
  const configuredVariant = cyclomatic?.variant === "classic" ? "classic" : DEFAULT_METRIC_VARIANT;
  const configuredNullish = typeof cognitive?.countNullish === "boolean"
    ? cognitive.countNullish
    : DEFAULT_COUNT_NULLISH;
  const flagVariant = values.get("variant") ?? configuredVariant;
  const flagNullish = values.has("count-nullish") ? values.get("count-nullish") === "true" : configuredNullish;
  return {
    maxCyclomatic: values.has("max-cyclomatic")
      ? positiveInteger("max-cyclomatic", values.get("max-cyclomatic") ?? "")
      : numberOption(cyclomatic, "max", DEFAULT_MAX_CYCLOMATIC),
    maxCognitive: values.has("max-cognitive")
      ? positiveInteger("max-cognitive", values.get("max-cognitive") ?? "")
      : numberOption(cognitive, "max", DEFAULT_MAX_COGNITIVE),
    maxLines: values.has("max-lines")
      ? positiveInteger("max-lines", values.get("max-lines") ?? "")
      : numberOption(lines, "max", DEFAULT_MAX_FUNCTION_LINES),
    variant: flagVariant as MetricVariant,
    countNullish: flagNullish,
  };
}

/** The canonical root the descriptor names, resolved through the filesystem. */
async function canonicalRoot(url: URL): Promise<string> {
  try {
    return await Deno.realPath(fromFileUrl(url));
  } catch (error) {
    throw usage(`the descriptor root is not readable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The text view of one report. */
function renderText(report: IHealthReport, top: number): string {
  const options = report.summary.options;
  const bands = report.vital_signs.unit_size.bands;
  const band = (name: "low" | "medium" | "high" | "very_high"): string =>
    `${bands[name].count} (${bands[name].percent.toFixed(1)}%)`;
  const lines = [
    `unslop health (${report.formula_version}, schema ${report.schema_version})`,
    `files: ${report.summary.analyzed_files} analyzed, ${report.summary.excluded_files} excluded, ` +
    `${report.summary.failed_files} failed | functions: ${report.summary.functions} | ` +
    `findings: ${report.summary.findings_population}`,
    `maxima: cyclomatic ${options.max_cyclomatic}, cognitive ${options.max_cognitive}, lines ${options.max_lines} ` +
    `(variant ${options.variant}, count-nullish ${options.count_nullish})`,
    `unit size: low ${band("low")}, medium ${band("medium")}, high ${band("high")}, very high ${band("very_high")}`,
  ];
  for (const finding of report.findings.slice(0, top)) {
    lines.push(
      `  ${finding.path}:${finding.line} ${finding.name} — cyclomatic ${finding.cyclomatic}, ` +
        `cognitive ${finding.cognitive}, lines ${finding.line_count} (${finding.severity})`,
    );
  }
  return lines.join("\n");
}

/** Runs the health command and returns its exit code. */
export async function runHealth(args: readonly string[]): Promise<number> {
  const values = flagValues(args);
  const format = values.get("format") ?? DEFAULT_HEALTH_FORMAT;
  if (!FORMATS.has(format)) throw usage(`unknown format '${format}'`);
  const sort = (values.get("sort") ?? DEFAULT_HEALTH_SORT) as HealthSortKey;
  if (!SORT_KEYS.has(sort)) throw usage(`unknown sort '${sort}'`);
  if (values.has("variant") && !VARIANTS.has(values.get("variant") ?? "")) {
    throw usage(`unknown variant '${values.get("variant")}'`);
  }
  const top = values.has("top") ? positiveInteger("top", values.get("top") ?? "") : DEFAULT_HEALTH_TOP;

  const descriptor = await loadConfigDescriptor(
    Deno.cwd(),
    values.get("descriptor") ?? null,
    values.get("plugin") ?? null,
  );
  const compiled = await readAndCompile(descriptor);
  const descriptorRoot = await canonicalRoot(descriptor.rootUrl);
  const rootFlag = values.get("root");
  const rootPath = rootFlag === undefined ? descriptorRoot : await canonicalRoot(toFileUrl(join(Deno.cwd(), rootFlag)));
  if (rootPath !== descriptorRoot) throw usage(`--root must equal the descriptor root '${descriptorRoot}'`);

  const settings = settingsOf(compiled, descriptor.pluginName, values);
  const report = await collectHealth({
    rootPath,
    ignoreGlobs: (compiled.catalog.ignore ?? []).map((entry) => entry.glob),
    scopes: compiled.catalog.scopes,
    settings,
    sort,
  });

  if (format === "json") {
    print(`${JSON.stringify({ ...report, findings: report.findings.slice(0, top) }, null, 2)}\n`);
  } else {
    print(`${renderText(report, top)}\n`);
  }
  for (const error of report.errors) printError(`${error.path}: ${error.message}\n`);
  return report.errors.length > 0 ? FAILURE_EXIT : 0;
}
