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
import {
  DEFAULT_HEALTH_FORMAT,
  DEFAULT_HEALTH_SORT,
  DEFAULT_HEALTH_TOP,
  DEFAULT_MAX_CRAP,
  DEFAULT_MIN_COMMITS,
  DEFAULT_SINCE_DAYS,
} from "../../report/constants.ts";
import { BoundedReadError, readFileBounded } from "../../report/bounded_io.ts";
import { parseSince } from "../../report/churn.ts";
import { localJscpdRunner } from "../../report/duplication.ts";
import {
  DuplicateCodeSettingsSchema,
  type IDuplicateCodeSettings,
  UnusedExportsSettingsSchema,
} from "../../rules/whole_tree/options.ts";
import type { TJscpdRunner } from "../../rules/whole_tree/duplicate_code.ts";
import { collectHealth, type HealthSortKey, type IHealthSettings } from "../../report/health.ts";
import { LcovError, MAX_LCOV_BYTES } from "../../report/lcov.ts";
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
  "max-crap",
  "coverage",
  "variant",
  "count-nullish",
  "top",
  "sort",
  "since",
  "min-commits",
  "min-score",
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

const DECIMAL_INTEGER = /^\d+$/;
const DECIMAL_NUMBER = /^\d+(\.\d+)?$/;
const SCORE_MAX = 100;

/** Reads a positive safe-integer flag. */
function positiveInteger(name: string, value: string): number {
  if (!DECIMAL_INTEGER.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw usage(`--${name} needs a positive integer within the safe range`);
  }
  return Number(value);
}

/** Reads a score threshold in the closed zero-to-one-hundred range. */
function scoreThreshold(name: string, value: string): number {
  const number = Number(value);
  if (!DECIMAL_NUMBER.test(value) || !Number.isFinite(number) || number > SCORE_MAX) {
    throw usage(`--${name} needs a finite number in [0, ${SCORE_MAX}]`);
  }
  return number;
}

/** Reads a positive finite decimal number flag. */
function positiveFinite(name: string, value: string): number {
  const number = Number(value);
  if (!DECIMAL_NUMBER.test(value) || !Number.isFinite(number) || number <= 0) {
    throw usage(`--${name} needs a positive finite decimal number`);
  }
  return number;
}

/** Reads a boolean flag that is exactly `true` or `false`. */
function booleanFlag(name: string, value: string): boolean {
  if (value !== "true" && value !== "false") throw usage(`--${name} needs exactly true or false`);
  return value === "true";
}

/** The adjacent manifest of measured source hashes, when the coverage fixture supplies one. */
async function coverageManifestOf(coveragePath: string): Promise<Record<string, string> | null> {
  const manifestPath = `${coveragePath}.manifest.json`;
  let text: string;
  try {
    text = await Deno.readTextFile(manifestPath);
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(FAILURE_EXIT, `the coverage manifest is not JSON: '${manifestPath}'`);
  }
  const files = (value as { files?: unknown } | null)?.files;
  if (files === null || typeof files !== "object" || Array.isArray(files)) {
    throw new CliError(FAILURE_EXIT, "the coverage manifest needs a 'files' object of path to sha256");
  }
  const parsed: Record<string, string> = {};
  for (const [path, hash] of Object.entries(files as Record<string, unknown>)) {
    if (typeof hash !== "string") {
      throw new CliError(FAILURE_EXIT, `the coverage manifest hash for '${path}' is not a string`);
    }
    parsed[path] = hash;
  }
  return parsed;
}

/** Reads and validates the coverage input before the snapshot is parsed. */
async function coverageInputOf(
  value: string | undefined,
  rootPath: string,
): Promise<{ text: string | null; sha256: string | null; manifest: Record<string, string> | null }> {
  if (value === undefined) return { text: null, sha256: null, manifest: null };
  const path = join(Deno.cwd(), value);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(path);
  } catch {
    throw usage(`--coverage file is not readable: '${value}'`);
  }
  if (stat.isSymlink || !stat.isFile) throw usage("--coverage must be a regular file inside the project root");
  const real = await Deno.realPath(path);
  if (real !== rootPath && !real.startsWith(`${rootPath}/`)) {
    throw usage("--coverage must be inside the project root");
  }
  if (stat.size > MAX_LCOV_BYTES) throw usage(`--coverage exceeds the ${MAX_LCOV_BYTES} byte bound`);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readFileBounded(real, MAX_LCOV_BYTES);
  } catch (error) {
    if (error instanceof BoundedReadError) throw usage(`--coverage exceeds the ${MAX_LCOV_BYTES} byte bound`);
    throw error;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { text: new TextDecoder().decode(bytes), sha256, manifest: await coverageManifestOf(real) };
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
  const flagNullish = values.has("count-nullish")
    ? booleanFlag("count-nullish", values.get("count-nullish") ?? "")
    : configuredNullish;
  return finiteSettings({
    maxCrap: values.has("max-crap") ? positiveFinite("max-crap", values.get("max-crap") ?? "") : DEFAULT_MAX_CRAP,
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
  });
}

