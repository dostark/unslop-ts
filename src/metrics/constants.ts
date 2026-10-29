/**
 * @module MetricConstants
 * @path src/metrics/constants.ts
 * @description Named defaults and variants of the complexity metric core.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/metrics/mod.ts, src/rules/rule_options.ts]
 */

import type { MetricVariant } from "./types.ts";

/** The gate limit of the cyclomatic metric, matching the NIST range. */
export const DEFAULT_MAX_CYCLOMATIC = 15;

/** The gate limit of the cognitive metric, matching the SonarSource default. */
export const DEFAULT_MAX_COGNITIVE = 15;

/** The gate limit of the function-size metric, matching the SIG very-high band. */
export const DEFAULT_MAX_FUNCTION_LINES = 60;

/** The cyclomatic variants the engine accepts. */
export const METRIC_VARIANTS = ["classic", "extended"] as const;

/** The variant the engine counts when a catalog does not pin one. */
export const DEFAULT_METRIC_VARIANT: MetricVariant = "extended";

/** True when the cognitive metric counts nullish-coalescing runs by default. */
export const DEFAULT_COUNT_NULLISH = true;
