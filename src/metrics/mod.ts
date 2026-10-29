/**
 * @module MetricCore
 * @path src/metrics/mod.ts
 * @description Public barrel of the complexity metric core: parser context, units, measurement, and defaults.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/metrics/context.ts, src/metrics/function_metrics.ts, src/rules/max_cyclomatic_complexity.ts]
 */

export {
  DEFAULT_COUNT_NULLISH,
  DEFAULT_MAX_COGNITIVE,
  DEFAULT_MAX_CYCLOMATIC,
  DEFAULT_MAX_FUNCTION_LINES,
  DEFAULT_METRIC_VARIANT,
  METRIC_VARIANTS,
} from "./constants.ts";
export { createMeasurementContext } from "./context.ts";
export { functionUnits, measureFunction, MetricCoreError } from "./function_metrics.ts";
export { METRIC_CONTRIBUTION_KINDS } from "./types.ts";
export type {
  IFunctionMetrics,
  IFunctionUnit,
  IMeasurementContext,
  IMeasurementSource,
  IMetricContribution,
  IMetricOptions,
  IMetricPosition,
  IMetricToken,
  MetricContributionKind,
  MetricName,
  MetricVariant,
} from "./types.ts";
