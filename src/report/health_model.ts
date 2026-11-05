/**
 * @module HealthModel
 * @path src/report/health_model.ts
 * @description Strict schemas and explicit types of the versioned health report.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/report/health.ts, src/report/mod.ts]
 */

import { z } from "zod";
import type { ClassThresholdName } from "../metrics/class_thresholds.ts";
import type { DerivedMetric } from "./class_statistics.ts";
import type { DesignMetricName, DesignStrategy } from "./design_strategies.ts";
import {
  type IClassMetrics,
  METRIC_CONTRIBUTION_KINDS,
  type MetricContributionKind,
  type MetricName,
  type MetricVariant,
} from "../metrics/types.ts";

/** The report schema version this engine writes. */
export const HEALTH_SCHEMA_VERSION = 2;

/** The formula version this engine writes. */
export const HEALTH_FORMULA_VERSION = "unslop-health-v2";

/** The severity bands of one finding. */
export type HealthSeverity = "moderate" | "high" | "critical";

/** One counted decision of a finding, at its one-based source position. */
export interface IHealthContribution {
  readonly metric: MetricName;
  readonly kind: MetricContributionKind;
  readonly line: number;
  readonly column: number;
  readonly weight: number;
  readonly nesting: number;
}

/** One function finding, with zero-based `col` for fallow interoperability. */
export interface IHealthFinding {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly col: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly line_count: number;
  readonly param_count: number;
  readonly contributions: readonly IHealthContribution[];
  readonly severity: HealthSeverity;
  readonly crap: number;
  readonly coverage_source: CoverageSource;
  readonly coverage_reason: CoverageReason;
  readonly coverage_precision: CoveragePrecision | null;
}

/** Where the coverage percentage of one finding came from. */
export type CoverageSource = "lcov" | "estimated";

/** Why the coverage percentage has its value. */
export type CoverageReason = "measured" | "no_input" | "file_missing" | "no_executable_samples";

/** The precision a measured coverage sample claims. */
export type CoveragePrecision = "line" | "line_ambiguous";

/** The measurement state of one score signal. */
export type HealthScoreSignalStatus = "measured" | "not_measured" | "unavailable";

/** The completeness of one project score. */
export type HealthScoreStatus = "complete" | "partial";

/** One attributed penalty of the project score. */
export interface IHealthScoreSignal {
  readonly signal: string;
  readonly status: HealthScoreSignalStatus;
  readonly raw: number | null;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly penalty: number;
  readonly source: string;
  readonly reason: string | null;
}

/** The project score and its signal ledger. */
export interface IHealthScore {
  readonly value: number;
  readonly grade: "A" | "B" | "C" | "D" | "F" | null;
  readonly status: HealthScoreStatus;
  readonly signals: readonly IHealthScoreSignal[];
}

/** One file hotspot: the qualified churn and density normalized over the population. */
export interface IHealthHotspot {
  readonly path: string;
  readonly commits: number;
  readonly churn: number;
  readonly density: number;
  readonly score: number;
}

/** The history status and the qualifying population of the hotspot report. */
export interface IHealthHotspotSummary {
  readonly available: boolean;
  readonly reason: string | null;
  readonly shallow: boolean;
  readonly since: number;
  readonly min_commits: number;
  readonly population: number;
  readonly qualified: number;
}

/** The coverage input facts of one report. */
export interface IHealthCoverageSummary {
  readonly source: "none" | "lcov";
  readonly file_sha256: string | null;
  readonly snapshot_sha256: string;
  readonly revision: "unverified" | "verified";
  readonly matched_files: number;
  readonly unmatched_files: number;
}

/** One unit-size band: a unit count and its percentage of the measured units. */
export interface IHealthBand {
  readonly count: number;
  readonly percent: number;
}

/** The vital signs this checkpoint measures. */
export interface IHealthVitalSigns {
  readonly unit_size: {
    readonly total: number;
    readonly bands: {
      readonly low: IHealthBand;
      readonly medium: IHealthBand;
      readonly high: IHealthBand;
      readonly very_high: IHealthBand;
    };
  };
  readonly cycles: {
    readonly sccs: number;
    readonly files: number;
    readonly code_files: number;
    readonly per_thousand: number;
  };
  readonly coupling: {
    readonly high_files: number;
    readonly code_files: number;
    readonly percent: number;
    readonly fan_in_limit: number;
    readonly fan_out_limit: number;
  };
}

