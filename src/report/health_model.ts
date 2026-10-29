/**
 * @module HealthModel
 * @path src/report/health_model.ts
 * @description Strict schemas and explicit types of the versioned health report.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/report/health.ts, src/report/mod.ts]
 */

import { z } from "zod";
import {
  METRIC_CONTRIBUTION_KINDS,
  type MetricContributionKind,
  type MetricName,
  type MetricVariant,
} from "../metrics/types.ts";

/** The report schema version this engine writes. */
export const HEALTH_SCHEMA_VERSION = 1;

/** The formula version this engine writes. */
export const HEALTH_FORMULA_VERSION = "unslop-health-v1";

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

/** The complete health report this checkpoint writes. */
export interface IHealthReport {
  readonly schema_version: typeof HEALTH_SCHEMA_VERSION;
  readonly formula_version: typeof HEALTH_FORMULA_VERSION;
  readonly tool_version: string;
  readonly findings: readonly IHealthFinding[];
  readonly file_scores: readonly IHealthFileScore[];
  readonly hotspots: readonly IHealthHotspot[];
  readonly hotspot_summary: IHealthHotspotSummary;
  readonly summary: IHealthSummary;
  readonly vital_signs: IHealthVitalSigns;
  readonly errors: readonly IHealthError[];
  readonly limits: IHealthLimits;
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
  unresolved_specifiers: nonNegativeInteger,
  nonliteral_dynamic_imports: nonNegativeInteger,
  complete: z.boolean(),
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

/** The complete health report this checkpoint writes. */
export const HealthReportSchema: z.ZodType<IHealthReport, IHealthReport> = z.object({
  schema_version: z.literal(HEALTH_SCHEMA_VERSION),
  formula_version: z.literal(HEALTH_FORMULA_VERSION),
  tool_version: z.string().min(1),
  findings: z.array(HealthFindingSchema),
  file_scores: z.array(HealthFileScoreSchema),
  hotspots: z.array(HealthHotspotSchema),
  hotspot_summary: HealthHotspotSummarySchema,
  summary: HealthSummarySchema,
  vital_signs: HealthVitalSignsSchema,
  errors: z.array(HealthErrorSchema),
  limits: HealthLimitsSchema,
}).strict();
