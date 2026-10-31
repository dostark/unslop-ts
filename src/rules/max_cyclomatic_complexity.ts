/**
 * @module MaxCyclomaticComplexity
 * @path src/rules/max_cyclomatic_complexity.ts
 * @description Cyclomatic-complexity limit as a plugin rule on the host ESTree.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/metrics/function_metrics.ts, tests/max_cyclomatic_complexity_test.ts]
 */

import type { JsonValue } from "../engine/catalog.ts";
import { DEFAULT_MAX_CYCLOMATIC, DEFAULT_METRIC_VARIANT } from "../metrics/constants.ts";
import type { IMetricOptions, MetricVariant } from "../metrics/types.ts";
import type { IPluginRuleContext, IRuleContext, LintVisitor } from "./types.ts";
import { functionMetricLimit } from "./function_metric_limit.ts";

/** The counting variant a catalog pins, or the engine default. */
function variantOf(options: Record<string, JsonValue>): MetricVariant {
  return options.variant === "classic" ? "classic" : DEFAULT_METRIC_VARIANT;
}

/** Builds the rule that reports each function above the cyclomatic limit. */
export function createMaxCyclomaticComplexity(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const max = typeof ctx.options.max === "number" ? ctx.options.max : DEFAULT_MAX_CYCLOMATIC;
  const options: IMetricOptions = {
    variant: variantOf(ctx.options),
    countNullish: ctx.options.countNullish !== false,
  };
  return functionMetricLimit(context, options, max, "cyclomatic");
}
