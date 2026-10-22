/**
 * @module ReportModel
 * @path src/report/model.ts
 * @description Public run, rule-summary, finding, and report types for the lint run reporter.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/report/collect.ts, src/engine/trace.ts]
 */

import type { IProjectDescriptor, IResolvedRule } from "../config/descriptor.ts";
import type { ITraceRecord, SkipReason } from "../engine/trace.ts";

/** One lint host diagnostic, as Deno lint reports it. */
export interface IHostDiagnostic {
  readonly filename: string;
  readonly range: {
    readonly start: { readonly line: number; readonly col: number };
    readonly end: { readonly line: number; readonly col: number };
  };
  readonly code: string;
  readonly message: string;
  readonly hint: string | null;
}

/** One host error, which has no diagnostic range or code. */
export interface IHostError {
  readonly file_path: string;
  readonly message: string;
}

/** One check the report did not run. */
export interface INotRunCheck {
  readonly id: string;
  readonly command: readonly string[] | null;
  readonly mode: string;
}

/** The inputs of one reported lint run. */
export interface ILintRunInput {
  readonly descriptor: IProjectDescriptor;
  readonly selectedPluginUrl: URL;
  readonly paths: readonly string[];
  readonly selection: string | null;
  readonly runId: string;
}

/** The full host envelope before collection. */
export interface ILintRunResult {
  readonly input: ILintRunInput;
  readonly exitCode: number | null;
  readonly diagnostics: readonly IHostDiagnostic[];
  readonly errors: readonly IHostError[];
  readonly records: readonly ITraceRecord[];
  readonly hostStderr: string;
  readonly signal: string | null;
  readonly completion: "complete" | "failed";
  readonly failure: string | null;
}

/** One resolved rule's observed coverage and findings. */
export interface IRuleRunSummary {
  readonly rule: IResolvedRule;
  readonly status: "active" | "parked" | "off" | "not-selected";
  readonly coverage: "complete" | "partial" | "unavailable";
  readonly observedChecked: number;
  readonly observedSkipped: Readonly<Record<SkipReason, number>>;
  readonly unobserved: readonly string[];
  readonly findings: number;
}

/** One normalized finding. */
export interface IFinding {
  readonly ruleId: string;
  readonly file: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly effectiveLevel: "error" | "warn";
  readonly message: string;
  readonly hint: string | null;
  readonly fingerprint: string | null;
}

/** The complete report a renderer receives. */
export interface IRunReport {
  readonly tool: { readonly name: "unslop-ts"; readonly version: string };
  readonly projectRoot: string;
  readonly completion: "complete" | "failed";
  readonly failure: string | null;
  readonly hostExitCode: number | null;
  readonly hostFilesVisited: null;
  readonly filesObserved: readonly string[];
  readonly rules: readonly IRuleRunSummary[];
  readonly findings: readonly IFinding[];
  readonly foreignDiagnostics: readonly IHostDiagnostic[];
  readonly foreignFindings: readonly IFinding[];
  readonly errors: readonly IHostError[];
  readonly notRun: readonly INotRunCheck[];
}