/** The active measurement contract of one run. */
export interface IHealthOptions {
  readonly max_cyclomatic: number;
  readonly max_cognitive: number;
  readonly max_lines: number;
  readonly max_crap: number;
  readonly variant: MetricVariant;
  readonly count_nullish: boolean;
}

/** One file score: the measured facts and the maintainability index they produce. */
export interface IHealthFileScore {
  readonly path: string;
  readonly lines: number;
  readonly cyclomatic: number;
  readonly module_cyclomatic: number;
  readonly density: number;
  readonly dead_export_ratio: number;
  readonly fan_in: number;
  readonly fan_out: number;
  readonly mi: number;
}

/** The dead-file population of the snapshot. `available` is false when the scan could not run. */
export interface IHealthDeadFiles {
  readonly count: number;
  readonly population: number;
  readonly available: boolean;
}

/** The dependency-graph populations and the limits of the evidence. */
export interface IHealthGraphSummary {
  readonly internal_edges: number;
  readonly runtime_edges: number;
  readonly external_specifiers: number;
  readonly excluded_source_specifiers: number;
  readonly resource_specifiers: number;
  readonly unresolved_specifiers: number;
  readonly nonliteral_dynamic_imports: number;
  readonly complete: boolean;
}

/** The aggregate populations of one run. */
export interface IHealthSummary {
  readonly analyzed_files: number;
  readonly excluded_files: number;
  readonly failed_files: number;
  readonly functions: number;
  readonly findings_population: number;
  readonly file_scores_population: number;
  readonly dead_exports: { readonly total: number; readonly unused: number };
  readonly dead_files: IHealthDeadFiles;
  readonly graph: IHealthGraphSummary;
  readonly options: IHealthOptions;
  readonly coverage: IHealthCoverageSummary;
}

/** One attributed failure. */
export interface IHealthError {
  readonly path: string;
  readonly message: string;
}

/** The named input bounds this checkpoint enforces. */
export interface IHealthLimits {
  readonly source_bytes: number;
  readonly coverage_bytes: number;
  readonly history_bytes: number;
}

/** The design metrics of one class, with its place and the precision of its coupling values. */
export interface IHealthClassScore extends IClassMetrics {
  readonly path: string;
}

/** One detection strategy match with the metric values that made it match. */
export interface IHealthDesignFinding {
  readonly strategy: DesignStrategy;
  readonly path: string;
  readonly class_name: string;
  readonly method_name: string | null;
  readonly line: number;
  readonly metrics: Readonly<Record<DesignMetricName, number | null>>;
}

/** One default threshold with the sources that quote it. */
export interface IHealthThreshold {
  readonly value: number;
  readonly sources: readonly string[];
  readonly retrieved: string;
  readonly label: string;
}

/** The mean, standard deviation and four bands of one metric. */
export interface IHealthBands {
  readonly mean: number;
  readonly sd: number;
  readonly low: number;
  readonly average: number;
  readonly high: number;
  readonly very_high: number;
}

/** The default thresholds and the bands that this project's classes derive. */
export interface IHealthClassThresholds {
  readonly defaults: Readonly<Record<ClassThresholdName, IHealthThreshold>>;
  readonly derived: {
    readonly population: number;
    readonly metrics: Readonly<Partial<Record<DerivedMetric, IHealthBands>>>;
  };
}

/** The limit that a large file passes: the advisory soft limit or the hard limit. */
export type FileLimitLevel = "soft" | "hard";

/** One file above the module size limits. */
export interface IHealthLargeFile {
  readonly path: string;
  readonly lines: number;
  readonly limit: FileLimitLevel;
}

