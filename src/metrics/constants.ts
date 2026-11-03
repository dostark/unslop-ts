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

/** The variant that weighted methods per class counts. The God Class limits come from classic McCabe counts. */
export const DEFAULT_CLASS_WMC_VARIANT: MetricVariant = "classic";

/** The strategies of the class-size rule. */
export const CLASS_SIZE_STRATEGIES = ["god-class", "legacy-score"] as const;

/** The strategy that the class-size rule applies when a catalog does not pin one. */
export const DEFAULT_CLASS_SIZE_STRATEGY: (typeof CLASS_SIZE_STRATEGIES)[number] = "god-class";

/** The God Class limit of weighted methods per class. */
export const DEFAULT_GOD_CLASS_WMC_VERY_HIGH = 47;

/** The God Class limit of tight class cohesion: a class below it is incoherent. */
export const DEFAULT_GOD_CLASS_TCC_LIMIT = 1 / 3;

/** The God Class limit of access to foreign data: a class above it reaches into other classes. */
export const DEFAULT_GOD_CLASS_ATFD_FEW = 5;

/** True when the cognitive metric counts nullish-coalescing runs by default. */
export const DEFAULT_COUNT_NULLISH = true;
