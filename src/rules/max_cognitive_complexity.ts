/**
 * @module MaxCognitiveComplexity
 * @path src/rules/max_cognitive_complexity.ts
 * @description Cognitive-complexity limit as a plugin rule on the host ESTree.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/metrics/cognitive.ts, tests/max_cognitive_complexity_test.ts]
 */

import { DEFAULT_COUNT_NULLISH, DEFAULT_MAX_COGNITIVE, DEFAULT_METRIC_VARIANT } from "../metrics/constants.ts";
import type { IMetricOptions } from "../metrics/types.ts";
import type { IPluginRuleContext, IRuleContext, LintVisitor } from "./types.ts";
import { functionMetricLimit } from "./function_metric_limit.ts";

/** Builds the rule that reports each function above the cognitive limit. */
export function createMaxCognitiveComplexity(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const max = typeof ctx.options.max === "number" ? ctx.options.max : DEFAULT_MAX_COGNITIVE;
  const options: IMetricOptions = {
    variant: DEFAULT_METRIC_VARIANT,
    countNullish: typeof ctx.options.countNullish === "boolean" ? ctx.options.countNullish : DEFAULT_COUNT_NULLISH,
  };
  return functionMetricLimit(context, options, max, "cognitive");
}
