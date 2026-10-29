/**
 * @module HealthCollect
 * @path src/report/health.ts
 * @description Walks a descriptor root, measures every function, and builds the health report.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/report/parse.ts, src/report/health_model.ts, src/cli/commands/health.ts]
 */

import { join as platformJoin } from "@std/path";
import { classifyPath, type ICatalogScopes } from "../engine/catalog.ts";
import { matchesAnyGlob } from "../engine/glob.ts";
import { join as posixJoin } from "../engine/posix_path.ts";
import { measureFunction } from "../metrics/function_metrics.ts";
import type { IMetricOptions, MetricVariant } from "../metrics/types.ts";
import {
  HEALTH_FORMULA_VERSION,
  HEALTH_SCHEMA_VERSION,
  type IHealthError,
  type IHealthFinding,
  type IHealthReport,
  type IHealthVitalSigns,
} from "./health_model.ts";
import { type IParsedHealthFile, MAX_SOURCE_BYTES, parseHealthFile } from "./parse.ts";
import { TOOL_VERSION } from "./version.ts";

/** The directories the report never walks. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules", "dist"]);

/** The source extensions the report parses. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/** The declared size below which a unit is small. */
const LOW_LINES = 15;

/** The declared size below which a unit is medium. */
const MEDIUM_LINES = 30;

/** The declared size below which a unit is high. */
const HIGH_LINES = 60;

/** One unit-size band name. */
type UnitSizeBand = "low" | "medium" | "high" | "very_high";

/** The finding sort keys the CLI accepts. */
export type HealthSortKey = "cyclomatic" | "cognitive" | "lines" | "severity";

/** The resolved measurement settings of one run. */
export interface IHealthSettings {
  readonly maxCyclomatic: number;
  readonly maxCognitive: number;
  readonly maxLines: number;
  readonly variant: MetricVariant;
  readonly countNullish: boolean;
}

/** Everything one collection run reads. */
export interface ICollectHealthInput {
  readonly rootPath: string;
  readonly ignoreGlobs: readonly string[];
  readonly scopes: ICatalogScopes;
  readonly settings: IHealthSettings;
  readonly sort: HealthSortKey;
}

/** The measured values a finding reports. */
interface IFindingValues {
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly lines: number;
}

/** The severity a measured value earns under its limit. */
function severityOf(value: number, max: number): "moderate" | "high" | "critical" {
  if (value > 3 * max) return "critical";
  if (value > 2 * max) return "high";
  return "moderate";
}

/** The worst severity among the metrics that exceed their limits, or null when none does. */
function worstSeverity(values: IFindingValues, settings: IHealthSettings): "moderate" | "high" | "critical" | null {
  const bands: ("moderate" | "high" | "critical")[] = [];
  if (values.cyclomatic > settings.maxCyclomatic) bands.push(severityOf(values.cyclomatic, settings.maxCyclomatic));
  if (values.cognitive > settings.maxCognitive) bands.push(severityOf(values.cognitive, settings.maxCognitive));
  if (values.lines > settings.maxLines) bands.push(severityOf(values.lines, settings.maxLines));
  if (bands.length === 0) return null;
  const order = { moderate: 0, high: 1, critical: 2 };
  return bands.reduce((worst, band) => (order[band] > order[worst] ? band : worst));
}

/** The unit-size band of one code-token line count. */
function bandOf(lines: number): UnitSizeBand {
  if (lines <= LOW_LINES) return "low";
  if (lines <= MEDIUM_LINES) return "medium";
  if (lines <= HIGH_LINES) return "high";
  return "very_high";
}

/** The percentage of `count` in `total`, zero for an empty population. */
function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100;
}

/** The vital signs of the measured units. */
function vitalSignsOf(bands: Readonly<Record<UnitSizeBand, number>>, total: number): IHealthVitalSigns {
  const band = (count: number) => ({ count, percent: percentOf(count, total) });
  return {
    unit_size: {
      total,
      bands: {
        low: band(bands.low),
        medium: band(bands.medium),
        high: band(bands.high),
        very_high: band(bands.very_high),
      },
    },
  };
}

/** One measured finding, before it is sorted and displayed. */
interface IMeasuredFinding extends IHealthFinding {
  readonly values: IFindingValues;
}

/** A source file that the walk excludes, with its reason. */
function isExcluded(relativePath: string, input: ICollectHealthInput): boolean {
  if (relativePath.endsWith(".d.ts")) return true;
  if (classifyPath(relativePath, input.scopes) === "fixture") return true;
  return matchesAnyGlob(relativePath, input.ignoreGlobs);
}

