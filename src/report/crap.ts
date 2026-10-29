/**
 * @module Crap
 * @path src/report/crap.ts
 * @description CRAP score, severity bands, coverage ownership and the static coverage fallback.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/report/lcov.ts, src/report/health.ts]
 */

import type { ILcovFileCoverage } from "./lcov.ts";

/** The CRAP value below which a function reads as untested-but-cheap. */
const CRAP_NONE_LIMIT = 30;

/** The CRAP value below which a function reads as moderate. */
const CRAP_MODERATE_LIMIT = 50;

/** The CRAP value below which a function reads as high. */
const CRAP_HIGH_LIMIT = 100;

/** The estimated coverage of a module that a test imports directly. */
export const DIRECT_COVERAGE_PERCENT = 85;

/** The estimated coverage of a module that only a runtime path reaches. */
export const INDIRECT_COVERAGE_PERCENT = 40;

/** The estimated coverage of a module that no runtime path reaches. */
export const UNREACHABLE_COVERAGE_PERCENT = 0;

/** The reading band of one CRAP value. */
export type CrapBand = "none" | "moderate" | "high" | "critical";

/** Where the coverage percentage came from. */
export type CoverageSource = "lcov" | "estimated";

/** Why the coverage percentage has its value. */
export type CoverageReason = "measured" | "no_input" | "file_missing" | "no_executable_samples";

/** The precision a measured sample claims. */
export type CoveragePrecision = "line" | "line_ambiguous";

/** How a runtime path reaches one module. */
export type RuntimeReach = "direct" | "indirect" | "none";

/** One coverage fact about a function unit. */
export interface ICoverageSample {
  readonly source: CoverageSource;
  readonly reason: CoverageReason;
  readonly precision: CoveragePrecision | null;
  readonly percent: number;
}

/** The CRAP score of one function at one coverage percentage. */
export function crapOf(cyclomatic: number, coveragePercent: number): number {
  const uncovered = 1 - coveragePercent / 100;
  return cyclomatic ** 2 * uncovered ** 3 + cyclomatic;
}

/** The reading band of one CRAP value. */
export function crapBandOf(crap: number): CrapBand {
  if (crap >= CRAP_HIGH_LIMIT) return "critical";
  if (crap >= CRAP_MODERATE_LIMIT) return "high";
  if (crap >= CRAP_NONE_LIMIT) return "moderate";
  return "none";
}

/** The estimated coverage of one runtime reach. */
export function estimatedCoverageOf(reach: RuntimeReach): number {
  if (reach === "direct") return DIRECT_COVERAGE_PERCENT;
  if (reach === "indirect") return INDIRECT_COVERAGE_PERCENT;
  return UNREACHABLE_COVERAGE_PERCENT;
}

/** The estimated sample of one file with no measured line samples. */
function estimate(reason: CoverageReason, reach: RuntimeReach): ICoverageSample {
  return { source: "estimated", reason, precision: null, percent: estimatedCoverageOf(reach) };
}

/** The coverage fact of one function unit, with the fallback reasons attributed. */
export function coverageOfUnit(
  unitLines: ReadonlySet<number>,
  file: ILcovFileCoverage | undefined,
  hasInput: boolean,
  reach: RuntimeReach,
  sharedLines: ReadonlySet<number>,
): ICoverageSample {
  if (!hasInput) return estimate("no_input", reach);
  if (file === undefined) return estimate("file_missing", reach);
  const applicable = [...unitLines].filter((line) => file.lines.has(line));
  if (applicable.length === 0) return estimate("no_executable_samples", reach);
  const covered = applicable.filter((line) => (file.lines.get(line) ?? 0) > 0).length;
  return {
    source: "lcov",
    reason: "measured",
    precision: applicable.some((line) => sharedLines.has(line)) ? "line_ambiguous" : "line",
    percent: (covered / applicable.length) * 100,
  };
}
