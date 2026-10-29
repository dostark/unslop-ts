#!/usr/bin/env -S deno run -A
/**
 * @module RuleReport
 * @path src/cli/rule_report.ts
 * @description Runs one catalog rule over given roots, ranks the findings and gates them against package ceilings.
 * @architectural-layer Tooling
 * @related-files [src/engine/plugin.ts, src/cli/rule_ceiling.ts, tests/rule_report_test.ts]
 * @public Exports are the unit-test surface of this module.
 *
 * Usage:
 *   deno run -A src/cli/rule_report.ts --rule=<id> [--roots=a,b] [--topFiles=5] [--topFns=5] [--json] [--fail]
 *   deno run -A src/cli/rule_report.ts --rule=<id> --descriptor=<entry> --ceilings=<file> [--json] [--fail]
 */

import { fromFileUrl, join, relative, resolve } from "@std/path";
import { selectionEnvNameForRule } from "../engine/rule_gate.ts";
import { parseTraceStderr, traceEnvName } from "../engine/trace.ts";
import { evaluateCeilings, type ICeilings, type IEvaluation, parseCeilings, projectCeilings } from "./rule_ceiling.ts";
import { loadConfigDescriptor, readAndCompile } from "./project_loader.ts";

/** One ranked finding, with the rule that reported it. */
export interface IRankedFinding {
  readonly file: string;
  readonly rule: string;
  readonly line: number;
  readonly value: number;
  readonly message: string;
}

/** The findings of one file, ranked. */
export interface IFileSummary {
  readonly file: string;
  readonly max: number;
  readonly functions: readonly IRankedFinding[];
}

/** The whole report: every selected diagnostic, plus the ranked and top-limited views. */
export interface IReportSummary {
  /** Every diagnostic the selected rule reported, before ranking or top limiting. */
  readonly selected: number;
  readonly total: number;
  readonly topFiles: readonly IFileSummary[];
}

export interface ILintDiagnostic {
  readonly filename?: string;
  readonly code?: string;
  readonly message?: string;
  readonly range?: { readonly start?: { readonly line?: number } };
}

/** The validated shape of one `deno lint --json` run. */
export interface ILintReport {
  readonly diagnostics: readonly ILintDiagnostic[];
  readonly errors: readonly unknown[];
  readonly checked_files: readonly string[];
}

const DEFAULTS = { topFiles: 5, topFns: 5 };
const VALUE_PATTERN = /(?:complexity|score)\s+(\d+)|has\s+(\d+)\s+lines?/;
const MAX_STDERR = 8 * 1024;
const LINTABLE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** The numeric value a rule message carries: a complexity, a score, or a line count. */
export function parseValue(message: string): number | null {
  const match = VALUE_PATTERN.exec(message);
  if (match === null) return null;
  return Number(match[1] ?? match[2]);
}

/** Ranks diagnostics by their message value, highest first. Unrankable diagnostics stay in `selected` only. */
export function rankFindings(diagnostics: readonly ILintDiagnostic[]): IRankedFinding[] {
  const ranked: IRankedFinding[] = [];
  for (const diagnostic of diagnostics) {
    const value = diagnostic.message ? parseValue(diagnostic.message) : null;
    if (value === null) continue;
    ranked.push({
      file: diagnostic.filename ?? "",
      rule: diagnostic.code ?? "",
      line: diagnostic.range?.start?.line ?? 0,
      value,
      message: diagnostic.message ?? "",
    });
  }
  return ranked.sort((a, b) => b.value - a.value);
}

/** Groups ranked findings by file, keeping the top files and top functions per file. */
export function summarizeFiles(
  ranked: readonly IRankedFinding[],
  topFiles = DEFAULTS.topFiles,
  topFns = DEFAULTS.topFns,
  selected = ranked.length,
): IReportSummary {
  const byFile = new Map<string, IRankedFinding[]>();
  for (const finding of ranked) {
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }
  const summaries: IFileSummary[] = [...byFile].map(([file, findings]) => ({
    file,
    max: Math.max(...findings.map((f) => f.value)),
    functions: [...findings].sort((a, b) => b.value - a.value).slice(0, topFns),
  }));
  summaries.sort((a, b) => b.max - a.max);
  return { selected, total: ranked.length, topFiles: summaries.slice(0, topFiles) };
}

