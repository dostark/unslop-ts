/**
 * @module MaxCognitiveComplexity
 * @path src/rules/max_cognitive_complexity.ts
 * @description Cognitive-complexity limit as a plugin rule on the host ESTree.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/metrics/cognitive.ts, tests/max_cognitive_complexity_test.ts]
 */

import { programOf } from "../engine/type_environment.ts";
import { DEFAULT_COUNT_NULLISH, DEFAULT_MAX_COGNITIVE, DEFAULT_METRIC_VARIANT } from "../metrics/constants.ts";
import { createMeasurementContext } from "../metrics/context.ts";
import { functionUnits, measureFunction } from "../metrics/function_metrics.ts";
import type { IFunctionUnit, IMetricOptions } from "../metrics/types.ts";
import type { IPluginRuleContext, IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

/** Builds the rule that reports each function above the cognitive limit. */
export function createMaxCognitiveComplexity(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const max = typeof ctx.options.max === "number" ? ctx.options.max : DEFAULT_MAX_COGNITIVE;
  const options: IMetricOptions = {
    variant: DEFAULT_METRIC_VARIANT,
    countNullish: typeof ctx.options.countNullish === "boolean" ? ctx.options.countNullish : DEFAULT_COUNT_NULLISH,
  };
  const measurement = createMeasurementContext(context.sourceCode, context.filename);
  const units = new Map<IRuleNode, IFunctionUnit>(
    functionUnits(programOf(context.sourceCode), measurement).map((unit) => [unit.node, unit]),
  );
  const check = (rawNode: IRuleNode): void => {
    const unit = units.get(rawNode);
    if (unit === undefined) return;
    const metrics = measureFunction(unit, options, measurement);
    if (metrics.cognitive <= max) return;
    context.report({
      node: rawNode,
      message: `Function ${metrics.name} has cognitive complexity ${metrics.cognitive} (limit ${max}).`,
      hint: "Split the function into smaller, named helpers.",
    });
  };
  return {
    FunctionDeclaration: check,
    FunctionExpression: check,
    ArrowFunctionExpression: check,
  };
}
