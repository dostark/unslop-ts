/**
 * @module MetricTypes
 * @path src/metrics/types.ts
 * @description Shared measurement types of the complexity metric core and its reports.
 * @architectural-layer Shared
 * @dependencies [@babel/parser]
 * @related-files [src/metrics/context.ts, src/metrics/function_metrics.ts, src/metrics/mod.ts]
 */

import type { ParseResult } from "@babel/parser";
import type { IRuleNode } from "../rules/types.ts";

/** Every contribution kind the metric core reports, in guide order. */
export const METRIC_CONTRIBUTION_KINDS = [
  "if",
  "else-if",
  "else",
  "for",
  "for-in",
  "for-of",
  "while",
  "do-while",
  "case",
  "switch",
  "catch",
  "ternary",
  "logical-and",
  "logical-or",
  "nullish-coalescing",
  "optional-chain",
  "logical-assignment",
  "labeled-jump",
  "recursion",
] as const;

/** One contribution kind the metric core reports. */
export type MetricContributionKind = (typeof METRIC_CONTRIBUTION_KINDS)[number];

/** The counting variant of the cyclomatic metric. */
export type MetricVariant = "classic" | "extended";

/** The metric a contribution belongs to. */
export type MetricName = "cyclomatic" | "cognitive";

/** The host source text a measurement parses. */
export interface IMeasurementSource {
  readonly text: string;
}

/** A one-based line and column pair in UTF-16 offsets. */
export interface IMetricPosition {
  readonly line: number;
  readonly column: number;
}

/** The half-open `[start, end)` UTF-16 span of one code token. */
export interface IMetricToken {
  readonly start: number;
  readonly end: number;
}

/** The per-file parser result every metric reads: tokens, optional links and positions. */
export interface IMeasurementContext {
  readonly syntaxTree: ParseResult;
  readonly tokens: readonly IMetricToken[];
  /** The start offset of every `?.` token, so each optional link counts exactly once. */
  readonly optionalChainOffsets: readonly number[];
  positionAt(offset: number): IMetricPosition;
}

/** The counting options one measurement reads. */
export interface IMetricOptions {
  readonly variant: MetricVariant;
  readonly countNullish: boolean;
}

/** One executable function under measurement, with its owned and descendant ranges. */
export interface IFunctionUnit {
  readonly node: IRuleNode;
  readonly name: string;
  readonly range: readonly [number, number];
  readonly descendantRanges: readonly (readonly [number, number])[];
  /** The name a direct self-call resolves to, or null for a method or an anonymous unit. */
  readonly bindingName: string | null;
}

/** One counted decision, with the exact position and applied weight. */
export interface IMetricContribution extends IMetricPosition {
  readonly metric: MetricName;
  readonly kind: MetricContributionKind;
  readonly weight: number;
  readonly nesting: number;
}

/** Every measured value of one function unit. */
export interface IFunctionMetrics extends IMetricPosition {
  readonly name: string;
  readonly range: readonly [number, number];
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly lines: number;
  readonly params: number;
  readonly contributions: readonly IMetricContribution[];
}

/** How a class metric obtained its foreign-data and coupling values. */
export type ClassMetricPrecision = "syntactic" | "typed";

/** The design metrics of one class. RFC, DIT and NOC are null until the class pass types them. */
export interface IClassMetrics {
  readonly name: string;
  readonly line: number;
  readonly nom: number;
  readonly wmc: number;
  readonly loc: number;
  readonly noa: number;
  readonly tcc: number | null;
  readonly lcom4: number;
  readonly atfd: number;
  readonly cbo: number;
  readonly rfc: number | null;
  readonly dit: number | null;
  readonly noc: number | null;
  readonly woc: number | null;
  readonly noap: number;
  readonly noam: number;
  readonly precision: ClassMetricPrecision;
}