/** The complete health report this checkpoint writes. */
export interface IHealthReport {
  readonly schema_version: typeof HEALTH_SCHEMA_VERSION;
  readonly formula_version: typeof HEALTH_FORMULA_VERSION;
  readonly tool_version: string;
  readonly findings: readonly IHealthFinding[];
  readonly file_scores: readonly IHealthFileScore[];
  readonly hotspots: readonly IHealthHotspot[];
  readonly hotspot_summary: IHealthHotspotSummary;
  readonly health_score: IHealthScore;
  readonly summary: IHealthSummary;
  readonly vital_signs: IHealthVitalSigns;
  readonly errors: readonly IHealthError[];
  readonly limits: IHealthLimits;
  /** The class design section, an unslop extension that the fallow-compatible keys do not read. */
  readonly class_scores: readonly IHealthClassScore[];
  readonly design_findings: readonly IHealthDesignFinding[];
  readonly class_thresholds: IHealthClassThresholds;
  /** The files above the module size limits, an advisory list that the fallow-compatible keys do not read. */
  readonly large_files: readonly IHealthLargeFile[];
}

const finite = z.number().refine(Number.isFinite, "must be finite");
const nonNegativeInteger = z.number().int().nonnegative();
const oneBased = z.number().int().positive();
const severity: z.ZodType<HealthSeverity, HealthSeverity> = z.enum(["moderate", "high", "critical"]);
const metricName: z.ZodType<MetricName, MetricName> = z.enum(["cyclomatic", "cognitive"]);
const contributionKind: z.ZodType<MetricContributionKind, MetricContributionKind> = z.enum(
  METRIC_CONTRIBUTION_KINDS,
);

/** One counted decision of a finding, at its one-based source position. */
export const HealthContributionSchema: z.ZodType<IHealthContribution, IHealthContribution> = z.object({
  metric: metricName,
  kind: contributionKind,
  line: oneBased,
  column: oneBased,
  weight: z.number().positive(),
  nesting: nonNegativeInteger,
}).strict();

/** One function finding, with zero-based `col` for fallow interoperability. */
export const HealthFindingSchema: z.ZodType<IHealthFinding, IHealthFinding> = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  line: oneBased,
  col: nonNegativeInteger,
  cyclomatic: oneBased,
  cognitive: nonNegativeInteger,
  line_count: oneBased,
  param_count: nonNegativeInteger,
  contributions: z.array(HealthContributionSchema),
  severity,
  crap: finite,
  coverage_source: z.enum(["lcov", "estimated"]),
  coverage_reason: z.enum(["measured", "no_input", "file_missing", "no_executable_samples"]),
  coverage_precision: z.enum(["line", "line_ambiguous"]).nullable(),
}).strict();

/** One unit-size band: a unit count and its percentage of the measured units. */
export const HealthBandSchema: z.ZodType<IHealthBand, IHealthBand> = z.object({
  count: nonNegativeInteger,
  percent: finite,
}).strict();

/** The vital signs this checkpoint measures. */
export const HealthVitalSignsSchema: z.ZodType<IHealthVitalSigns, IHealthVitalSigns> = z.object({
  unit_size: z.object({
    total: nonNegativeInteger,
    bands: z.object({
      low: HealthBandSchema,
      medium: HealthBandSchema,
      high: HealthBandSchema,
      very_high: HealthBandSchema,
    }).strict(),
  }).strict(),
  cycles: z.object({
    sccs: nonNegativeInteger,
    files: nonNegativeInteger,
    code_files: nonNegativeInteger,
    per_thousand: finite,
  }).strict(),
  coupling: z.object({
    high_files: nonNegativeInteger,
    code_files: nonNegativeInteger,
    percent: finite,
    fan_in_limit: oneBased,
    fan_out_limit: oneBased,
  }).strict(),
}).strict();

/** The active measurement contract of one run. */
export const HealthOptionsSchema: z.ZodType<IHealthOptions, IHealthOptions> = z.object({
  max_cyclomatic: oneBased,
  max_cognitive: oneBased,
  max_lines: oneBased,
  max_crap: finite,
  variant: z.enum(["classic", "extended"]),
  count_nullish: z.boolean(),
}).strict();

/** One file score: the measured facts and the maintainability index they produce. */
export const HealthFileScoreSchema: z.ZodType<IHealthFileScore, IHealthFileScore> = z.object({
  path: z.string().min(1),
  lines: nonNegativeInteger,
  cyclomatic: nonNegativeInteger,
  module_cyclomatic: nonNegativeInteger,
  density: finite,
  dead_export_ratio: finite,
  fan_in: nonNegativeInteger,
  fan_out: nonNegativeInteger,
  mi: finite,
}).strict();

