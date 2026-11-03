/**
 * @module MaxClassSize
 * @path src/rules/max_class_size.ts
 * @description Class-size (god-object) score as a plugin rule on the Deno ESTree.
 *   Indicators ported from scripts/check_god_objects.ts.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, tests/max_class_size_test.ts]
 */

import { asNode, type ILintNode, isNodeLike, programOf, walk } from "../engine/type_environment.ts";
import { measureClass } from "../metrics/class_metrics.ts";
import {
  DEFAULT_CLASS_WMC_VARIANT,
  DEFAULT_COUNT_NULLISH,
  DEFAULT_GOD_CLASS_ATFD_FEW,
  DEFAULT_GOD_CLASS_TCC_LIMIT,
  DEFAULT_GOD_CLASS_WMC_VERY_HIGH,
} from "../metrics/constants.ts";
import { createMeasurementContext } from "../metrics/context.ts";
import type { IClassMetrics, IMeasurementContext, IMetricOptions } from "../metrics/types.ts";
import type { IPluginRuleContext, IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

/** Class-size indicators, matching the check_god_objects.ts metrics. */
interface IClassIndicators {
  readonly lineCount: number;
  readonly methodCount: number;
  readonly ctorParams: number;
  readonly importCount: number;
  readonly fieldCount: number;
  readonly maxMethodLines: number;
}

const METHOD_CAP = 30;
const METHOD_WEIGHT = 1.5;
const CTOR_PARAM_LIMIT = 7;
const CTOR_WEIGHT = 3;
const LINE_DIVISOR = 50;
const LONGEST_METHOD_BASELINE = 100;
const LONGEST_METHOD_DIVISOR = 10;
const IMPORT_BASELINE = 24;
const IMPORT_WEIGHT = 1.5;
const FIELD_BASELINE = 3;
const FIELD_WEIGHT = 0.8;

/** The line span of a node, from its byte range in `text`, or 0 when unavailable. */
function lineSpan(node: ILintNode, text: string): number {
  const range = node.range;
  if (!Array.isArray(range) || range.length !== 2) return 0;
  const start = range[0];
  const end = range[1];
  if (typeof start !== "number" || typeof end !== "number") return 0;
  return text.slice(start, end).split("\n").length;
}

/** The declared parameter count of a method definition, or 0. */
function paramCount(method: ILintNode): number {
  const value = method.value;
  if (!isNodeLike(value)) return 0;
  const params = asNode(value).params;
  return Array.isArray(params) ? params.length : 0;
}

/** Collects the class indicators, or null when the class is under `minClassLines`. */
function collectClassIndicators(
  classNode: ILintNode,
  text: string,
  importCount: number,
  minClassLines: number,
): IClassIndicators | null {
  const lineCount = lineSpan(classNode, text);
  if (lineCount < minClassLines) return null;
  let methodCount = 0;
  let fieldCount = 0;
  let ctorParams = 0;
  let seenConstructor = false;
  let maxMethodLines = 0;
  walk(classNode, (node) => {
    if (node.type === "MethodDefinition") {
      if (node.kind === "constructor") {
        if (!seenConstructor) {
          seenConstructor = true;
          ctorParams = paramCount(node);
        }
        return;
      }
      // ts-morph's MethodDeclaration excludes get/set accessors, so the port does too.
      if (node.kind !== "method") return;
      methodCount++;
      const span = lineSpan(node, text);
      if (span > maxMethodLines) maxMethodLines = span;
    } else if (node.type === "Property" && node.method === true) {
      // Object-literal method shorthand is a MethodDeclaration in the TypeScript AST.
      methodCount++;
      const span = lineSpan(node, text);
      if (span > maxMethodLines) maxMethodLines = span;
    } else if (node.type === "PropertyDefinition") {
      fieldCount++;
    }
  });
  return { lineCount, methodCount, ctorParams, importCount, fieldCount, maxMethodLines };
}

/** The check_god_objects.ts score for the collected indicators. */
function classSizeScore(m: IClassIndicators, minClassLines: number): number {
  const methodTerm = Math.min(m.methodCount, METHOD_CAP) * METHOD_WEIGHT;
  const ctorTerm = m.ctorParams > CTOR_PARAM_LIMIT ? m.ctorParams * CTOR_WEIGHT : 0;
  const lineTerm = Math.max(0, (m.lineCount - minClassLines) / LINE_DIVISOR);
  const longestTerm = Math.max(0, (m.maxMethodLines - LONGEST_METHOD_BASELINE) / LONGEST_METHOD_DIVISOR);
  const importTerm = Math.max(0, (m.importCount - IMPORT_BASELINE) * IMPORT_WEIGHT);
  const fieldTerm = Math.max(0, m.fieldCount - FIELD_BASELINE) * FIELD_WEIGHT;
  return Math.round(methodTerm + ctorTerm + lineTerm + longestTerm + importTerm + fieldTerm);
}

function countImports(program: ILintNode): number {
  const statements = program.body;
  if (!Array.isArray(statements)) return 0;
  return statements.filter((statement) => isNodeLike(statement) && asNode(statement).type === "ImportDeclaration")
    .length;
}

/** The declared class name, or `(anonymous)`. */
function classNameOf(classNode: ILintNode): string {
  const id = classNode.id;
  if (isNodeLike(id) && typeof asNode(id).name === "string") return asNode(id).name as string;
  return "(anonymous)";
}

/** The shared metric options that weighted methods per class reads from the rule options. */
function wmcOptionsOf(ctx: IPluginRuleContext): IMetricOptions {
  return {
    variant: ctx.options.wmcVariant === "extended" ? "extended" : DEFAULT_CLASS_WMC_VARIANT,
    countNullish: DEFAULT_COUNT_NULLISH,
  };
}

/** The cohesion text of a message: two decimals, or n/a when the class has fewer than two visible methods. */
function tccText(metrics: IClassMetrics): string {
  return metrics.tcc === null ? "n/a" : metrics.tcc.toFixed(2);
}

/** The three limits of the God Class strategy. */
interface IGodClassLimits {
  readonly wmcVeryHigh: number;
  readonly tccLimit: number;
  readonly atfdFew: number;
}

function godClassLimitsOf(ctx: IPluginRuleContext): IGodClassLimits {
  const { wmcVeryHigh, tccLimit, atfdFew } = ctx.options;
  return {
    wmcVeryHigh: typeof wmcVeryHigh === "number" ? wmcVeryHigh : DEFAULT_GOD_CLASS_WMC_VERY_HIGH,
    tccLimit: typeof tccLimit === "number" ? tccLimit : DEFAULT_GOD_CLASS_TCC_LIMIT,
    atfdFew: typeof atfdFew === "number" ? atfdFew : DEFAULT_GOD_CLASS_ATFD_FEW,
  };
}

/** True when the class is complex, incoherent and reaches into the data of other classes. A null TCC never qualifies. */
function isGodClass(metrics: IClassMetrics, limits: IGodClassLimits): boolean {
  if (metrics.tcc === null) return false;
  return metrics.wmc >= limits.wmcVeryHigh && metrics.tcc < limits.tccLimit && metrics.atfd > limits.atfdFew;
}

/** The God Class strategy of Lanza and Marinescu: WMC, TCC and ATFD decide, and the size score does not. */
function createGodClass(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const limits = godClassLimitsOf(ctx);
  const wmcOptions = wmcOptionsOf(ctx);
  let measurement: IMeasurementContext | undefined;
  const check = (rawNode: IRuleNode): void => {
    measurement ??= createMeasurementContext(context.sourceCode, context.filename);
    const metrics = measureClass(asNode(rawNode), wmcOptions, measurement);
    if (!isGodClass(metrics, limits)) return;
    context.report({
      node: rawNode,
      message: `Class ${metrics.name} is a god class (WMC ${metrics.wmc} >= ${limits.wmcVeryHigh}, ` +
        `TCC ${tccText(metrics)} < ${limits.tccLimit.toFixed(2)}, ATFD ${metrics.atfd} > ${limits.atfdFew}).`,
      hint: "Split the class so that each part owns one responsibility and its own data.",
    });
  };
  return { ClassDeclaration: check };
}

/** The legacy strategy: the weighted size score and its minimum line count. */
function createLegacyScore(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const minClassLines = typeof ctx.options.minClassLines === "number" ? ctx.options.minClassLines : 200;
  const threshold = typeof ctx.options.threshold === "number" ? ctx.options.threshold : 60;
  const importCount = countImports(programOf(context.sourceCode));
  const text = context.sourceCode.getText();
  const wmcOptions = wmcOptionsOf(ctx);
  let measurement: IMeasurementContext | undefined;

  const check = (rawNode: IRuleNode): void => {
    const node = asNode(rawNode);
    const indicators = collectClassIndicators(node, text, importCount, minClassLines);
    if (indicators === null) return;
    const score = classSizeScore(indicators, minClassLines);
    if (score < threshold) return;
    measurement ??= createMeasurementContext(context.sourceCode, context.filename);
    const metrics = measureClass(node, wmcOptions, measurement);
    context.report({
      node: rawNode,
      message:
        `Class ${
          classNameOf(node)
        } score ${score} (limit ${threshold}; ${indicators.methodCount} methods, ${indicators.lineCount} lines; ` +
        `WMC ${metrics.wmc}, TCC ${tccText(metrics)}, LCOM4 ${metrics.lcom4}).`,
      hint: "Split the class into smaller, focused units.",
    });
  };

  return { ClassDeclaration: check };
}

export function createMaxClassSize(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  return ctx.options.strategy === "legacy-score" ? createLegacyScore(context, ctx) : createGodClass(context, ctx);
}
