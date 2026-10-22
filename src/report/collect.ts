/**
 * @module ReportCollect
 * @path src/report/collect.ts
 * @description Pure collection of a host run envelope into rule coverage, findings, and a public report.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/report/model.ts, src/report/context.ts, src/engine/trace.ts]
 */

import { fromFileUrl, isAbsolute, relative } from "@std/path";
import type { IResolvedRule } from "../config/descriptor.ts";
import type { ISourceSnapshot } from "./context.ts";
import { TOOL_VERSION } from "./version.ts";
import { fingerprintOf } from "./fingerprint.ts";
import type { IResolvedSelection } from "../cli/selection.ts";
import { type ITraceRecord, SKIP_REASONS, type SkipReason } from "../engine/trace.ts";
import { notRunCheck } from "./commands.ts";
import type { IRunContext } from "./context.ts";
import type { IFinding, IHostDiagnostic, ILintRunResult, INotRunCheck, IRuleRunSummary, IRunReport } from "./model.ts";

const WARN = "warn" as const;
const ERROR = "error" as const;

type RuleStatus = IRuleRunSummary["status"];

function statusOf(rule: IResolvedRule, selection: IResolvedSelection | null): RuleStatus {
  const off = rule.configuredLevel === "off";
  if (rule.engine !== "plugin") return off ? "off" : "active";
  if (selection === null) return off ? (rule.optIn ? "parked" : "off") : "active";
  const selected = selection.ids.has(rule.id) || rule.tags.some((tag) => selection.tags.has(tag));
  if (!selected) return "not-selected";
  if (!off) return "active";
  return rule.optIn ? "active" : "off";
}

function effectiveLevel(rule: IResolvedRule, status: RuleStatus): "error" | "warn" {
  if (rule.engine === "plugin" && status === "active" && rule.configuredLevel === "off") return ERROR;
  return rule.configuredLevel === WARN ? WARN : ERROR;
}

function repoPath(filename: string, root: string): string {
  let path = filename;
  if (filename.startsWith("file:")) {
    try {
      path = fromFileUrl(filename);
    } catch {
      path = filename;
    }
  }
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? rel : path;
}

function fingerprintFor(
  source: ISourceSnapshot | undefined,
  ruleId: string,
  file: string,
  startLine: number,
  startColumn: number,
  endColumn: number,
  message: string,
): string | null {
  if (!source) return null;
  const lines = new TextDecoder().decode(source.bytes).split("\n");
  const line = lines[startLine - 1];
  return line === undefined ? null : fingerprintOf(ruleId, file, line, startColumn, endColumn, message);
}

function findingOf(
  diagnostic: IHostDiagnostic,
  rule: IResolvedRule,
  status: RuleStatus,
  root: string,
  source: ISourceSnapshot | undefined,
): IFinding {
  const file = repoPath(diagnostic.filename, root);
  return {
    ruleId: rule.id,
    file,
    startLine: diagnostic.range.start.line,
    startColumn: diagnostic.range.start.col,
    endLine: diagnostic.range.end.line,
    endColumn: diagnostic.range.end.col,
    effectiveLevel: effectiveLevel(rule, status),
    message: diagnostic.message,
    hint: diagnostic.hint,
    fingerprint: fingerprintFor(
      source,
      rule.id,
      file,
      diagnostic.range.start.line,
      diagnostic.range.start.col,
      diagnostic.range.end.col,
      diagnostic.message,
    ),
  };
}

function foreignFindingOf(
  diagnostic: IHostDiagnostic,
  root: string,
  source: ISourceSnapshot | undefined,
): IFinding {
  const file = repoPath(diagnostic.filename, root);
  return {
    ruleId: diagnostic.code,
    file,
    startLine: diagnostic.range.start.line,
    startColumn: diagnostic.range.start.col,
    endLine: diagnostic.range.end.line,
    endColumn: diagnostic.range.end.col,
    effectiveLevel: ERROR,
    message: diagnostic.message,
    hint: diagnostic.hint,
    fingerprint: fingerprintFor(
      source,
      diagnostic.code,
      file,
      diagnostic.range.start.line,
      diagnostic.range.start.col,
      diagnostic.range.end.col,
      diagnostic.message,
    ),
  };
}