/** Validates one `deno lint --json` run. Status 1 is acceptable only with a complete diagnostics report. */
export function parseDenoLintOutput(stdout: string, status: number, stderr: string): ILintReport {
  if (status !== 0 && status !== 1) {
    throw new Error(`deno lint exited with status ${status}: ${stderr.slice(0, MAX_STDERR)}`);
  }
  let value: unknown;
  try {
    // The plugin prints one informational banner line before the JSON report.
    value = JSON.parse(stdout.replace(/^\[[^\]]+-lint\][^\n]*\n/, ""));
  } catch {
    throw new Error("deno lint produced no valid JSON report");
  }
  if (value === null || typeof value !== "object") throw new Error("deno lint produced no report object");
  const report = value as { diagnostics?: unknown; errors?: unknown; checked_files?: unknown };
  if (!Array.isArray(report.diagnostics) || !Array.isArray(report.errors) || !Array.isArray(report.checked_files)) {
    throw new Error("the deno lint report is missing its diagnostics, errors or checked_files");
  }
  const realErrors = report.errors.filter((entry) => !isSelectionNotice(entry));
  if (realErrors.length > 0) {
    throw new Error(
      `deno lint reported ${realErrors.length} error(s) ${JSON.stringify(realErrors).slice(0, 400)}: ` +
        stderr.slice(0, MAX_STDERR),
    );
  }
  // A clean Deno JSON report omits `checked_files`; a failing one must list the checked population.
  if (status === 1 && report.checked_files.length === 0) {
    throw new Error("deno lint exited 1 without a checked-file population");
  }
  if (status === 1 && report.diagnostics.length === 0) {
    throw new Error("deno lint exited 1 without any diagnostic");
  }
  return {
    diagnostics: report.diagnostics as readonly ILintDiagnostic[],
    errors: report.errors,
    checked_files: report.checked_files as string[],
  };
}

/** True when the entry is the plugin's informational selection banner rather than a scan failure. */
function isSelectionNotice(entry: unknown): boolean {
  return JSON.stringify(entry).includes("_LINT_RULES active:");
}

