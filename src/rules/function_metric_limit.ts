/**
 * @module FunctionMetricLimit
 * @path src/rules/function_metric_limit.ts
 * @description Shared function discovery and limit reporting for the three metric rules.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/max_cognitive_complexity.ts, src/rules/max_cyclomatic_complexity.ts, src/rules/max_function_lines.ts]
 */
import { programOf } from "../engine/type_environment.ts";
import { createMeasurementContext } from "../metrics/context.ts";
import { functionUnits, measureFunction } from "../metrics/function_metrics.ts";
import type { IFunctionUnit, IMetricOptions } from "../metrics/types.ts";
import type { IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

/** Measures each function once when its host visitor runs and reports a limit breach. */
export function functionMetricLimit(
  context: IRuleContext,
  options: IMetricOptions,
  max: number,
  metric: "cyclomatic" | "cognitive" | "lines",
): LintVisitor {
  const measurement = createMeasurementContext(context.sourceCode, context.filename);
  const units = new Map<IRuleNode, IFunctionUnit>(
    functionUnits(programOf(context.sourceCode), measurement).map((unit) => [unit.node, unit]),
  );
  const check = (node: IRuleNode): void => {
    const unit = units.get(node);
    if (unit === undefined) return;
    const measured = measureFunction(unit, options, measurement);
    if (measured[metric] <= max) return;
    const description = metric === "lines" ? `${measured.lines} lines` : `${metric} complexity ${measured[metric]}`;
    context.report({
      node,
      message: `Function ${measured.name} has ${description} (limit ${max}).`,
      hint: "Split the function into smaller, named helpers.",
    });
  };
  return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check };
}