function summaryOf(
  rule: IResolvedRule,
  status: RuleStatus,
  records: readonly ITraceRecord[],
  measuredFiles: readonly string[],
  findings: number,
): IRuleRunSummary {
  const emptySkipped = Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>;
  if (rule.engine !== "plugin" || status !== "active") {
    return {
      rule,
      status,
      coverage: "unavailable",
      observedChecked: 0,
      observedSkipped: emptySkipped,
      unobserved: [],
      findings,
    };
  }
  const terminals = records.filter((record) => record.rule === rule.id && record.kind !== "observed");
  const checked = terminals.filter((record) => record.kind === "checked").length;
  const skipped = { ...emptySkipped };
  for (const record of terminals) {
    if (record.kind === "skipped") skipped[record.reason] += 1;
  }
  const terminalFiles = new Set(terminals.map((record) => record.file));
  const unobserved = measuredFiles.filter((file) => !terminalFiles.has(file));
  const coverage = measuredFiles.length === 0 ? "unavailable" : unobserved.length === 0 ? "complete" : "partial";
  return {
    rule,
    status,
    coverage,
    observedChecked: checked,
    observedSkipped: skipped,
    unobserved,
    findings,
  };
}

/** Collects the public report from a host result and an explicit private context. It performs no I/O. */
export function collectRunReport(result: ILintRunResult, context: IRunContext): IRunReport {
  const { descriptor } = result.input;
  const root = descriptor.rootUrl.protocol === "file:" ? fromFileUrl(descriptor.rootUrl) : descriptor.rootUrl.href;
  const observed = new Set<string>();
  for (const record of result.records) observed.add(record.file);
  const measuredFiles = [...observed].sort();
  const rules = Object.values(context.compiled.rules);
  const selectedFindings: IFinding[] = [];
  const foreignDiagnostics: IHostDiagnostic[] = [];
  const findingsByRule = new Map<string, number>();
  for (const diagnostic of result.diagnostics) {
    const rule = context.compiled.rules[diagnostic.code];
    if (rule && rule.engine === "plugin") {
      const status = statusOf(rule, context.selection);
      selectedFindings.push(
        findingOf(diagnostic, rule, status, root, context.sources?.get(repoPath(diagnostic.filename, root))),
      );
      findingsByRule.set(rule.id, (findingsByRule.get(rule.id) ?? 0) + 1);
    } else {
      foreignDiagnostics.push(diagnostic);
    }
  }
  const foreignFindings = foreignDiagnostics.map((diagnostic) =>
    foreignFindingOf(diagnostic, root, context.sources?.get(repoPath(diagnostic.filename, root)))
  );
  const summaries = rules.map((rule) =>
    summaryOf(
      rule,
      statusOf(rule, context.selection),
      result.records,
      measuredFiles,
      findingsByRule.get(rule.id) ?? 0,
    )
  );
  const notRun: INotRunCheck[] = rules
    .filter((rule) => rule.command !== null)
    .map((rule) => notRunCheck(rule, descriptor));
  return {
    tool: { name: "unslop-ts", version: TOOL_VERSION },
    projectRoot: root,
    completion: result.completion,
    failure: result.failure,
    hostExitCode: result.exitCode,
    hostFilesVisited: null,
    filesObserved: measuredFiles,
    rules: summaries,
    findings: selectedFindings,
    foreignDiagnostics,
    foreignFindings,
    errors: result.errors,
    notRun,
  };
}

/** The findings that affect the report's exit code. */
export function failingFindings(report: IRunReport): readonly IFinding[] {
  return [...report.findings, ...report.foreignFindings].filter((finding) => finding.effectiveLevel === "error");
}
