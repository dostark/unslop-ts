/**
 * @module HealthScore
 * @path src/report/health_score.ts
 * @description The nine supported score adapters, the two unsupported entries and the graded aggregate.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/health.ts, src/report/health_model.ts]
 */

import type { IHealthScore, IHealthScoreSignal } from "./health_model.ts";

/** The grade boundaries of the project score. */
const SCORE_GRADE_A = 85;
const SCORE_GRADE_B = 70;
const SCORE_GRADE_C = 55;
const SCORE_GRADE_D = 40;

/** The penalty weights and caps of the supported signals. */
const DEAD_FILES_WEIGHT = 0.2;
const DEAD_FILES_CAP = 15;
const DEAD_EXPORTS_WEIGHT = 0.2;
const DEAD_EXPORTS_CAP = 15;
const COMPLEXITY_WEIGHT = 4;
const COMPLEXITY_CAP = 20;
const MAINTAINABILITY_WEIGHT = 1.5;
const MAINTAINABILITY_CAP = 15;
const HOTSPOTS_PER_FILE_WEIGHT = 10;
const HOTSPOTS_CAP = 10;
const CYCLES_WEIGHT = 0.5;
const CYCLES_CAP = 25;
const UNIT_SIZE_WEIGHT = 0.5;
const UNIT_SIZE_CAP = 10;
const COUPLING_WEIGHT = 0.5;
const COUPLING_CAP = 5;
const DUPLICATION_FREE_PERCENT = 5;
const DUPLICATION_WEIGHT = 1;
const DUPLICATION_CAP = 10;

/** The fixed cyclomatic threshold of the complexity signal. */
export const CRITICAL_COMPLEXITY = 50;

/** The fixed function-size threshold of the unit-size signal. */
export const CRITICAL_UNIT_LINES = 60;

/** The fixed maintainability threshold of the maintainability signal. */
export const LOW_MAINTAINABILITY = 40;

