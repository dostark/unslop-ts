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
}

/** The active measurement contract of one run. */
export interface IHealthOptions {
  readonly max_cyclomatic: number;
  readonly max_cognitive: number;
  readonly max_lines: number;
  readonly variant: MetricVariant;
  readonly count_nullish: boolean;
}

/** The aggregate populations of one run. */
export interface IHealthSummary {
  readonly analyzed_files: number;
  readonly excluded_files: number;
  readonly failed_files: number;
  readonly functions: number;
  readonly findings_population: number;
  readonly options: IHealthOptions;
}

/** One attributed failure. */
export interface IHealthError {
  readonly path: string;
  readonly message: string;
}

/** The named input bounds this checkpoint enforces. */
export interface IHealthLimits {
  readonly source_bytes: number;
}

/** The complete health report this checkpoint writes. */
export interface IHealthReport {
  readonly schema_version: typeof HEALTH_SCHEMA_VERSION;
  readonly formula_version: typeof HEALTH_FORMULA_VERSION;
  readonly tool_version: string;
  readonly findings: readonly IHealthFinding[];
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
}).strict();

/** The active measurement contract of one run. */
export const HealthOptionsSchema: z.ZodType<IHealthOptions, IHealthOptions> = z.object({
  max_cyclomatic: oneBased,
  max_cognitive: oneBased,
  max_lines: oneBased,
  variant: z.enum(["classic", "extended"]),
  count_nullish: z.boolean(),
}).strict();

/** The aggregate populations of one run. */
export const HealthSummarySchema: z.ZodType<IHealthSummary, IHealthSummary> = z.object({
  analyzed_files: nonNegativeInteger,
  excluded_files: nonNegativeInteger,
  failed_files: nonNegativeInteger,
  functions: nonNegativeInteger,
  findings_population: nonNegativeInteger,
  options: HealthOptionsSchema,
}).strict();

/** One attributed failure. */
export const HealthErrorSchema: z.ZodType<IHealthError, IHealthError> = z.object({
  path: z.string().min(1),
  message: z.string().min(1),
}).strict();

/** The named input bounds this checkpoint enforces. */
export const HealthLimitsSchema: z.ZodType<IHealthLimits, IHealthLimits> = z.object({
  source_bytes: oneBased,
}).strict();

/** The complete health report this checkpoint writes. */
export const HealthReportSchema: z.ZodType<IHealthReport, IHealthReport> = z.object({
  schema_version: z.literal(HEALTH_SCHEMA_VERSION),
  formula_version: z.literal(HEALTH_FORMULA_VERSION),
  tool_version: z.string().min(1),
  findings: z.array(HealthFindingSchema),
  summary: HealthSummarySchema,
  vital_signs: HealthVitalSignsSchema,
  errors: z.array(HealthErrorSchema),
  limits: HealthLimitsSchema,
}).strict();
