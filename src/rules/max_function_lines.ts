/**
 * @module MaxFunctionLines
 * @path src/rules/max_function_lines.ts
 * @description Function-size limit as a plugin rule on the host ESTree.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/metrics/function_metrics.ts, tests/max_function_lines_test.ts]
 */

import { DEFAULT_COUNT_NULLISH, DEFAULT_MAX_FUNCTION_LINES, DEFAULT_METRIC_VARIANT } from "../metrics/constants.ts";
import type { IMetricOptions } from "../metrics/types.ts";
import type { IPluginRuleContext, IRuleContext, LintVisitor } from "./types.ts";
import { functionMetricLimit } from "./function_metric_limit.ts";

/** The counting options the size metric reads: only the code-token lines matter. */
const SIZE_OPTIONS: IMetricOptions = {
  variant: DEFAULT_METRIC_VARIANT,
  countNullish: DEFAULT_COUNT_NULLISH,
};

/** Builds the rule that reports each function above the line limit. */
export function createMaxFunctionLines(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const max = typeof ctx.options.max === "number" ? ctx.options.max : DEFAULT_MAX_FUNCTION_LINES;
  return functionMetricLimit(context, SIZE_OPTIONS, max, "lines");
}
