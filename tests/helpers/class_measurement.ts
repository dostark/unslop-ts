/**
 * @module ClassMeasurementTestHelper
 * @path tests/helpers/class_measurement.ts
 * @description Shared helper that measures every class of a source text through the class metric core on a real host AST.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/metrics/class_metrics.ts, tests/class_metrics_test.ts, tests/helpers/measurement.ts]
 */

import { asNode, type ILintNode } from "../../src/engine/type_environment.ts";
import { measureClass } from "../../src/metrics/class_metrics.ts";
import { createMeasurementContext } from "../../src/metrics/context.ts";
import { forEachChildNode } from "../../src/metrics/estree.ts";
import type { IClassMetrics, IMetricOptions } from "../../src/metrics/types.ts";
import { CLASSIC_OPTIONS, denoProgram, FIXTURE_PATH } from "./measurement.ts";

const CLASS_KINDS: ReadonlySet<string> = new Set(["ClassDeclaration", "ClassExpression"]);

/** Every class node under a root, outer classes before the classes nested in them. */
function classNodesUnder(root: ILintNode, found: ILintNode[]): ILintNode[] {
  if (CLASS_KINDS.has(root.type)) found.push(root);
  forEachChildNode(root, (child) => classNodesUnder(child, found));
  return found;
}

/** Measures every class of a source unit on the Deno host AST. */
export function measureClasses(
  source: string,
  options: IMetricOptions = CLASSIC_OPTIONS,
  filename = FIXTURE_PATH,
): readonly IClassMetrics[] {
  const context = createMeasurementContext({ text: source }, filename);
  const program = asNode(denoProgram(source, filename));
  return classNodesUnder(program, []).map((node) => measureClass(node, options, context));
}