/** Rejects a resolved option that is not a finite positive number, whether a flag or the catalog supplied it. */
function finiteSettings(settings: IHealthSettings): IHealthSettings {
  const limits = {
    "max-cyclomatic": settings.maxCyclomatic,
    "max-cognitive": settings.maxCognitive,
    "max-lines": settings.maxLines,
    "max-crap": settings.maxCrap,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) throw usage(`the resolved --${name} must be a finite positive number`);
  }
  return settings;
}

/** The history window and qualification of one run. */
function historyWindowOf(
  values: Map<string, string>,
  now: Date,
): { sinceEpoch: number; minCommits: number } {
  const minCommits = values.has("min-commits")
    ? positiveInteger("min-commits", values.get("min-commits") ?? "")
    : DEFAULT_MIN_COMMITS;
  try {
    return {
      sinceEpoch: parseSince(values.get("since") ?? `${DEFAULT_SINCE_DAYS}d`, now),
      minCommits,
    };
  } catch (error) {
    throw usage(error instanceof Error ? error.message : String(error));
  }
}

/** Collects the report, turning an input rejection into an attributed failure. */
async function reportOrFail(input: Parameters<typeof collectHealth>[0]): Promise<IHealthReport> {
  try {
    return await collectHealth(input);
  } catch (error) {
    const message = error instanceof LcovError || error instanceof Error ? error.message : String(error);
    throw new CliError(FAILURE_EXIT, `health input rejected: ${message}`);
  }
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
    `maxima: cyclomatic ${options.max_cyclomatic}, cognitive ${options.max_cognitive}, lines ${options.max_lines}, ` +
    `crap ${options.max_crap} (variant ${options.variant}, count-nullish ${options.count_nullish})`,
    `score: ${report.health_score.value.toFixed(1)} ` +
    `(${report.health_score.grade ?? "no-grade"}, ${report.health_score.status})`,
    `hotspots: ${
      report.hotspot_summary.available
        ? `${report.hotspot_summary.qualified} qualified of ${report.hotspot_summary.population} file(s), ` +
          `${report.hotspot_summary.shallow ? "shallow history" : "full history"}`
        : `unavailable (${report.hotspot_summary.reason ?? "unknown"})`
    }`,
    `coverage: ${report.summary.coverage.source} ` +
    `(${report.summary.coverage.matched_files} matched, ${report.summary.coverage.unmatched_files} unmatched, ` +
    `revision ${report.summary.coverage.revision})`,
    `unit size: low ${band("low")}, medium ${band("medium")}, high ${band("high")}, very high ${band("very_high")}`,
    `graph: ${report.summary.graph.internal_edges} internal edge(s), ` +
    `${report.summary.graph.runtime_edges} runtime, ${report.summary.graph.external_specifiers} external, ` +
    `${report.summary.graph.unresolved_specifiers} unresolved, ` +
    `${report.summary.graph.nonliteral_dynamic_imports} nonliteral dynamic ` +
    `(${report.summary.graph.complete ? "complete" : "incomplete"})`,
    `cycles: ${report.vital_signs.cycles.sccs} runtime SCC(s), ${report.vital_signs.cycles.files} ` +
    `file(s) in cycles (${report.vital_signs.cycles.per_thousand.toFixed(2)} per 1000)`,
    `coupling: ${report.vital_signs.coupling.high_files} high file(s) of ` +
    `${report.vital_signs.coupling.code_files} (${report.vital_signs.coupling.percent.toFixed(1)}%)`,
    `file scores: ${report.summary.file_scores_population} file(s), dead exports ` +
    `${report.summary.dead_exports.unused}/${report.summary.dead_exports.total}, dead files ` +
    `${report.summary.dead_files.available ? String(report.summary.dead_files.count) : "unavailable"}`,
  ];
  for (const hotspot of report.hotspots.slice(0, top)) {
    lines.push(
      `  hotspot ${hotspot.path} — score ${hotspot.score.toFixed(1)}, churn ${hotspot.churn.toFixed(2)}, ` +
        `density ${hotspot.density.toFixed(2)}, commits ${hotspot.commits}`,
    );
  }
  for (const finding of report.findings.slice(0, top)) {
    lines.push(
      `  ${finding.path}:${finding.line} ${finding.name} — cyclomatic ${finding.cyclomatic}, ` +
        `cognitive ${finding.cognitive}, lines ${finding.line_count}, crap ${finding.crap.toFixed(1)} ` +
        `(${finding.coverage_source}/${finding.coverage_reason}, ${finding.severity})`,
    );
  }
  for (const signal of report.health_score.signals) {
    if (signal.status === "measured") continue;
    lines.push(`  signal ${signal.signal}: ${signal.status} (${signal.reason ?? "no reason"})`);
  }
  return lines.join("\n");
}

/** The output format, validated against the accepted set. */
function formatOf(values: Map<string, string>): string {
  const format = values.get("format") ?? DEFAULT_HEALTH_FORMAT;
  if (!FORMATS.has(format)) throw usage(`unknown format '${format}'`);
  return format;
}

