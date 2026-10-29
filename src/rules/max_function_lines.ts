/**
 * @module MaxFunctionLines
 * @path src/rules/max_function_lines.ts
 * @description Function-size limit as a plugin rule on the host ESTree.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/metrics/function_metrics.ts, tests/max_function_lines_test.ts]
 */

import { programOf } from "../engine/type_environment.ts";
import { DEFAULT_COUNT_NULLISH, DEFAULT_MAX_FUNCTION_LINES, DEFAULT_METRIC_VARIANT } from "../metrics/constants.ts";
import { createMeasurementContext } from "../metrics/context.ts";
import { functionUnits, measureFunction } from "../metrics/function_metrics.ts";
import type { IFunctionUnit, IMetricOptions } from "../metrics/types.ts";
import type { IPluginRuleContext, IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

/** The counting options the size metric reads: only the code-token lines matter. */
const SIZE_OPTIONS: IMetricOptions = {
  variant: DEFAULT_METRIC_VARIANT,
  countNullish: DEFAULT_COUNT_NULLISH,
};

/** Builds the rule that reports each function above the line limit. */
export function createMaxFunctionLines(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const max = typeof ctx.options.max === "number" ? ctx.options.max : DEFAULT_MAX_FUNCTION_LINES;
  const measurement = createMeasurementContext(context.sourceCode, context.filename);
  const units = new Map<IRuleNode, IFunctionUnit>(
    functionUnits(programOf(context.sourceCode), measurement).map((unit) => [unit.node, unit]),
  );
  const check = (rawNode: IRuleNode): void => {
    const unit = units.get(rawNode);
    if (unit === undefined) return;
    const metrics = measureFunction(unit, SIZE_OPTIONS, measurement);
    if (metrics.lines <= max) return;
    context.report({
      node: rawNode,
      message: `Function ${metrics.name} has ${metrics.lines} lines (limit ${max}).`,
      hint: "Split the function into smaller, named helpers.",
    });
  };
  return {
    FunctionDeclaration: check,
    FunctionExpression: check,
    ArrowFunctionExpression: check,
  };
}
