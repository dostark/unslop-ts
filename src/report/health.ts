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
import { measureFunction, ownedLineNumbers } from "../metrics/function_metrics.ts";
import type { IMetricOptions, MetricVariant } from "../metrics/types.ts";
import type { IDuplicateCodeSettings } from "../rules/whole_tree/options.ts";
import type { TJscpdRunner } from "../rules/whole_tree/duplicate_code.ts";
import { couplingSignalOf, runtimeCyclesOf } from "../rules/whole_tree/import_cycles.ts";
import { checkManifestRepository } from "../rules/whole_tree/unused_files_manifest.ts";
import { coverageOfUnit, crapBandOf, crapOf, type RuntimeReach } from "./crap.ts";
import { collectChurn, hotspotScoresOf, type IHotspotScore } from "./churn.ts";
import { deadRatioOf, exportPopulationOf, moduleGraphOf } from "./exports.ts";
import { HEALTH_WALK_SKIP_PATTERNS, MAX_GIT_HISTORY_BYTES } from "./constants.ts";
import { type IDuplicationMeasurement, measureDuplication } from "./duplication.ts";
import { type ILcovCoverage, MAX_LCOV_BYTES, parseLcov } from "./lcov.ts";
import {
  CRITICAL_COMPLEXITY,
  CRITICAL_UNIT_LINES,
  healthScoreOf,
  type IScoreInput,
  LOW_MAINTAINABILITY,
  scoreSignalsOf,
} from "./health_score.ts";
import { readImportAliases } from "./aliases.ts";
import { buildHealthGraph, type IHealthGraph } from "./graph.ts";
import {
  HEALTH_FORMULA_VERSION,
  HEALTH_SCHEMA_VERSION,
  type IHealthContribution,
  type IHealthCoverageSummary,
  type IHealthDeadFiles,
  type IHealthError,
  type IHealthFileScore,
  type IHealthFinding,
  type IHealthHotspotSummary,
  type IHealthReport,
  type IHealthScore,
  type IHealthVitalSigns,
} from "./health_model.ts";
import { maintainabilityIndexOf } from "./maintainability.ts";
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
  readonly maxCrap: number;
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
  /** The raw LCOV text, or null when the run has no coverage input. */
  readonly coverageText: string | null;
  /** The declared public-entry globs of the unused-exports policy. */
  readonly publicEntries: readonly string[];
  /** The descriptor test globs, which decide the direct and indirect coverage fallback. */
  readonly testGlobs: readonly string[];
  /** The SHA-256 of the coverage input file, or null. */
  readonly coverageSha256: string | null;
  /** The optional adjacent manifest of measured source hashes, or null. */
  readonly coverageManifest: Record<string, string> | null;
  /** The epoch boundary of the history window. */
  readonly sinceEpoch: number;
  /** The commits a file needs before it qualifies as a hotspot. */
  readonly minCommits: number;
  /** The captured UTC clock of this run, in epoch seconds. */
  readonly nowEpoch: number;
  /** The compiled duplication settings, or null when the catalog has no duplicate-code rule. */
  readonly duplication: IDuplicateCodeSettings | null;
  /** The validated local jscpd runner, or null when it is unavailable. */
  readonly duplicateRunner: TJscpdRunner | null;
}

