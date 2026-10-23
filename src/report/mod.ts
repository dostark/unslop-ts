/**
 * @module ReportEntry
 * @path src/report/mod.ts
 * @description Report entry point: collect a host run into findings and coverage, and the report types.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/report/collect.ts, src/report/model.ts]
 */

export { collectRunReport, failingFindings } from "./collect.ts";
export type {
  IFinding,
  IHostDiagnostic,
  IHostError,
  ILintRunInput,
  ILintRunResult,
  INotRunCheck,
  IRuleRunSummary,
  IRunReport,
} from "./model.ts";
