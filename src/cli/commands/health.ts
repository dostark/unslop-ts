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
import { classifyPath, type IResolvedRuleSettings, type JsonValue } from "../../engine/catalog.ts";
import { skipReasonOf } from "../../engine/rule_gate.ts";
import {
  DEFAULT_COUNT_NULLISH,
  DEFAULT_MAX_COGNITIVE,
  DEFAULT_MAX_CYCLOMATIC,
  DEFAULT_MAX_FILE_LINES,
  DEFAULT_MAX_FUNCTION_LINES,
  DEFAULT_METRIC_VARIANT,
} from "../../metrics/constants.ts";
import type { MetricVariant } from "../../metrics/types.ts";
import {
  DEFAULT_HEALTH_FORMAT,
  DEFAULT_HEALTH_SORT,
  DEFAULT_HEALTH_TOP,
  DEFAULT_HEALTH_TOP_CLASSES,
  DEFAULT_MAX_CRAP,
  DEFAULT_MIN_COMMITS,
  DEFAULT_SINCE_DAYS,
  RUNNER_LIMITS,
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
import type { IFileLineLimits } from "../../report/large_files.ts";
import { LcovError, MAX_LCOV_BYTES } from "../../report/lcov.ts";
import type {
  IHealthBands,
  IHealthDesignFinding,
  IHealthReport,
  IHealthScoreSignal,
} from "../../report/health_model.ts";
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
  "top-classes",
  "classes",
  "sort",
  "since",
  "min-commits",
  "min-score",
]);

/** The flags that need no value. A bare flag reads as true. */
const BARE_FLAGS: ReadonlySet<string> = new Set(["classes"]);

/** The formats the command writes. */
const FORMATS: ReadonlySet<string> = new Set(["text", "json"]);

/** The sort keys the command accepts. */
const SORT_KEYS: ReadonlySet<string> = new Set(["cyclomatic", "cognitive", "lines", "severity"]);

/** The variants the command accepts. */
const VARIANTS: ReadonlySet<string> = new Set(["classic", "extended"]);

/** The usage text of one flag failure. */
function usage(message: string): CliError {
  return new CliError(
    USAGE_EXIT,
    `${message}\nUsage: unslop health [--format=text|json] [--descriptor=<entry>] [--classes] [--top-classes=<n>]`,
  );
}