/** The measured values a finding reports. */
interface IFindingValues {
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly lines: number;
  readonly crap: number;
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
  if (values.crap >= settings.maxCrap) {
    const band = crapBandOf(values.crap);
    bands.push(band === "critical" ? "critical" : band === "high" ? "high" : "moderate");
  }
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
function vitalSignsOf(
  bands: Readonly<Record<UnitSizeBand, number>>,
  total: number,
  graph: IHealthGraph,
  codeFiles: number,
): IHealthVitalSigns {
  const band = (count: number) => ({ count, percent: percentOf(count, total) });
  const cycles = runtimeCyclesOf(graph.edges);
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
    cycles: {
      sccs: cycles.sccs,
      files: cycles.files,
      code_files: codeFiles,
      per_thousand: codeFiles === 0 ? 0 : (cycles.sccs / codeFiles) * 1000,
    },
    coupling: couplingSignalOf(graph.edges, codeFiles),
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

/** The code-token line numbers of one file. */
function tokenLinesOf(file: IParsedHealthFile): Set<number> {
  const lines = new Set<number>();
  for (const token of file.context.tokens) {
    const first = file.context.positionAt(token.start).line;
    const last = token.end > token.start ? file.context.positionAt(token.end - 1).line : first;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  return lines;
}

/** The unique code-token lines of one file. */
function uniqueLinesOf(file: IParsedHealthFile): number {
  return tokenLinesOf(file).size;
}

/** The measured facts of one file that the file score reads. */
interface IFileFacts {
  readonly functions: number;
  readonly cyclomatic: number;
  readonly lines: number;
  readonly critical: number;
  readonly overSize: number;
}

/** The coverage facts of one file that its units inherit. */
interface IFileCoverage {
  readonly file: { readonly lines: ReadonlyMap<number, number> } | undefined;
  readonly hasInput: boolean;
  readonly reach: RuntimeReach;
  readonly shared: ReadonlySet<number>;
}

/** One measured function row: the facts the calibration compares with another tool. */
export interface IMeasuredFunction {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  /** Zero-based UTF-16 column, matching the engine positions. */
  readonly col: number;
  /** Zero-based UTF-8 byte column, matching the external report's column base. */
  readonly byte_col: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly line_count: number;
  readonly param_count: number;
  readonly contributions: readonly IHealthContribution[];
}

/** The UTF-8 byte length of the line before an offset, which is how the external report counts columns. */
function byteColumnAt(text: string, offset: number): number {
  const lineStart = text.lastIndexOf("\n", Math.max(offset - 1, 0)) + 1;
  let bytes = 0;
  for (let index = lineStart; index < offset; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** The counting options one measurement reads. */
function metricOptions(settings: IHealthSettings): IMetricOptions {
  return { variant: settings.variant, countNullish: settings.countNullish };
}

/** Every measured function of one parsed file, in source order. */
function measuredRowsOf(file: IParsedHealthFile, settings: IHealthSettings): IMeasuredFunction[] {
  return file.units.map((unit) => {
    const metrics = measureFunction(unit, metricOptions(settings), file.context);
    return {
      path: file.path,
      name: metrics.name,
      line: metrics.line,
      col: metrics.column - 1,
      byte_col: byteColumnAt(file.text, unit.range[0]),
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
    };
  });
}

/** Measures one parsed file into findings and unit-size bands. */
function measureFile(
  file: IParsedHealthFile,
  input: ICollectHealthInput,
  findings: IMeasuredFinding[],
  bands: Record<UnitSizeBand, number>,
  coverage: IFileCoverage,
): IFileFacts {
  let cyclomatic = 0;
  let critical = 0;
  let overSize = 0;
  const rows = measuredRowsOf(file, input.settings);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    cyclomatic += row.cyclomatic;
    if (row.cyclomatic > CRITICAL_COMPLEXITY) critical++;
    if (row.line_count > CRITICAL_UNIT_LINES) overSize++;
    bands[bandOf(row.line_count)]++;
    const sample = coverageOfUnit(
      ownedLineNumbers(file.units[index], file.context),
      coverage.file,
      coverage.hasInput,
      coverage.reach,
      coverage.shared,
    );
    const values: IFindingValues = {
      cyclomatic: row.cyclomatic,
      cognitive: row.cognitive,
      lines: row.line_count,
      crap: crapOf(row.cyclomatic, sample.percent),
    };
    const severity = worstSeverity(values, input.settings);
    if (severity === null) continue;
    const { byte_col: _byteCol, ...findingRow } = row;
    findings.push({
      ...findingRow,
      severity,
      values,
      crap: values.crap,
      coverage_source: sample.source,
      coverage_reason: sample.reason,
      coverage_precision: sample.precision,
    });
  }
  return { functions: file.units.length, cyclomatic, lines: uniqueLinesOf(file), critical, overSize };
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

/** The runtime reach of every module from the descriptor test globs. */
function reachabilityOf(graph: IHealthGraph, testGlobs: readonly string[]): Map<string, RuntimeReach> {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== "runtime") continue;
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }
  const reach = new Map<string, RuntimeReach>();
  const queue: string[] = [];
  for (const [from, targets] of adjacency) {
    if (!matchesAnyGlob(from, testGlobs)) continue;
    for (const target of targets) {
      if (reach.has(target)) continue;
      reach.set(target, "direct");
      queue.push(target);
    }
  }
  while (queue.length > 0) {
    const from = queue.shift() ?? "";
    for (const target of adjacency.get(from) ?? []) {
      if (reach.has(target)) continue;
      reach.set(target, "indirect");
      queue.push(target);
    }
  }
  return reach;
}

/** The lines more than one unit owns in one file, so a shared DA sample reports ambiguous precision. */
function sharedLinesOf(file: IParsedHealthFile): Set<number> {
  const counts = new Map<number, number>();
  for (const unit of file.units) {
    for (const line of ownedLineNumbers(unit, file.context)) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([line]) => line));
}

/** The lowercase hex form of a SHA-256 digest. */
function hexOf(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The aggregate SHA-256 of the measured snapshot, so a report can cite its exact source bytes. */
async function snapshotSha256(parsed: ReadonlyMap<string, IParsedHealthFile>): Promise<string> {
  const text = [...parsed]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, file]) => `${path}:${file.sha256}`)
    .join("\n");
  return hexOf(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** The aggregate SHA-256 of the source bytes on disk, read again after a child scan. */
async function digestOfRoot(rootPath: string, paths: Iterable<string>): Promise<string> {
  const parts: string[] = [];
  for (const path of [...paths].sort()) {
    const bytes = await Deno.readFile(platformJoin(rootPath, path));
    parts.push(`${path}:${hexOf(await crypto.subtle.digest("SHA-256", bytes))}`);
  }
  return hexOf(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n"))));
}

/** The dead-file population of the measured snapshot, or an unavailable result when the scan fails. */
async function deadFilesOf(rootPath: string, measured: ReadonlySet<string>): Promise<IHealthDeadFiles> {
  try {
    const report = await checkManifestRepository(rootPath, {
      walkSkipPatterns: [...HEALTH_WALK_SKIP_PATTERNS],
      extraEntries: [],
      referenceGlobs: [],
    });
    return {
      count: report.findings.filter((finding) => measured.has(finding.repoPath)).length,
      population: measured.size,
      available: true,
    };
  } catch {
    return { count: 0, population: measured.size, available: false };
  }
}

/** The parsed files of one root, with the failures attributed. */
interface ISnapshot {
  readonly parsed: Map<string, IParsedHealthFile>;
  readonly errors: IHealthError[];
  readonly excluded: number;
}

/** Parses every measured file once, attributing each failure. */
async function parseSnapshot(input: ICollectHealthInput): Promise<ISnapshot> {
  const { files, excluded } = await sourceFiles(input);
  const parsed = new Map<string, IParsedHealthFile>();
  const errors: IHealthError[] = [];
  for (const relativePath of files) {
    try {
      parsed.set(
        relativePath,
        await parseHealthFile(platformJoin(input.rootPath, relativePath), relativePath),
      );
    } catch (error) {
      errors.push({ path: relativePath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { parsed, errors, excluded };
}

/** Every measured function of one root, with the failures and exclusions attributed. */
export interface IFunctionRowCollection {
  readonly rows: readonly IMeasuredFunction[];
  readonly errors: readonly IHealthError[];
  readonly excluded: number;
}

/** Every measured function of one root, for calibration against another tool. */
export async function collectFunctionRows(input: ICollectHealthInput): Promise<IFunctionRowCollection> {
  const { parsed, errors, excluded } = await parseSnapshot(input);
  const rows: IMeasuredFunction[] = [];
  for (const file of parsed.values()) rows.push(...measuredRowsOf(file, input.settings));
  return { rows, errors, excluded };
}

/** The per-file scores and the total function count. */
function fileScoresOf(
  facts: ReadonlyMap<string, IFileFacts>,
  exports: ReturnType<typeof exportPopulationOf>,
  graph: IHealthGraph,
): { scores: IHealthFileScore[]; functions: number } {
  let functions = 0;
  const scores: IHealthFileScore[] = [];
  for (const [path, measured] of facts) {
    functions += measured.functions;
    const exportsForPath = exports.byPath.get(path) ?? { total: 0, unused: 0 };
    const deadExportRatio = deadRatioOf(exportsForPath.total, exportsForPath.unused);
    const fanOut = graph.fanOut.get(path) ?? 0;
    scores.push({
      path,
      lines: measured.lines,
      cyclomatic: measured.cyclomatic,
      density: measured.lines === 0 ? 0 : measured.cyclomatic / measured.lines,
      dead_export_ratio: deadExportRatio,
      fan_in: graph.fanIn.get(path) ?? 0,
      fan_out: fanOut,
      mi: maintainabilityIndexOf({
        fileLines: measured.lines,
        cyclomatic: measured.cyclomatic,
        deadExportRatio,
        fanOut,
      }),
    });
  }
  scores.sort((left, right) => left.path.localeCompare(right.path));
  return { scores, functions };
}

/** The duplication measurement, or the attributed reason it is absent. */
async function duplicationOf(
  input: ICollectHealthInput,
  parsed: ReadonlyMap<string, IParsedHealthFile>,
  tokenLines: ReadonlyMap<string, ReadonlySet<number>>,
): Promise<IDuplicationMeasurement> {
  if (input.duplication === null) {
    return { available: false, reason: "no-duplication-settings", lines: 0, total_lines: 0 };
  }
  if (input.duplicateRunner === null) {
    return { available: false, reason: "duplication-runner-unavailable", lines: 0, total_lines: 0 };
  }
  return await measureDuplication({
    rootPath: input.rootPath,
    settings: input.duplication,
    runner: input.duplicateRunner,
    tokenLines,
    snapshotDigest: () => digestOfRoot(input.rootPath, parsed.keys()),
  });
}

/** The project score of one collected report. */
async function scoreReportOf(
  input: ICollectHealthInput,
  parsed: ReadonlyMap<string, IParsedHealthFile>,
  facts: ReadonlyMap<string, IFileFacts>,
  fileScores: readonly IHealthFileScore[],
  graph: IHealthGraph,
  hotspotReport: { hotspots: readonly IHotspotScore[]; summary: IHealthHotspotSummary },
  deadFiles: IHealthDeadFiles,
  exports: { readonly unused: number; readonly total: number },
  functions: number,
  failedFiles: number,
  cycles: { readonly sccs: number; readonly files: number },
  couplingHigh: number,
): Promise<IHealthScore> {
  const tokenLines = new Map([...parsed].map(([path, file]) => [path, tokenLinesOf(file)]));
  const duplication = await duplicationOf(input, parsed, tokenLines);
  const functionFiles = [...facts.values()].filter((fact) => fact.functions > 0).length;
  const lowMaintainability =
    fileScores.filter((score) => (facts.get(score.path)?.functions ?? 0) > 0 && score.mi < LOW_MAINTAINABILITY).length;
  const critical = [...facts.values()].reduce((sum, fact) => sum + fact.critical, 0);
  const overSize = [...facts.values()].reduce((sum, fact) => sum + fact.overSize, 0);
  const scoreInput: IScoreInput = {
    deadFiles: { count: deadFiles.count, population: deadFiles.population, available: deadFiles.available },
    deadExports: { unused: exports.unused, total: exports.total },
    complexity: { critical, units: functions, parseFailed: failedFiles > 0 },
    maintainability: { low: lowMaintainability, files: functionFiles },
    hotspots: {
      count: hotspotReport.hotspots.filter((hotspot) => hotspot.score >= 50).length,
      files: parsed.size,
      available: hotspotReport.summary.available && !hotspotReport.summary.shallow,
      reason: hotspotReport.summary.reason ??
        (hotspotReport.summary.shallow ? "shallow-history" : "history-unavailable"),
    },
    cycles: { sccs: cycles.sccs, files: cycles.files, complete: graph.complete },
    unitSize: { over: overSize, units: functions, parseFailed: failedFiles > 0 },
    coupling: { high: couplingHigh, files: parsed.size, complete: graph.complete },
    duplication: {
      lines: duplication.lines,
      total: duplication.total_lines,
      available: duplication.available,
      reason: duplication.reason,
    },
  };
  return healthScoreOf(scoreSignalsOf(scoreInput));
}

/** The hotspot scores and their history status. */
async function hotspotReportOf(
  input: ICollectHealthInput,
  parsed: ReadonlyMap<string, IParsedHealthFile>,
  facts: ReadonlyMap<string, IFileFacts>,
): Promise<{ hotspots: readonly IHotspotScore[]; summary: IHealthHotspotSummary }> {
  const churn = await collectChurn(input.rootPath, input.sinceEpoch, input.nowEpoch, new Set(parsed.keys()));
  const densities = new Map([...facts].map(([path, fact]) => [
    path,
    fact.lines === 0 ? 0 : fact.cyclomatic / fact.lines,
  ]));
  const hotspots = hotspotScoresOf(churn, densities, input.minCommits);
  return {
    hotspots,
    summary: {
      available: churn.available,
      reason: churn.reason,
      shallow: churn.shallow,
      since: input.sinceEpoch,
      min_commits: input.minCommits,
      population: churn.files.size,
      qualified: hotspots.length,
    },
  };
}

/** The coverage input facts of one report, with the freshness limits stated. */
async function coverageSummaryOf(
  input: ICollectHealthInput,
  coverage: ILcovCoverage | null,
  parsed: ReadonlyMap<string, IParsedHealthFile>,
): Promise<IHealthCoverageSummary> {
  return {
    source: coverage === null ? "none" : "lcov",
    file_sha256: input.coverageSha256,
    snapshot_sha256: await snapshotSha256(parsed),
    revision: input.coverageManifest === null ? "unverified" : "verified",
    matched_files: coverage?.files.size ?? 0,
    unmatched_files: coverage?.unmatched.length ?? 0,
  };
}

/** Rejects a supplied coverage manifest that disagrees with the measured snapshot hashes. */
export function assertCoverageManifest(
  manifest: Record<string, string> | null,
  parsed: ReadonlyMap<string, IParsedHealthFile>,
): void {
  for (const [path, hash] of Object.entries(manifest ?? {})) {
    const file = parsed.get(path);
    if (file === undefined || file.sha256 !== hash) {
      throw new Error(`the coverage manifest disagrees with the measured source hash of '${path}'`);
    }
  }
}

/** The raw export population of the snapshot, resolved against the project import graph. */
async function exportsOf(
  parsed: ReadonlyMap<string, IParsedHealthFile>,
  input: ICollectHealthInput,
): Promise<ReturnType<typeof exportPopulationOf>> {
  const graph = await moduleGraphOf(parsed, { rootPath: input.rootPath, publicEntries: input.publicEntries });
  return exportPopulationOf(parsed, graph);
}

/** Collects the report for one descriptor root. */
export async function collectHealth(input: ICollectHealthInput): Promise<IHealthReport> {
  const { parsed, errors, excluded } = await parseSnapshot(input);
  assertCoverageManifest(input.coverageManifest, parsed);
  const coverage: ILcovCoverage | null = input.coverageText === null
    ? null
    : parseLcov(input.coverageText, input.rootPath, new Set(parsed.keys()));
  const graph = buildHealthGraph(parsed, await readImportAliases(input.rootPath));
  const exports = await exportsOf(parsed, input);
  const reach = reachabilityOf(graph, input.testGlobs);
  const findings: IMeasuredFinding[] = [];
  const bands: Record<UnitSizeBand, number> = { low: 0, medium: 0, high: 0, very_high: 0 };
  const facts = new Map<string, IFileFacts>();
  for (const [relativePath, file] of parsed) {
    facts.set(
      relativePath,
      measureFile(file, input, findings, bands, {
        file: coverage?.files.get(relativePath),
        hasInput: coverage !== null,
        reach: reach.get(relativePath) ?? "none",
        shared: sharedLinesOf(file),
      }),
    );
  }
  const { scores: fileScores, functions } = fileScoresOf(facts, exports, graph);
  findings.sort(comparatorOf(input.sort));
  const reportFindings: IHealthFinding[] = findings.map(({ values: _values, ...finding }) => finding);
  const deadFiles = await deadFilesOf(input.rootPath, new Set(parsed.keys()));
  const coverageSummary = await coverageSummaryOf(input, coverage, parsed);
  const hotspotReport = await hotspotReportOf(input, parsed, facts);
  const vitalSigns = vitalSignsOf(bands, functions, graph, parsed.size);
  const scoreReport = await scoreReportOf(
    input,
    parsed,
    facts,
    fileScores,
    graph,
    hotspotReport,
    deadFiles,
    exports,
    functions,
    errors.length,
    vitalSigns.cycles,
    vitalSigns.coupling.high_files,
  );
  return {
    schema_version: HEALTH_SCHEMA_VERSION,
    formula_version: HEALTH_FORMULA_VERSION,
    tool_version: TOOL_VERSION,
    findings: reportFindings,
    file_scores: fileScores,
    hotspots: hotspotReport.hotspots,
    hotspot_summary: hotspotReport.summary,
    health_score: scoreReport,
    summary: {
      analyzed_files: parsed.size,
      excluded_files: excluded,
      failed_files: errors.length,
      functions,
      findings_population: reportFindings.length,
      file_scores_population: fileScores.length,
      dead_exports: { total: exports.total, unused: exports.unused },
      dead_files: deadFiles,
      graph: {
        internal_edges: graph.edges.length,
        runtime_edges: graph.edges.filter((edge) => edge.kind === "runtime").length,
        external_specifiers: graph.limitations.external,
        unresolved_specifiers: graph.limitations.unresolved,
        nonliteral_dynamic_imports: graph.limitations.nonliteral_dynamic,
        complete: graph.complete,
      },
      coverage: coverageSummary,
      options: {
        max_cyclomatic: input.settings.maxCyclomatic,
        max_cognitive: input.settings.maxCognitive,
        max_lines: input.settings.maxLines,
        max_crap: input.settings.maxCrap,
        variant: input.settings.variant,
        count_nullish: input.settings.countNullish,
      },
    },
    vital_signs: vitalSigns,
    errors,
    limits: {
      source_bytes: MAX_SOURCE_BYTES,
      coverage_bytes: MAX_LCOV_BYTES,
      history_bytes: MAX_GIT_HISTORY_BYTES,
    },
  };
}