/** The share of `part` in `whole`, zero for an empty population. */
function share(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/** One capped weighted penalty. */
function penalty(raw: number, weight: number, cap: number): number {
  return Math.min(Math.max(raw, 0) * weight, cap);
}

/** The grade of one complete score value. */
export function gradeOf(value: number): IHealthScore["grade"] {
  if (value >= SCORE_GRADE_A) return "A";
  if (value >= SCORE_GRADE_B) return "B";
  if (value >= SCORE_GRADE_C) return "C";
  if (value >= SCORE_GRADE_D) return "D";
  return "F";
}

/** The clamped score value from the known penalties. */
export function scoreValueOf(signals: readonly IHealthScoreSignal[]): number {
  const penalty = signals.reduce((sum, signal) => sum + signal.penalty, 0);
  return Math.min(Math.max(100 - penalty, 0), 100);
}

/** The graded aggregate: a complete score has a grade, a partial one has null. */
export function healthScoreOf(signals: readonly IHealthScoreSignal[]): IHealthScore {
  const partial = signals.some((signal) => signal.status === "unavailable");
  const value = scoreValueOf(signals);
  return { value, grade: partial ? null : gradeOf(value), status: partial ? "partial" : "complete", signals };
}

/** The inputs of the score adapters, already counted by the collection. */
export interface IScoreInput {
  readonly deadFiles: { readonly count: number; readonly population: number; readonly available: boolean };
  readonly deadExports: { readonly unused: number; readonly total: number };
  readonly complexity: { readonly critical: number; readonly units: number; readonly parseFailed: boolean };
  readonly maintainability: { readonly low: number; readonly files: number };
  readonly hotspots: {
    readonly count: number;
    readonly files: number;
    readonly available: boolean;
    readonly reason: string | null;
  };
  readonly cycles: { readonly sccs: number; readonly files: number; readonly complete: boolean };
  readonly unitSize: { readonly over: number; readonly units: number; readonly parseFailed: boolean };
  readonly coupling: { readonly high: number; readonly files: number; readonly complete: boolean };
  readonly duplication: {
    readonly lines: number;
    readonly total: number;
    readonly available: boolean;
    readonly reason: string | null;
  };
}

/** One measured signal. */
function measured(
  signal: string,
  source: string,
  raw: number,
  numerator: number,
  denominator: number,
  value: number,
): IHealthScoreSignal {
  return {
    signal,
    status: "measured",
    raw,
    numerator,
    denominator,
    penalty: value,
    source,
    reason: null,
  };
}

/** One unavailable supported signal, which keeps its zero penalty and states why. */
function unavailable(signal: string, source: string, reason: string): IHealthScoreSignal {
  return { signal, status: "unavailable", raw: null, numerator: null, denominator: null, penalty: 0, source, reason };
}

/** The two unsupported signals: no penalty, no partial status. */
function notMeasured(signal: string, source: string, reason: string): IHealthScoreSignal {
  return { signal, status: "not_measured", raw: null, numerator: null, denominator: null, penalty: 0, source, reason };
}

/** The dead-file signal, or its attributed absence. */
function deadFilesSignal(input: IScoreInput): IHealthScoreSignal {
  if (!input.deadFiles.available) return unavailable("dead_files", "unused_files_manifest", "dead-file-scan-failed");
  const shareValue = share(input.deadFiles.count, input.deadFiles.population);
  return measured(
    "dead_files",
    "unused_files_manifest",
    shareValue,
    input.deadFiles.count,
    input.deadFiles.population,
    penalty(shareValue, DEAD_FILES_WEIGHT, DEAD_FILES_CAP),
  );
}

/** The dead-export signal. */
function deadExportsSignal(input: IScoreInput): IHealthScoreSignal {
  const shareValue = share(input.deadExports.unused, input.deadExports.total);
  return measured(
    "dead_exports",
    "value_export_population",
    shareValue,
    input.deadExports.unused,
    input.deadExports.total,
    penalty(shareValue, DEAD_EXPORTS_WEIGHT, DEAD_EXPORTS_CAP),
  );
}

/** The critical-complexity signal, or its parse-failure absence. */
function complexitySignal(input: IScoreInput): IHealthScoreSignal {
  if (input.complexity.parseFailed) return unavailable("complexity", "metric_core", "parse-failures");
  const shareValue = share(input.complexity.critical, input.complexity.units);
  return measured(
    "complexity",
    "metric_core",
    shareValue,
    input.complexity.critical,
    input.complexity.units,
    penalty(shareValue, COMPLEXITY_WEIGHT, COMPLEXITY_CAP),
  );
}

/** The low-maintainability signal. */
function maintainabilitySignal(input: IScoreInput): IHealthScoreSignal {
  const shareValue = share(input.maintainability.low, input.maintainability.files);
  return measured(
    "maintainability",
    "file_scores",
    shareValue,
    input.maintainability.low,
    input.maintainability.files,
    penalty(shareValue, MAINTAINABILITY_WEIGHT, MAINTAINABILITY_CAP),
  );
}

/** The hotspot signal, or the history status that makes it advisory. */
function hotspotsSignal(input: IScoreInput): IHealthScoreSignal {
  if (!input.hotspots.available) {
    return unavailable("hotspots", "git_churn", input.hotspots.reason ?? "history-unavailable");
  }
  const denominator = Math.max(Math.ceil(input.hotspots.files * 0.01), 1);
  return measured(
    "hotspots",
    "git_churn",
    input.hotspots.count,
    input.hotspots.count,
    input.hotspots.files,
    Math.min((input.hotspots.count / denominator) * HOTSPOTS_PER_FILE_WEIGHT, HOTSPOTS_CAP),
  );
}

/** The runtime-cycle signal, or the incomplete-graph absence. */
function cyclesSignal(input: IScoreInput): IHealthScoreSignal {
  if (!input.cycles.complete) return unavailable("cycles", "runtime_graph", "graph-incomplete");
  const rate = input.cycles.files === 0 ? 0 : (input.cycles.sccs / input.cycles.files) * 1000;
  return measured(
    "cycles",
    "runtime_graph",
    rate,
    input.cycles.sccs,
    input.cycles.files,
    penalty(rate, CYCLES_WEIGHT, CYCLES_CAP),
  );
}

/** The oversized-unit signal, or its parse-failure absence. */
function unitSizeSignal(input: IScoreInput): IHealthScoreSignal {
  if (input.unitSize.parseFailed) return unavailable("unit_size", "metric_core", "parse-failures");
  const rate = input.unitSize.units === 0 ? 0 : (input.unitSize.over / input.unitSize.units) * 1000;
  return measured(
    "unit_size",
    "metric_core",
    rate,
    input.unitSize.over,
    input.unitSize.units,
    penalty(rate, UNIT_SIZE_WEIGHT, UNIT_SIZE_CAP),
  );
}

/** The coupling signal, or the incomplete-graph absence. */
function couplingSignal(input: IScoreInput): IHealthScoreSignal {
  if (!input.coupling.complete) return unavailable("coupling", "structural_graph", "graph-incomplete");
  const shareValue = share(input.coupling.high, input.coupling.files);
  return measured(
    "coupling",
    "structural_graph",
    shareValue,
    input.coupling.high,
    input.coupling.files,
    penalty(shareValue, COUPLING_WEIGHT, COUPLING_CAP),
  );
}

/** The duplication signal, or the runner absence that keeps the score partial. */
function duplicationSignal(input: IScoreInput): IHealthScoreSignal {
  if (!input.duplication.available) {
    return unavailable("duplication", "jscpd_local", input.duplication.reason ?? "runner-unavailable");
  }
  const shareValue = share(input.duplication.lines, input.duplication.total);
  return measured(
    "duplication",
    "jscpd_local",
    shareValue,
    input.duplication.lines,
    input.duplication.total,
    penalty(Math.max(0, shareValue - DUPLICATION_FREE_PERCENT), DUPLICATION_WEIGHT, DUPLICATION_CAP),
  );
}

/** Builds the eleven signal entries in the fixed table order. */
export function scoreSignalsOf(input: IScoreInput): IHealthScoreSignal[] {
  return [
    deadFilesSignal(input),
    deadExportsSignal(input),
    complexitySignal(input),
    maintainabilitySignal(input),
    hotspotsSignal(input),
    cyclesSignal(input),
    unitSizeSignal(input),
    couplingSignal(input),
    duplicationSignal(input),
    notMeasured("unused_dependencies", "fallow", "unsupported-in-unslop-health-v1"),
    notMeasured("prop_drilling", "fallow", "unsupported-in-unslop-health-v1"),
  ];
}