/** The generic ownership bucket of one file: the longest containing workspace member, or the root bucket `.`. */
export function ownerOf(file: string, rootPath: string, members: readonly string[]): string {
  const path = file.startsWith("file:") ? fromFileUrl(file) : file;
  const rel = relative(rootPath, path).replaceAll("\\", "/");
  let best = ".";
  for (const member of members) {
    const normalized = member.replace(/^\.\//, "").replace(/\/$/, "");
    if (rel !== normalized && !rel.startsWith(`${normalized}/`)) continue;
    if (best === "." || normalized.length > best.length) best = normalized;
  }
  return best;
}

/** Every workspace member, each ancestor bucket, each top-level source directory and the root bucket. */
function bucketsOf(rootPath: string, members: readonly string[]): string[] {
  const buckets = new Set<string>(["."]);
  for (const member of members) {
    const parts = member.split("/");
    for (let index = 1; index <= parts.length; index++) buckets.add(parts.slice(0, index).join("/"));
  }
  for (const entry of Deno.readDirSync(rootPath)) {
    if (!entry.isDirectory || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    buckets.add(entry.name);
  }
  return [...buckets].sort();
}

/** The workspace member roots of the descriptor's lint configuration. */
export async function workspaceMembersOf(rootPath: string, configPath: string): Promise<string[]> {
  let config: { workspace?: unknown };
  try {
    config = JSON.parse(await Deno.readTextFile(configPath)) as { workspace?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(config.workspace)) return [];
  const members = new Set<string>();
  for (const entry of config.workspace) {
    if (typeof entry !== "string") continue;
    const normalized = entry.replace(/^\.\//, "").replace(/\/$/, "");
    if (!normalized.includes("*")) {
      members.add(normalized);
      continue;
    }
    const star = normalized.indexOf("*");
    const prefix = normalized.slice(0, star).replace(/\/$/, "");
    try {
      for await (const item of Deno.readDir(join(rootPath, prefix))) {
        if (item.isDirectory) members.add(`${prefix}/${item.name}`);
      }
    } catch {
      // A missing glob root contributes no members.
    }
  }
  return [...members].sort();
}

/** Counts the selected diagnostics per rule and per ownership bucket. */
export function countsByOwner(
  diagnostics: readonly ILintDiagnostic[],
  owner: (file: string) => string,
): ICeilings {
  const counts: Record<string, Record<string, number>> = {};
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === undefined) continue;
    const row = counts[diagnostic.code] ?? {};
    const bucket = owner(diagnostic.filename ?? "");
    row[bucket] = (row[bucket] ?? 0) + 1;
    counts[diagnostic.code] = row;
  }
  return counts;
}

/** True when at least one lintable source file sits under the requested roots. */
async function hasLintableFile(roots: readonly string[]): Promise<boolean> {
  const skip = new Set(["node_modules", ".git", "dist", "coverage"]);
  const visit = async (path: string): Promise<boolean> => {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(path);
    } catch {
      return false;
    }
    if (stat.isFile) return LINTABLE_EXTENSIONS.some((extension) => path.endsWith(extension));
    if (!stat.isDirectory) return false;
    for await (const entry of Deno.readDir(path)) {
      if (entry.isDirectory && skip.has(entry.name)) continue;
      if (await visit(join(path, entry.name))) return true;
    }
    return false;
  };
  for (const root of roots) {
    if (await visit(root)) return true;
  }
  return false;
}

const RULE_ID_SEPARATOR = "/";
const MAX_MISSING_LISTED = 5;

/** The host observations that prove a plugin evaluated one rule over a population. */
export interface IRuleEvidenceInput {
  readonly rule: string;
  readonly runId: string;
  readonly stderr: string;
  readonly checkedFiles: readonly string[];
  readonly cwd: string;
}

/** The working-directory-relative path of a file the host reported. */
function relativeFile(file: string, cwd: string): string {
  const path = file.startsWith("file:") ? fromFileUrl(file) : file;
  return relative(cwd, path).replaceAll("\\", "/");
}

/**
 * Fails unless the lint plugin itself reported that the rule ran on files. Absent diagnostics prove nothing,
 * so the trace records are the only accepted evidence: a plugin that never loaded or a rule that its selection
 * switched off leaves no terminal record, and a listed lint file without a record was never evaluated.
 */
export function assertRuleEvidence(input: IRuleEvidenceInput): void {
  const { records } = parseTraceStderr(input.stderr, input.runId);
  if (records.length === 0) {
    throw new Error(
      `the lint plugin reported no observation for ${input.rule}: it is absent from the lint config or did not load`,
    );
  }
  const terminal = records.filter((record) => record.kind !== "observed" && record.rule === input.rule);
  if (terminal.length === 0) {
    throw new Error(`the lint plugin did not evaluate ${input.rule}: the rule is inactive or its selection is off`);
  }
  if (!terminal.some((record) => record.kind === "checked")) {
    throw new Error(`no file in the requested roots is in the scope of ${input.rule}`);
  }
  const evaluated = new Set(terminal.map((record) => record.file));
  const missing = input.checkedFiles
    .filter((file) => LINTABLE_EXTENSIONS.some((extension) => file.endsWith(extension)))
    .map((file) => relativeFile(file, input.cwd))
    .filter((file) => !evaluated.has(file));
  if (missing.length > 0) {
    throw new Error(`incomplete coverage: ${missing.slice(0, MAX_MISSING_LISTED).join(", ")}`);
  }
}

/** Where one lint scan runs: the descriptor root with its own lint config, or the caller's directory. */
interface IScanTarget {
  readonly cwd: string;
  readonly configPath: string | null;
}

/** Runs `deno lint --json` for one rule over the given roots. The rule id is `<plugin>/<key>`. */
async function runDenoLint(
  rule: string,
  roots: readonly string[],
  target: IScanTarget | null = null,
): Promise<ILintDiagnostic[]> {
  const cwd = target?.cwd ?? Deno.cwd();
  const scanRoots = target === null ? roots : roots.map((root) => resolve(Deno.cwd(), root));
  if (!(await hasLintableFile(scanRoots))) throw new Error("the requested scan contains no lintable file");
  const runId = `rule-report-${crypto.randomUUID()}`;
  const pluginName = rule.split(RULE_ID_SEPARATOR)[0];
  const command = new Deno.Command(Deno.execPath(), {
    args: ["lint", "--json", ...(target?.configPath ? ["--config", target.configPath] : []), ...scanRoots],
    cwd,
    env: { [selectionEnvNameForRule(rule)]: rule, [traceEnvName(pluginName)]: runId },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stderr = new TextDecoder().decode(output.stderr);
  const report = parseDenoLintOutput(new TextDecoder().decode(output.stdout), output.code, stderr);
  assertRuleEvidence({ rule, runId, stderr, checkedFiles: report.checked_files, cwd });
  return report.diagnostics.filter((diagnostic) => diagnostic.code === rule);
}

/** Reads one `--name=value` flag. */
function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/** One ceiling evaluation beside the ranked report. */
interface ICeilingReport {
  readonly selected: number;
  readonly total: number;
  readonly evaluation: IEvaluation;
}

/** Loads the descriptor, the ceilings and the measured counts for one rule. */
async function evaluateReportCeilings(
  rule: string,
  descriptorEntry: string,
  ceilingsPath: string,
  root: string,
  roots: readonly string[],
): Promise<ICeilingReport> {
  const descriptor = await loadConfigDescriptor(root, descriptorEntry, null);
  const compiled = await readAndCompile(descriptor);
  const rootPath = fromFileUrl(descriptor.rootUrl);
  const members = await workspaceMembersOf(rootPath, fromFileUrl(descriptor.lintConfigUrl));
  const knownRules = Object.keys(compiled.rules);
  const knownPackages = bucketsOf(rootPath, members);
  const ceilings = parseCeilings(await Deno.readTextFile(join(root, ceilingsPath)), knownRules, knownPackages);
  const target = { cwd: rootPath, configPath: fromFileUrl(descriptor.lintConfigUrl) };
  const diagnostics = await runDenoLint(rule, roots, target);
  const counts = countsByOwner(diagnostics, (file) => ownerOf(file, rootPath, members));
  return {
    selected: diagnostics.length,
    total: rankFindings(diagnostics).length,
    evaluation: evaluateCeilings(projectCeilings(ceilings, rule), counts, knownRules, knownPackages),
  };
}

/** Renders the ceiling report as JSON or text and returns the failure count. */
function renderCeilings(rule: string, report: ICeilingReport, asJson: boolean): number {
  const failures = report.evaluation.over.length + report.evaluation.unknownRules.length +
    report.evaluation.unknownPackages.length;
  if (asJson) {
    console.log(JSON.stringify(
      {
        rule,
        selected: report.selected,
        total: report.total,
        ceilings: report.evaluation,
      },
      null,
      2,
    ));
    return failures;
  }
  console.log(`📊 ${rule}: ${report.selected} selected diagnostic(s), ${report.total} rankable`);
  for (const entry of report.evaluation.over) {
    console.log(`  ❌ ${entry.rule} ${entry.packageName}: ${entry.count} > ${entry.ceiling}`);
  }
  for (const entry of report.evaluation.under) {
    console.log(`  ⬇️  ${entry.rule} ${entry.packageName}: ${entry.count} < ${entry.ceiling}`);
  }
  for (const unknown of report.evaluation.unknownRules) console.log(`  ❌ unknown rule '${unknown}'`);
  for (const unknown of report.evaluation.unknownPackages) console.log(`  ❌ unknown bucket '${unknown}'`);
  console.log(failures === 0 ? "\n✅ Ceilings hold." : `\n⚠️  ${failures} ceiling breach(es).`);
  return failures;
}

async function main(): Promise<void> {
  const args = Deno.args;
  const rule = flagValue(args, "rule");
  if (!rule) {
    console.error(
      "Usage: rule_report.ts --rule=<id> [--roots=a,b] [--topFiles=5] [--topFns=5] [--json] [--fail] " +
        "[--descriptor=<entry> --ceilings=<file>]",
    );
    Deno.exit(2);
  }
  const roots = (flagValue(args, "roots") ?? ".").split(",").filter((root) => root.length > 0);
  if (roots.length === 0) {
    console.error("rule_report.ts needs at least one root to scan");
    Deno.exit(2);
  }
  const topFiles = Number(flagValue(args, "topFiles") ?? DEFAULTS.topFiles);
  const topFns = Number(flagValue(args, "topFns") ?? DEFAULTS.topFns);
  const asJson = args.includes("--json");
  const shouldFail = args.includes("--fail");
  const root = Deno.cwd();

  const descriptorEntry = flagValue(args, "descriptor");
  const ceilingsPath = flagValue(args, "ceilings");
  if ((descriptorEntry === undefined) !== (ceilingsPath === undefined)) {
    console.error("--descriptor and --ceilings go together");
    Deno.exit(2);
  }
  if (descriptorEntry !== undefined && ceilingsPath !== undefined) {
    const ceilingReport = await evaluateReportCeilings(rule, descriptorEntry, ceilingsPath, root, roots);
    const failures = renderCeilings(rule, ceilingReport, asJson);
    if (shouldFail && failures > 0) Deno.exit(1);
    return;
  }

  const findings = await runDenoLint(rule, roots);
  const ranked = rankFindings(findings).map((finding) => ({
    ...finding,
    file: relative(root, finding.file.startsWith("file://") ? fromFileUrl(finding.file) : finding.file),
  }));
  const summary = summarizeFiles(ranked, topFiles, topFns, findings.length);

  if (asJson) {
    console.log(
      JSON.stringify(
        { rule, selected: summary.selected, total: summary.total, topFiles: summary.topFiles },
        null,
        2,
      ),
    );
  } else {
    console.log(`📊 ${rule}: ${summary.total} finding(s) above the catalog limit`);
    for (const file of summary.topFiles) {
      console.log(`  - ${file.file}: ${file.max}`);
      for (const fn of file.functions) console.log(`      • line ${fn.line}: ${fn.value}`);
    }
    console.log(summary.selected === 0 ? "\n✅ No breaches." : `\n⚠️  ${summary.selected} breach(es).`);
  }

  if (shouldFail && summary.selected > 0) Deno.exit(1);
}

if (import.meta.main) await main();
