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
export {
  deadRatioOf,
  exportPopulationOf,
  type IExportPopulation,
  type IValueExportSite,
  valueExportSitesOf,
} from "./exports.ts";
export {
  buildHealthGraph,
  type IGraphEdge,
  type IGraphLimitations,
  type IHealthGraph,
  resolveSpecifier,
} from "./graph.ts";
export {
  assertCoverageManifest,
  collectFunctionRows,
  collectHealth,
  type HealthSortKey,
  type ICollectHealthInput,
  type IFunctionRowCollection,
  type IHealthSettings,
  type IMeasuredFunction,
} from "./health.ts";
export {
  type IMaintainabilityInput,
  type MaintainabilityBand,
  maintainabilityBandOf,
  maintainabilityIndexOf,
  MI_GOOD,
  MI_MODERATE,
} from "./maintainability.ts";
export {
  coverageOfUnit,
  type CoveragePrecision,
  type CoverageReason,
  type CoverageSource,
  crapBandOf,
  crapOf,
  DIRECT_COVERAGE_PERCENT,
  estimatedCoverageOf,
  type ICoverageSample,
  INDIRECT_COVERAGE_PERCENT,
  type RuntimeReach,
  UNREACHABLE_COVERAGE_PERCENT,
} from "./crap.ts";
export { type ILcovCoverage, type ILcovFileCoverage, parseLcov } from "./lcov.ts";
export {
  HEALTH_FORMULA_VERSION,
  HEALTH_SCHEMA_VERSION,
  HealthBandSchema,
  HealthContributionSchema,
  HealthDeadFilesSchema,
  HealthErrorSchema,
  HealthFileScoreSchema,
  HealthFindingSchema,
  HealthGraphSummarySchema,
  HealthLimitsSchema,
  HealthOptionsSchema,
  HealthReportSchema,
  type HealthSeverity,
  HealthSummarySchema,
  HealthVitalSignsSchema,
  type IHealthBand,
  type IHealthContribution,
  type IHealthDeadFiles,
  type IHealthError,
  type IHealthFileScore,
  type IHealthFinding,
  type IHealthGraphSummary,
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
