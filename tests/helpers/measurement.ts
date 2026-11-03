/**
 * @module MeasurementTestHelper
 * @path tests/helpers/measurement.ts
 * @description Shared helpers that measure source text through the metric core on a real host AST.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/metrics/mod.ts, tests/max_cyclomatic_complexity_test.ts, tests/metric_context_test.ts]
 */

import { createMeasurementContext } from "../../src/metrics/context.ts";
import { functionUnits, measureFunction } from "../../src/metrics/function_metrics.ts";
import type { IFunctionMetrics, IMeasurementContext, IMetricOptions } from "../../src/metrics/types.ts";
import type { IRuleNode } from "../../src/rules/types.ts";

/** The counting options the engine applies by default. */
export const EXTENDED_OPTIONS: IMetricOptions = { variant: "extended", countNullish: true };

/** The counting options that keep the legacy cyclomatic count. */
export const CLASSIC_OPTIONS: IMetricOptions = { variant: "classic", countNullish: true };

/** The path a test fixture lints as, which selects the production scope. */
export const FIXTURE_PATH = "packages/x/src/a.ts";

/** One measured unit together with the context that measured it. */
export interface IMeasuredSource {
  readonly context: IMeasurementContext;
  readonly metrics: readonly IFunctionMetrics[];
}

/** Captures the Deno host AST of one source unit, the tree every Deno rule receives. */
export function denoProgram(source: string, filename = FIXTURE_PATH): IRuleNode {
  let captured: IRuleNode | undefined;
  const plugin: Deno.lint.Plugin = {
    name: "capture",
    rules: {
      ast: {
        create(context) {
          captured = context.sourceCode.ast;
          return {};
        },
      },
    },
  };
  Deno.lint.runPlugin(plugin, filename, source);
  if (captured === undefined) throw new Error("The Deno host supplied no AST.");
  return captured;
}

/** Measures every function unit of a source unit on the Deno host AST. */
export function measureAll(
  source: string,
  options: IMetricOptions = EXTENDED_OPTIONS,
  filename = FIXTURE_PATH,
): readonly IFunctionMetrics[] {
  return measureWithContext(source, options, filename).metrics;
}

/** Measures every function unit and returns the context, for position assertions. */
export function measureWithContext(
  source: string,
  options: IMetricOptions = EXTENDED_OPTIONS,
  filename = FIXTURE_PATH,
): IMeasuredSource {
  const context = createMeasurementContext({ text: source }, filename);
  const metrics = functionUnits(denoProgram(source, filename), context).map((unit) =>
    measureFunction(unit, options, context)
  );
  return { context, metrics };
}

/** The one-based UTF-16 position of an offset, computed independently of the core. */
export function positionOf(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}
