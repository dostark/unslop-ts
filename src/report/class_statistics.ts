/**
 * @module HealthClassStatistics
 * @path src/report/class_statistics.ts
 * @description Derives the LOW, AVERAGE, HIGH and VERY_HIGH band of each class metric from the classes of the walked project, with the statistical method of Lanza and Marinescu.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/class_pass.ts, src/report/health_model.ts, tests/class_statistics_test.ts]
 */

import type { IClassMetrics } from "../metrics/types.ts";
import type { IPassClass } from "./class_pass.ts";

/** The class metrics that get derived bands. */
export type DerivedMetric = "nom" | "loc" | "wmc" | "atfd" | "cbo" | "rfc" | "noap" | "noam";

/** The mean and population standard deviation of a metric, and the four bands that they give. */
export interface IBands {
  readonly mean: number;
  readonly sd: number;
  readonly low: number;
  readonly average: number;
  readonly high: number;
  readonly very_high: number;
}

/** The derived bands of every metric that the walked classes measure. */
export interface IDerivedThresholds {
  /** The classes with at least one method, which are the population of the bands. */
  readonly population: number;
  readonly metrics: Readonly<Partial<Record<DerivedMetric, IBands>>>;
}

const DERIVED_METRICS: readonly DerivedMetric[] = ["nom", "loc", "wmc", "atfd", "cbo", "rfc", "noap", "noam"];
/** The factor that the book applies to HIGH to get VERY_HIGH. */
const VERY_HIGH_FACTOR = 1.5;

/** The bands of a population: LOW is mean minus sd and never below zero, HIGH is mean plus sd. Null for no values. */
export function bandsOf(values: readonly number[]): IBands | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return {
    mean,
    sd,
    low: Math.max(0, mean - sd),
    average: mean,
    high: mean + sd,
    very_high: (mean + sd) * VERY_HIGH_FACTOR,
  };
}

function valueOf(metrics: IClassMetrics, name: DerivedMetric): number | null {
  return metrics[name];
}

/** The bands of every metric over the classes that declare at least one method. */
export function derivedThresholdsOf(classes: readonly IPassClass[]): IDerivedThresholds {
  const population = classes.filter((entry) => entry.metrics.nom > 0);
  const metrics: Partial<Record<DerivedMetric, IBands>> = {};
  for (const name of DERIVED_METRICS) {
    const values = population.map((entry) => valueOf(entry.metrics, name)).filter((value) => value !== null);
    const bands = bandsOf(values);
    if (bands !== null) metrics[name] = bands;
  }
  return { population: population.length, metrics };
}