/** The sort key, validated against the accepted set. */
function sortOf(values: Map<string, string>): HealthSortKey {
  const sort = (values.get("sort") ?? DEFAULT_HEALTH_SORT) as HealthSortKey;
  if (!SORT_KEYS.has(sort)) throw usage(`unknown sort '${sort}'`);
  if (values.has("variant") && !VARIANTS.has(values.get("variant") ?? "")) {
    throw usage(`unknown variant '${values.get("variant")}'`);
  }
  return sort;
}

/** The canonical root that matches the descriptor, from the optional flag. */
async function resolveRoot(descriptorRoot: string, values: Map<string, string>): Promise<string> {
  const rootFlag = values.get("root");
  const rootPath = rootFlag === undefined ? descriptorRoot : await canonicalRoot(toFileUrl(join(Deno.cwd(), rootFlag)));
  if (rootPath !== descriptorRoot) throw usage(`--root must equal the descriptor root '${descriptorRoot}'`);
  return rootPath;
}

/** The duplication settings and the validated local runner. */
async function duplicationSetupOf(
  compiled: ICompiledConfig,
  rootPath: string,
): Promise<{ duplication: IDuplicateCodeSettings | null; duplicateRunner: TJscpdRunner | null }> {
  const rule = compiled.rules["duplicate-code"];
  const options = rule?.effectiveOptions ?? rule?.defaultOptions ?? null;
  if (options === null) return { duplication: null, duplicateRunner: null };
  const parsed = DuplicateCodeSettingsSchema.safeParse(options);
  if (!parsed.success) return { duplication: null, duplicateRunner: null };
  try {
    return { duplication: parsed.data, duplicateRunner: await localJscpdRunner(rootPath, parsed.data.jscpdVersion) };
  } catch {
    return { duplication: parsed.data, duplicateRunner: null };
  }
}

/** The declared public-entry globs of the unused-exports policy, or none when the catalog has no such rule. */
function publicEntriesOf(compiled: ICompiledConfig): readonly string[] {
  const rule = compiled.rules["unused-exports"];
  const options = rule?.effectiveOptions ?? rule?.defaultOptions ?? null;
  const parsed = UnusedExportsSettingsSchema.safeParse(options);
  return parsed.success ? parsed.data.publicEntries ?? [] : [];
}

/** Prints the report in the requested format. */
function renderReport(report: IHealthReport, format: string, top: number): void {
  if (format === "json") {
    print(`${JSON.stringify({ ...report, findings: report.findings.slice(0, top) }, null, 2)}\n`);
    return;
  }
  print(`${renderText(report, top)}\n`);
}

/** Applies the requested score gate and returns its exit code. */
function gateOf(report: IHealthReport, minScore: number | null): number {
  if (minScore === null) return 0;
  if (report.health_score.status !== "complete") {
    printError(`health score is partial; the ${minScore} gate cannot pass\n`);
    return FAILURE_EXIT;
  }
  if (report.health_score.value < minScore) {
    printError(`health score ${report.health_score.value.toFixed(1)} is below the ${minScore} gate\n`);
    return FAILURE_EXIT;
  }
  return 0;
}

/** Runs the health command and returns its exit code. */
export async function runHealth(args: readonly string[]): Promise<number> {
  const values = flagValues(args);
  const format = formatOf(values);
  const sort = sortOf(values);
  const top = values.has("top") ? positiveInteger("top", values.get("top") ?? "") : DEFAULT_HEALTH_TOP;
  const minScore = values.has("min-score") ? scoreThreshold("min-score", values.get("min-score") ?? "") : null;
  const now = new Date();
  const { sinceEpoch, minCommits } = historyWindowOf(values, now);

  const descriptor = await loadConfigDescriptor(
    Deno.cwd(),
    values.get("descriptor") ?? null,
    values.get("plugin") ?? null,
  );
  const compiled = await readAndCompile(descriptor);
  const rootPath = await resolveRoot(await canonicalRoot(descriptor.rootUrl), values);
  const settings = settingsOf(compiled, descriptor.pluginName, values);
  const { duplication, duplicateRunner } = await duplicationSetupOf(compiled, rootPath);
  const coverage = await coverageInputOf(values.get("coverage"), rootPath);
  const report = await reportOrFail({
    rootPath,
    ignoreGlobs: (compiled.catalog.ignore ?? []).map((entry) => entry.glob),
    scopes: compiled.catalog.scopes,
    settings,
    sort,
    coverageText: coverage.text,
    coverageSha256: coverage.sha256,
    coverageManifest: coverage.manifest,
    testGlobs: compiled.catalog.scopes.test,
    publicEntries: publicEntriesOf(compiled),
    sinceEpoch,
    minCommits,
    nowEpoch: Math.floor(now.getTime() / 1000),
    duplication,
    duplicateRunner,
  });

  renderReport(report, format, top);
  const gate = gateOf(report, minScore);
  if (gate !== 0) return gate;
  for (const error of report.errors) printError(`${error.path}: ${error.message}\n`);
  return report.errors.length > 0 ? FAILURE_EXIT : 0;
}