/** The dead-file population of the snapshot. */
export const HealthDeadFilesSchema: z.ZodType<IHealthDeadFiles, IHealthDeadFiles> = z.object({
  count: nonNegativeInteger,
  population: nonNegativeInteger,
  available: z.boolean(),
}).strict();

/** The dependency-graph populations and the limits of the evidence. */
export const HealthGraphSummarySchema: z.ZodType<IHealthGraphSummary, IHealthGraphSummary> = z.object({
  internal_edges: nonNegativeInteger,
  runtime_edges: nonNegativeInteger,
  external_specifiers: nonNegativeInteger,
  excluded_source_specifiers: nonNegativeInteger,
  resource_specifiers: nonNegativeInteger,
  unresolved_specifiers: nonNegativeInteger,
  nonliteral_dynamic_imports: nonNegativeInteger,
  complete: z.boolean(),
}).strict();

/** One score signal. */
const HealthScoreSignalSchema: z.ZodType<IHealthScoreSignal, IHealthScoreSignal> = z.object({
  signal: z.string().min(1),
  status: z.enum(["measured", "not_measured", "unavailable"]),
  raw: z.number().finite().nullable(),
  numerator: z.number().finite().nullable(),
  denominator: z.number().finite().nullable(),
  penalty: finite,
  source: z.string().min(1),
  reason: z.string().min(1).nullable(),
}).strict();

/** The project score. */
const HealthScoreSchema: z.ZodType<IHealthScore, IHealthScore> = z.object({
  value: finite,
  grade: z.enum(["A", "B", "C", "D", "F"]).nullable(),
  status: z.enum(["complete", "partial"]),
  signals: z.array(HealthScoreSignalSchema),
}).strict();

/** One file hotspot. */
const HealthHotspotSchema: z.ZodType<IHealthHotspot, IHealthHotspot> = z.object({
  path: z.string().min(1),
  commits: nonNegativeInteger,
  churn: finite,
  density: finite,
  score: finite,
}).strict();

/** The history status of one report. */
const HealthHotspotSummarySchema: z.ZodType<IHealthHotspotSummary, IHealthHotspotSummary> = z.object({
  available: z.boolean(),
  reason: z.string().min(1).nullable(),
  shallow: z.boolean(),
  since: nonNegativeInteger,
  min_commits: oneBased,
  population: nonNegativeInteger,
  qualified: nonNegativeInteger,
}).strict();

/** The coverage input facts of one report. */
const HealthCoverageSummarySchema: z.ZodType<IHealthCoverageSummary, IHealthCoverageSummary> = z.object({
  source: z.enum(["none", "lcov"]),
  file_sha256: z.string().min(1).nullable(),
  snapshot_sha256: z.string().min(1),
  revision: z.enum(["unverified", "verified"]),
  matched_files: nonNegativeInteger,
  unmatched_files: nonNegativeInteger,
}).strict();

/** The aggregate populations of one run. */
export const HealthSummarySchema: z.ZodType<IHealthSummary, IHealthSummary> = z.object({
  analyzed_files: nonNegativeInteger,
  excluded_files: nonNegativeInteger,
  failed_files: nonNegativeInteger,
  functions: nonNegativeInteger,
  findings_population: nonNegativeInteger,
  file_scores_population: nonNegativeInteger,
  dead_exports: z.object({ total: nonNegativeInteger, unused: nonNegativeInteger }).strict(),
  dead_files: HealthDeadFilesSchema,
  graph: HealthGraphSummarySchema,
  options: HealthOptionsSchema,
  coverage: HealthCoverageSummarySchema,
}).strict();

/** One attributed failure. */
export const HealthErrorSchema: z.ZodType<IHealthError, IHealthError> = z.object({
  path: z.string().min(1),
  message: z.string().min(1),
}).strict();

/** The named input bounds this checkpoint enforces. */
export const HealthLimitsSchema: z.ZodType<IHealthLimits, IHealthLimits> = z.object({
  source_bytes: oneBased,
  coverage_bytes: oneBased,
  history_bytes: oneBased,
}).strict();

