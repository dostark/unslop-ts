/**
 * @module ReportEntry
 * @path src/report/mod.ts
 * @description Report entry point: collect a host run into findings and coverage, and the report types.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/report/collect.ts, src/report/model.ts]
 */

export { collectRunReport, failingFindings } from "./collect.ts";
export { DEFAULT_HEALTH_FORMAT, DEFAULT_HEALTH_SORT, DEFAULT_HEALTH_TOP } from "./constants.ts";
export { collectHealth, type HealthSortKey, type ICollectHealthInput, type IHealthSettings } from "./health.ts";
export {
  HEALTH_FORMULA_VERSION,
  HEALTH_SCHEMA_VERSION,
  HealthBandSchema,
  HealthContributionSchema,
  HealthErrorSchema,
  HealthFindingSchema,
  HealthLimitsSchema,
  HealthOptionsSchema,
  HealthReportSchema,
  type HealthSeverity,
  HealthSummarySchema,
  HealthVitalSignsSchema,
  type IHealthBand,
  type IHealthContribution,
  type IHealthError,
  type IHealthFinding,
  type IHealthLimits,
  type IHealthOptions,
  type IHealthReport,
  type IHealthSummary,
  type IHealthVitalSigns,
} from "./health_model.ts";
export { type IParsedHealthFile, MAX_SOURCE_BYTES, parseHealthFile } from "./parse.ts";
export type {
  IFinding,
  IHostDiagnostic,
  IHostError,
  ILintRunInput,
  ILintRunResult,
  INotRunCheck,
  IRuleRunSummary,
  IRunReport,
} from "./model.ts";
