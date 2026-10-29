/**
 * @module Maintainability
 * @path src/report/maintainability.ts
 * @description The fallow-density maintainability index: a pure file score from measured facts.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/report/health.ts, src/report/health_model.ts]
 */

/** The density weight of the index. */
const DENSITY_WEIGHT = 30;

/** The dead-code weight of the index. */
const DEAD_CODE_WEIGHT = 20;

/** The fan-out weight of the index. */
const FAN_OUT_WEIGHT = 4;

/** The largest fan-out penalty. */
const FAN_OUT_CAP = 15;

/** The file length at which the density term stops being dampened. */
const DAMPENING_LINES = 50;

/** One index of at least this value reads as good. */
export const MI_GOOD = 70;

/** One index of at least this value reads as moderate. */
export const MI_MODERATE = 40;

/** The measured facts the index reads. */
export interface IMaintainabilityInput {
  /** The unique code-token lines of the file. */
  readonly fileLines: number;
  /** The summed cyclomatic value of every unit, including its base one. */
  readonly cyclomatic: number;
  /** The raw dead value-export ratio of the file, between zero and one. */
  readonly deadExportRatio: number;
  /** The unique internal structural targets of the file. */
  readonly fanOut: number;
}

/** Clamps a value into the index range. */
function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** The fallow-density maintainability index of one file. */
export function maintainabilityIndexOf(input: IMaintainabilityInput): number {
  const density = input.fileLines === 0 ? 0 : input.cyclomatic / input.fileLines;
  const dampening = Math.min(input.fileLines / DAMPENING_LINES, 1);
  const fanOutPenalty = Math.min(Math.log(input.fanOut + 1) * FAN_OUT_WEIGHT, FAN_OUT_CAP);
  return clamp(
    100 - density * DENSITY_WEIGHT * dampening - input.deadExportRatio * DEAD_CODE_WEIGHT - fanOutPenalty,
  );
}

/** The reading band of one index. */
export type MaintainabilityBand = "good" | "moderate" | "poor";

/** The reading band of one index. */
export function maintainabilityBandOf(index: number): MaintainabilityBand {
  if (index >= MI_GOOD) return "good";
  if (index >= MI_MODERATE) return "moderate";
  return "poor";
}