const nullableNumber = finite.nullable();

/** The design metrics of one class. */
const HealthClassScoreSchema: z.ZodType<IHealthClassScore, IHealthClassScore> = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  line: oneBased,
  nom: nonNegativeInteger,
  wmc: nonNegativeInteger,
  loc: nonNegativeInteger,
  noa: nonNegativeInteger,
  tcc: nullableNumber,
  lcom4: nonNegativeInteger,
  atfd: nonNegativeInteger,
  cbo: nonNegativeInteger,
  rfc: nullableNumber,
  dit: nullableNumber,
  noc: nullableNumber,
  woc: nullableNumber,
  noap: nonNegativeInteger,
  noam: nonNegativeInteger,
  precision: z.enum(["syntactic", "typed"]),
}).strict();

/** One detection strategy match. */
const HealthDesignFindingSchema: z.ZodType<IHealthDesignFinding, IHealthDesignFinding> = z.object({
  strategy: z.enum(["god-class", "data-class", "feature-envy"]),
  path: z.string().min(1),
  class_name: z.string().min(1),
  method_name: z.string().min(1).nullable(),
  line: oneBased,
  metrics: z.object({
    wmc: nullableNumber,
    tcc: nullableNumber,
    atfd: nullableNumber,
    woc: nullableNumber,
    laa: nullableNumber,
    fdp: nullableNumber,
    noap: nullableNumber,
    noam: nullableNumber,
  }).strict(),
}).strict();

const thresholdSchema: z.ZodType<IHealthThreshold, IHealthThreshold> = z.object({
  value: finite,
  sources: z.array(z.string().url()).min(1),
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1),
}).strict();

const bandsSchema: z.ZodType<IHealthBands, IHealthBands> = z.object({
  mean: finite,
  sd: finite,
  low: finite,
  average: finite,
  high: finite,
  very_high: finite,
}).strict();

/** The default thresholds and the derived bands. */
const HealthClassThresholdsSchema: z.ZodType<IHealthClassThresholds, IHealthClassThresholds> = z.object({
  defaults: z.object({
    wmcVeryHigh: thresholdSchema,
    tccLimit: thresholdSchema,
    atfdFew: thresholdSchema,
    wmcHigh: thresholdSchema,
    dataClassFew: thresholdSchema,
    dataClassMany: thresholdSchema,
    wocLimit: thresholdSchema,
    laaLimit: thresholdSchema,
    fdpFew: thresholdSchema,
  }).strict(),
  derived: z.object({
    population: nonNegativeInteger,
    metrics: z.object({
      nom: bandsSchema.optional(),
      loc: bandsSchema.optional(),
      wmc: bandsSchema.optional(),
      atfd: bandsSchema.optional(),
      cbo: bandsSchema.optional(),
      rfc: bandsSchema.optional(),
      noap: bandsSchema.optional(),
      noam: bandsSchema.optional(),
    }).strict(),
  }).strict(),
}).strict();

const HealthLargeFileSchema: z.ZodType<IHealthLargeFile, IHealthLargeFile> = z.object({
  path: z.string().min(1),
  lines: oneBased,
  limit: z.enum(["soft", "hard"]),
}).strict();

/** The complete health report this checkpoint writes. */
export const HealthReportSchema: z.ZodType<IHealthReport, IHealthReport> = z.object({
  schema_version: z.literal(HEALTH_SCHEMA_VERSION),
  formula_version: z.literal(HEALTH_FORMULA_VERSION),
  tool_version: z.string().min(1),
  findings: z.array(HealthFindingSchema),
  file_scores: z.array(HealthFileScoreSchema),
  hotspots: z.array(HealthHotspotSchema),
  hotspot_summary: HealthHotspotSummarySchema,
  health_score: HealthScoreSchema,
  summary: HealthSummarySchema,
  vital_signs: HealthVitalSignsSchema,
  errors: z.array(HealthErrorSchema),
  limits: HealthLimitsSchema,
  class_scores: z.array(HealthClassScoreSchema),
  design_findings: z.array(HealthDesignFindingSchema),
  class_thresholds: HealthClassThresholdsSchema,
  large_files: z.array(HealthLargeFileSchema),
}).strict();
