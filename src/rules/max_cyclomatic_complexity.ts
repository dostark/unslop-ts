/**
 * @module MaxCyclomaticComplexity
 * @path src/rules/max_cyclomatic_complexity.ts
 * @description Cyclomatic-complexity limit as a plugin rule on the host ESTree.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/metrics/function_metrics.ts, tests/max_cyclomatic_complexity_test.ts]
 */

import { programOf } from "../engine/type_environment.ts";
import type { JsonValue } from "../engine/catalog.ts";
import { DEFAULT_MAX_CYCLOMATIC, DEFAULT_METRIC_VARIANT } from "../metrics/constants.ts";
import { createMeasurementContext } from "../metrics/context.ts";
import { functionUnits, measureFunction } from "../metrics/function_metrics.ts";
import type { IFunctionUnit, IMetricOptions, MetricVariant } from "../metrics/types.ts";
import type { IPluginRuleContext, IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

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
  const measurement = createMeasurementContext(context.sourceCode, context.filename);
  const units = new Map<IRuleNode, IFunctionUnit>(
    functionUnits(programOf(context.sourceCode), measurement).map((unit) => [unit.node, unit]),
  );
  const check = (rawNode: IRuleNode): void => {
    const unit = units.get(rawNode);
    if (unit === undefined) return;
    const metrics = measureFunction(unit, options, measurement);
    if (metrics.cyclomatic <= max) return;
    context.report({
      node: rawNode,
      message: `Function ${metrics.name} has cyclomatic complexity ${metrics.cyclomatic} (limit ${max}).`,
      hint: "Split the function into smaller, named helpers.",
    });
  };
  return {
    FunctionDeclaration: check,
    FunctionExpression: check,
    ArrowFunctionExpression: check,
  };
}
