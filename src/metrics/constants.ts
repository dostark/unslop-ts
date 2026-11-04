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

/** The hard limit of physical lines in one module, above which a file is hard for a reader to load. */
export const DEFAULT_MAX_FILE_LINES = 1000;

/** The cyclomatic variants the engine accepts. */
export const METRIC_VARIANTS = ["classic", "extended"] as const;

/** The variant the engine counts when a catalog does not pin one. */
export const DEFAULT_METRIC_VARIANT: MetricVariant = "extended";

/** The variant that weighted methods per class counts. The God Class limits come from classic McCabe counts. */
export const DEFAULT_CLASS_WMC_VARIANT: MetricVariant = "classic";

/** The strategies of the class-size rule. */
export const CLASS_SIZE_STRATEGIES = ["god-class", "legacy-score"] as const;

/** The strategy that the class-size rule applies when a catalog does not pin one. */
export const DEFAULT_CLASS_SIZE_STRATEGY: (typeof CLASS_SIZE_STRATEGIES)[number] = "god-class";

/** True when the cognitive metric counts nullish-coalescing runs by default. */
export const DEFAULT_COUNT_NULLISH = true;