/** The flag values of the command, with strict duplicate, name and value checks. */
function flagValues(args: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const arg of args) {
    if (!arg.startsWith("--")) throw usage(`health takes no positional argument: '${arg}'`);
    const equals = arg.indexOf("=");
    if (equals === -1 && !BARE_FLAGS.has(arg.slice(2))) throw usage(`'${arg}' needs a value`);
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const value = equals === -1 ? "true" : arg.slice(equals + 1);
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

/** The module size limits of the catalog, or null when it neither enables the module size rule nor configures its options. */
function fileLinesOf(compiled: ICompiledConfig, pluginName: string): IFileLineLimits | null {
  const rule = compiled.rules[`${pluginName}/max-file-lines`];
  const optionsConfigured = rule?.sources.fields.options?.startsWith("config:") ?? false;
  if (rule === undefined || (rule.effectiveLevel === "off" && !optionsConfigured)) return null;
  const options = optionsOf(compiled, pluginName, "max-file-lines");
  const hard = numberOption(options, "max", DEFAULT_MAX_FILE_LINES);
  const entry = compiled.catalog.rules[`${pluginName}/max-file-lines`];
  const settings: IResolvedRuleSettings = {
    severity: entry.severity,
    scope: entry.scope,
    include: entry.include,
    exclude: entry.exclude,
    options: {},
  };
  const appliesTo = (repoPath: string): boolean =>
    skipReasonOf(repoPath, classifyPath(repoPath, compiled.catalog.scopes), settings) === null;
  return { soft: numberOption(options, "softMax", hard), hard, appliesTo };
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
      : numberOption(lines, "softMax", numberOption(lines, "max", DEFAULT_MAX_FUNCTION_LINES)),
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

/** The report headings use one consistent visual separator in plain terminals and logs. */
function heading(title: string): string[] {
  return ["", title, "-".repeat(title.length)];
}

/** The human name of one score signal. */
function signalName(name: string): string {
  return name.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

/** One observed score signal, or its stated reason for absence. */
function signalLine(signal: IHealthScoreSignal): string {
  const label = signalName(signal.signal).padEnd(21);
  if (signal.status !== "measured") {
    return `  ${label} ${"—".padEnd(19)} ${signal.status}: ${signal.reason ?? "no reason"}`;
  }
  const unit = signal.signal === "cycles" || signal.signal === "unit_size" ? "/1k" : "%";
  const value = (signal.raw === null ? "—" : `${signal.raw.toFixed(1)}${unit}`).padEnd(7);
  const population =
    (signal.numerator === null || signal.denominator === null ? "—" : `${signal.numerator}/${signal.denominator}`)
      .padEnd(17);
  return `  ${label} ${value} ${population} -${signal.penalty.toFixed(2)}`;
}

/** One line of the derived bands of a metric. */
function bandsLine(label: string, bands: IHealthBands): string {
  return `    ${label.padEnd(4)} mean ${bands.mean.toFixed(1)} · sd ${bands.sd.toFixed(1)} · low ${
    bands.low.toFixed(1)
  } · ` +
    `high ${bands.high.toFixed(1)} · very high ${bands.very_high.toFixed(1)}`;
}

/** The text of one value that may be absent. */
function valueText(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

/** The files above the module size limits, shown as advice and not as a gate. */
function largeFileLines(report: IHealthReport, top: number): string[] {
  if (report.large_files.length === 0) return [];
  const lines = [
    ...heading("LARGE FILES · advisory"),
    `  ${Math.min(top, report.large_files.length)} shown of ${report.large_files.length}`,
  ];
  for (const file of report.large_files.slice(0, top)) {
    lines.push(`  ${String(file.lines).padStart(5)}  ${file.path}  (${file.limit} limit)`);
  }
  return lines;
}

/** The class design section, labeled as an unslop extension of the fallow-compatible report. */
function classSectionLines(report: IHealthReport, topClasses: number): string[] {
  const { class_scores: scores, design_findings: findings, class_thresholds: thresholds } = report;
  const defaults = thresholds.defaults;
  const count = (strategy: IHealthDesignFinding["strategy"]): number =>
    findings.filter((finding) => finding.strategy === strategy).length;
  const lines = [
    ...heading("CLASS DESIGN · unslop extension"),
    `  ${scores.length} classes · ${count("god-class")} god classes · ${count("data-class")} data classes · ` +
    `${count("feature-envy")} envious methods`,
    `  Defaults (second-hand) WMC >= ${defaults.wmcVeryHigh.value} · TCC < ${defaults.tccLimit.value.toFixed(2)} · ` +
    `ATFD > ${defaults.atfdFew.value} · WOC < ${defaults.wocLimit.value.toFixed(2)} · LAA < ${
      defaults.laaLimit.value.toFixed(2)
    }`,
    `  Derived from ${thresholds.derived.population} classes with a method:`,
  ];
  for (const [name, bands] of Object.entries(thresholds.derived.metrics)) {
    lines.push(bandsLine(name.toUpperCase(), bands));
  }
  lines.push(`  ${Math.min(topClasses, scores.length)} shown of ${scores.length} classes, by WMC`);
  for (const score of scores.slice(0, topClasses)) {
    lines.push(
      `  ${String(score.wmc).padStart(4)}  ${score.path}:${score.line} ${score.name}  NOM ${score.nom} · ` +
        `TCC ${valueText(score.tcc, 2)} · ATFD ${score.atfd} · CBO ${score.cbo} · RFC ${score.rfc ?? "n/a"} · ` +
        `DIT ${score.dit ?? "n/a"} · WOC ${valueText(score.woc, 2)} (${score.precision})`,
    );
  }
  for (const finding of findings.slice(0, topClasses)) {
    const target = finding.method_name === null ? finding.class_name : `${finding.class_name}.${finding.method_name}`;
    lines.push(`  ${finding.strategy.padEnd(12)} ${finding.path}:${finding.line} ${target}`);
  }
  return lines;
}

/** The text view of one report, grouped by summary, score evidence and actionable details. */
function renderText(report: IHealthReport, top: number, minScore: number | null, topClasses: number): string {
  const { summary, vital_signs, health_score: score } = report;
  const options = summary.options;
  const bands = vital_signs.unit_size.bands;
  const band = (name: "low" | "medium" | "high" | "very_high"): string =>
    `${bands[name].count} (${bands[name].percent.toFixed(1)}%)`;
  const grade = score.grade === null ? "grade withheld" : `grade ${score.grade}`;
  const lines = [
    "UNSLOP HEALTH",
    "=============",
    `Score ${score.value.toFixed(1)} / 100  (${score.status}; ${grade})`,
    `Policy ${
      minScore === null
        ? "advisory: score does not affect exit status"
        : `gate: minimum score ${minScore}; partial scores fail`
    }`,
    `Formula ${report.formula_version} · schema ${report.schema_version} · tool ${report.tool_version}`,
    ...heading("OVERVIEW"),
    `  Scope       ${summary.analyzed_files} files analyzed · ${summary.excluded_files} excluded · ` +
    `${summary.failed_files} failed · ${summary.functions} functions`,
    `  Findings    ${summary.findings_population} functions above a threshold`,
    `  Limits      cyclomatic ${options.max_cyclomatic} · cognitive ${options.max_cognitive} · ` +
    `code lines ${options.max_lines} · CRAP ${options.max_crap}`,
    `  Variant     ${options.variant} · count-nullish ${options.count_nullish}`,
    `  Coverage    ${summary.coverage.source} · ${summary.coverage.matched_files} matched · ` +
    `${summary.coverage.unmatched_files} unmatched · revision ${summary.coverage.revision}`,
    `  Graph       ${summary.graph.complete ? "complete within scan scope" : "incomplete"} · ` +
    `${summary.graph.internal_edges} internal edges · ${summary.graph.external_specifiers} external · ` +
    `${summary.graph.excluded_source_specifiers} excluded source · ${summary.graph.resource_specifiers} resources · ` +
    `${summary.graph.unresolved_specifiers} unresolved · ` +
    `${summary.graph.nonliteral_dynamic_imports} nonliteral dynamic`,
    `  File scores ${summary.file_scores_population} files`,
    `  Unit size   low ${band("low")} · medium ${band("medium")} · ` +
    `high ${band("high")} · very high ${band("very_high")}`,
    `  Structure   ${vital_signs.cycles.sccs} runtime cycles · ${vital_signs.coupling.high_files} ` +
    `high-coupling files · ${summary.dead_exports.unused}/${summary.dead_exports.total} dead exports · ` +
    `${summary.dead_files.available ? summary.dead_files.count : "unavailable"} dead files`,
    ...heading("SCORE SIGNALS"),
    "  9 supported score signals; unused dependencies and prop drilling are informational and outside the formula.",
    "  Signal                Observed  Population        Penalty / status",
    ...score.signals.map(signalLine),
    ...classSectionLines(report, topClasses),
    ...largeFileLines(report, top),
    ...heading("HOTSPOTS"),
    `  ${Math.min(top, report.hotspots.length)} shown of ${report.hotspot_summary.qualified} qualified` +
    `${report.hotspot_summary.shallow ? " · shallow history, advisory only" : ""}`,
  ];
  for (const hotspot of report.hotspots.slice(0, top)) {
    lines.push(
      `  ${hotspot.score.toFixed(1).padStart(5)}  ${hotspot.path}  ` +
        `(${hotspot.commits} commits, churn ${hotspot.churn.toFixed(1)}, density ${hotspot.density.toFixed(2)})`,
    );
  }
  lines.push(
    ...heading("FINDINGS"),
    `  ${Math.min(top, report.findings.length)} shown of ${summary.findings_population}`,
  );
  for (const finding of report.findings.slice(0, top)) {
    lines.push(
      `  ${finding.severity.toUpperCase().padEnd(8)} ${finding.path}:${finding.line} ${finding.name}  ` +
        `CC ${finding.cyclomatic} · Cog ${finding.cognitive} · Lines ${finding.line_count} · ` +
        `CRAP ${finding.crap.toFixed(1)} (${finding.coverage_source})`,
    );
  }
  lines.push(...heading("LIMITATIONS"));
  lines.push("  Line counts use unique code-token lines; they exclude blank and comment-only lines.");
  if (summary.coverage.source === "none") lines.push("  CRAP uses estimated coverage; no LCOV input was supplied.");
  if (report.hotspot_summary.shallow) lines.push("  Git history is shallow; hotspot scores are advisory.");
  for (const signal of score.signals) {
    if (signal.status === "measured") continue;
    lines.push(`  ${signalName(signal.signal)}: ${signal.status} (${signal.reason ?? "no reason"})`);
  }
  for (const error of report.errors) lines.push(`  ${error.path}: ${error.message}`);
  return lines.join("\n");
}

/** The text of the class design view alone. */
function renderClassesText(report: IHealthReport, topClasses: number): string {
  const title = `UNSLOP HEALTH · classes · formula ${report.formula_version} · tool ${report.tool_version}`;
  return [title, ...classSectionLines(report, topClasses)].join("\n");
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
    return {
      duplication: parsed.data,
      duplicateRunner: await localJscpdRunner(rootPath, parsed.data.jscpdVersion, RUNNER_LIMITS),
    };
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

/** What the command prints: how many rows of each list, and whether only the class section. */
interface IRenderChoice {
  readonly top: number;
  readonly topClasses: number;
  readonly classesOnly: boolean;
  readonly minScore: number | null;
}

/** The JSON of the class design view alone. */
function classesJson(report: IHealthReport): unknown {
  const { schema_version, formula_version, tool_version, class_scores, design_findings, class_thresholds } = report;
  return { schema_version, formula_version, tool_version, class_scores, design_findings, class_thresholds };
}

/** Prints the report in the requested format. */
function renderReport(report: IHealthReport, format: string, choice: IRenderChoice): void {
  if (format === "json") {
    const shown = choice.classesOnly
      ? classesJson(report)
      : { ...report, findings: report.findings.slice(0, choice.top) };
    print(`${JSON.stringify(shown, null, 2)}\n`);
    return;
  }
  const text = choice.classesOnly
    ? renderClassesText(report, choice.topClasses)
    : renderText(report, choice.top, choice.minScore, choice.topClasses);
  print(`${text}\n`);
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
  const topClasses = values.has("top-classes")
    ? positiveInteger("top-classes", values.get("top-classes") ?? "")
    : DEFAULT_HEALTH_TOP_CLASSES;
  const classesOnly = booleanFlag("classes", values.get("classes") ?? "false");
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
    fileLines: fileLinesOf(compiled, descriptor.pluginName),
  });

  renderReport(report, format, { top, topClasses, classesOnly, minScore });
  const gate = gateOf(report, minScore);
  if (gate !== 0) return gate;
  for (const error of report.errors) printError(`${error.path}: ${error.message}\n`);
  return report.errors.length > 0 ? FAILURE_EXIT : 0;
}