/** The source files of one root, sorted, without excluded paths or directories. */
async function sourceFiles(input: ICollectHealthInput): Promise<{ files: string[]; excluded: number }> {
  const files: string[] = [];
  let excluded = 0;
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix === "" ? entry.name : posixJoin(prefix, entry.name);
      if (entry.isDirectory) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(posixJoin(directory, entry.name), relativePath);
        continue;
      }
      if (entry.isSymlink || !entry.isFile) continue;
      const dot = entry.name.lastIndexOf(".");
      const extension = dot === -1 ? "" : entry.name.slice(dot).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(extension)) continue;
      if (isExcluded(relativePath, input)) {
        excluded++;
        continue;
      }
      files.push(relativePath);
    }
  };
  await visit(input.rootPath, "");
  files.sort((left, right) => left.localeCompare(right));
  return { files, excluded };
}

/** Measures one parsed file into findings and unit-size bands. */
function measureFile(
  file: IParsedHealthFile,
  input: ICollectHealthInput,
  findings: IMeasuredFinding[],
  bands: Record<UnitSizeBand, number>,
): number {
  const options: IMetricOptions = { variant: input.settings.variant, countNullish: input.settings.countNullish };
  for (const unit of file.units) {
    const metrics = measureFunction(unit, options, file.context);
    bands[bandOf(metrics.lines)]++;
    const values: IFindingValues = {
      cyclomatic: metrics.cyclomatic,
      cognitive: metrics.cognitive,
      lines: metrics.lines,
    };
    const severity = worstSeverity(values, input.settings);
    if (severity === null) continue;
    findings.push({
      path: file.path,
      name: metrics.name,
      line: metrics.line,
      col: metrics.column - 1,
      cyclomatic: metrics.cyclomatic,
      cognitive: metrics.cognitive,
      line_count: metrics.lines,
      param_count: metrics.params,
      contributions: metrics.contributions.map((entry) => ({
        metric: entry.metric,
        kind: entry.kind,
        line: entry.line,
        column: entry.column,
        weight: entry.weight,
        nesting: entry.nesting,
      })),
      severity,
      values,
    });
  }
  return file.units.length;
}

/** The severity order used by the severity sort. */
const SEVERITY_ORDER = { moderate: 0, high: 1, critical: 2 };

/** The comparator of the requested sort key, then path, line, col and name. */
function comparatorOf(sort: HealthSortKey): (left: IMeasuredFinding, right: IMeasuredFinding) => number {
  return (left, right) => {
    const primary = sort === "severity"
      ? SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity]
      : sort === "lines"
      ? right.values.lines - left.values.lines
      : sort === "cognitive"
      ? right.values.cognitive - left.values.cognitive
      : right.values.cyclomatic - left.values.cyclomatic;
    if (primary !== 0) return primary;
    return left.path.localeCompare(right.path) || left.line - right.line || left.col - right.col ||
      left.name.localeCompare(right.name);
  };
}

/** Collects the report for one descriptor root. */
export async function collectHealth(input: ICollectHealthInput): Promise<IHealthReport> {
  const { files, excluded } = await sourceFiles(input);
  const findings: IMeasuredFinding[] = [];
  const errors: IHealthError[] = [];
  const bands: Record<UnitSizeBand, number> = { low: 0, medium: 0, high: 0, very_high: 0 };
  let functions = 0;
  let analyzed = 0;
  for (const relativePath of files) {
    try {
      const file = await parseHealthFile(platformJoin(input.rootPath, relativePath), relativePath);
      functions += measureFile(file, input, findings, bands);
      analyzed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ path: relativePath, message });
    }
  }
  findings.sort(comparatorOf(input.sort));
  const reportFindings: IHealthFinding[] = findings.map(({ values: _values, ...finding }) => finding);
  return {
    schema_version: HEALTH_SCHEMA_VERSION,
    formula_version: HEALTH_FORMULA_VERSION,
    tool_version: TOOL_VERSION,
    findings: reportFindings,
    summary: {
      analyzed_files: analyzed,
      excluded_files: excluded,
      failed_files: errors.length,
      functions,
      findings_population: reportFindings.length,
      options: {
        max_cyclomatic: input.settings.maxCyclomatic,
        max_cognitive: input.settings.maxCognitive,
        max_lines: input.settings.maxLines,
        variant: input.settings.variant,
        count_nullish: input.settings.countNullish,
      },
    },
    vital_signs: vitalSignsOf(bands, functions),
    errors,
    limits: { source_bytes: MAX_SOURCE_BYTES },
  };
}
