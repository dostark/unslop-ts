/**
 * @module HealthDesignStrategies
 * @path src/report/design_strategies.ts
 * @description The God Class, Data Class and Feature Envy detection strategies of Lanza and Marinescu, applied to the typed class pass. Each finding carries the metric values that made it match.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/class_pass.ts, src/metrics/class_thresholds.ts, tests/design_strategies_test.ts]
 */

import { CLASS_THRESHOLDS } from "../metrics/class_thresholds.ts";
import type { IClassMetrics } from "../metrics/types.ts";
import type { IMethodCoupling } from "../rules/whole_tree/typed_coupling.ts";
import type { IPassClass } from "./class_pass.ts";

/** The detection strategies that the report applies. */
export type DesignStrategy = "god-class" | "data-class" | "feature-envy";

/** The metrics that a finding can report. A metric that the strategy does not use is null. */
export type DesignMetricName = "wmc" | "tcc" | "atfd" | "woc" | "laa" | "fdp" | "noap" | "noam";

/** One detection strategy match. */
export interface IDesignFinding {
  readonly strategy: DesignStrategy;
  readonly path: string;
  readonly className: string;
  /** The method name, set only for feature envy. */
  readonly methodName: string | null;
  readonly line: number;
  readonly metrics: Readonly<Record<DesignMetricName, number | null>>;
}

/** The limits that the strategies compare against. */
export interface IDesignLimits {
  readonly wmcVeryHigh: number;
  readonly wmcHigh: number;
  readonly tccLimit: number;
  readonly atfdFew: number;
  readonly dataClassFew: number;
  readonly dataClassMany: number;
  readonly wocLimit: number;
  readonly laaLimit: number;
  readonly fdpFew: number;
}

/** The sourced defaults of every limit. */
const DEFAULT_DESIGN_LIMITS: IDesignLimits = {
  wmcVeryHigh: CLASS_THRESHOLDS.wmcVeryHigh.value,
  wmcHigh: CLASS_THRESHOLDS.wmcHigh.value,
  tccLimit: CLASS_THRESHOLDS.tccLimit.value,
  atfdFew: CLASS_THRESHOLDS.atfdFew.value,
  dataClassFew: CLASS_THRESHOLDS.dataClassFew.value,
  dataClassMany: CLASS_THRESHOLDS.dataClassMany.value,
  wocLimit: CLASS_THRESHOLDS.wocLimit.value,
  laaLimit: CLASS_THRESHOLDS.laaLimit.value,
  fdpFew: CLASS_THRESHOLDS.fdpFew.value,
};

const NO_METRICS: Readonly<Record<DesignMetricName, number | null>> = {
  wmc: null,
  tcc: null,
  atfd: null,
  woc: null,
  laa: null,
  fdp: null,
  noap: null,
  noam: null,
};

function classFinding(
  strategy: DesignStrategy,
  entry: IPassClass,
  values: Partial<Record<DesignMetricName, number | null>>,
): IDesignFinding {
  return {
    strategy,
    path: entry.path,
    className: entry.metrics.name,
    methodName: null,
    line: entry.metrics.line,
    metrics: { ...NO_METRICS, ...values },
  };
}

function isGodClass(metrics: IClassMetrics, limits: IDesignLimits): boolean {
  return metrics.wmc >= limits.wmcVeryHigh && metrics.tcc !== null && metrics.tcc < limits.tccLimit &&
    metrics.atfd > limits.atfdFew;
}

function isDataClass(metrics: IClassMetrics, limits: IDesignLimits): boolean {
  if (metrics.woc === null || metrics.woc >= limits.wocLimit) return false;
  const exposed = metrics.noap + metrics.noam;
  const few = exposed > limits.dataClassFew && metrics.wmc < limits.wmcHigh;
  const many = exposed > limits.dataClassMany && metrics.wmc < limits.wmcVeryHigh;
  return few || many;
}

function isFeatureEnvy(method: IMethodCoupling, limits: IDesignLimits): boolean {
  return method.atfd > limits.atfdFew && method.laa !== null && method.laa < limits.laaLimit &&
    method.fdp <= limits.fdpFew;
}

/** Applies the three strategies to the classes of the pass. */
export function designFindingsOf(
  classes: readonly IPassClass[],
  limits: IDesignLimits = DEFAULT_DESIGN_LIMITS,
): IDesignFinding[] {
  const findings: IDesignFinding[] = [];
  for (const entry of classes) {
    const { metrics } = entry;
    if (isGodClass(metrics, limits)) {
      findings.push(classFinding("god-class", entry, { wmc: metrics.wmc, tcc: metrics.tcc, atfd: metrics.atfd }));
    }
    if (isDataClass(metrics, limits)) {
      findings.push(
        classFinding("data-class", entry, {
          woc: metrics.woc,
          noap: metrics.noap,
          noam: metrics.noam,
          wmc: metrics.wmc,
        }),
      );
    }
    for (const method of entry.methods) {
      if (!isFeatureEnvy(method, limits)) continue;
      findings.push({
        ...classFinding("feature-envy", entry, { atfd: method.atfd, laa: method.laa, fdp: method.fdp }),
        methodName: method.name,
        line: method.line,
      });
    }
  }
  return findings;
}
