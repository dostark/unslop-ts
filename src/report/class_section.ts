/**
 * @module HealthClassSection
 * @path src/report/class_section.ts
 * @description Builds the class design section of the health report: one score per class, the design findings, and the default and derived thresholds.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/class_pass.ts, src/report/design_strategies.ts, src/report/class_statistics.ts, src/report/health.ts]
 */

import { CLASS_THRESHOLDS, type ClassThresholdName } from "../metrics/class_thresholds.ts";
import { DEFAULT_CLASS_WMC_VARIANT } from "../metrics/constants.ts";
import type {
  IHealthClassScore,
  IHealthClassThresholds,
  IHealthDesignFinding,
  IHealthThreshold,
} from "./health_model.ts";
import { classPassOf, type IPassClass } from "./class_pass.ts";
import { derivedThresholdsOf } from "./class_statistics.ts";
import { designFindingsOf } from "./design_strategies.ts";
import type { IParsedHealthFile } from "./parse.ts";
import type { IModuleGraph } from "../rules/whole_tree/unused_exports_resolved.ts";

/** The class design section of one report. */
export interface IClassSection {
  readonly class_scores: readonly IHealthClassScore[];
  readonly design_findings: readonly IHealthDesignFinding[];
  readonly class_thresholds: IHealthClassThresholds;
}

const THRESHOLD_NAMES = Object.keys(CLASS_THRESHOLDS).filter(isThresholdName);

/** True for a key of the recorded thresholds. */
function isThresholdName(name: string): name is ClassThresholdName {
  return name in CLASS_THRESHOLDS;
}

function scoreOf(entry: IPassClass): IHealthClassScore {
  const { metrics } = entry;
  return {
    path: entry.path,
    name: metrics.name,
    line: metrics.line,
    nom: metrics.nom,
    wmc: metrics.wmc,
    loc: metrics.loc,
    noa: metrics.noa,
    tcc: metrics.tcc,
    lcom4: metrics.lcom4,
    atfd: metrics.atfd,
    cbo: metrics.cbo,
    rfc: metrics.rfc,
    dit: metrics.dit,
    noc: metrics.noc,
    woc: metrics.woc,
    noap: metrics.noap,
    noam: metrics.noam,
    precision: metrics.precision,
  };
}

function defaultsOf(): Readonly<Record<ClassThresholdName, IHealthThreshold>> {
  const defaults = {} as Record<ClassThresholdName, IHealthThreshold>;
  for (const name of THRESHOLD_NAMES) {
    const { value, sources, retrieved, label } = CLASS_THRESHOLDS[name];
    defaults[name] = { value, sources: [...sources], retrieved, label };
  }
  return defaults;
}

/** Orders classes by weighted method count, then by path, name and line. */
function byWeight(left: IHealthClassScore, right: IHealthClassScore): number {
  return right.wmc - left.wmc || left.path.localeCompare(right.path) || left.name.localeCompare(right.name) ||
    left.line - right.line;
}

/** Runs the class pass over the snapshot and assembles the section. */
export function classSectionOf(
  files: ReadonlyMap<string, IParsedHealthFile>,
  graph: IModuleGraph,
  countNullish: boolean,
): IClassSection {
  const pass = classPassOf({ files, graph, options: { variant: DEFAULT_CLASS_WMC_VARIANT, countNullish } });
  return {
    class_scores: pass.classes.map(scoreOf).sort(byWeight),
    design_findings: designFindingsOf(pass.classes).map((finding) => ({
      strategy: finding.strategy,
      path: finding.path,
      class_name: finding.className,
      method_name: finding.methodName,
      line: finding.line,
      metrics: finding.metrics,
    })),
    class_thresholds: { defaults: defaultsOf(), derived: derivedThresholdsOf(pass.classes) },
  };
}
