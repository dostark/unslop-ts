#!/usr/bin/env -S deno run -A
/**
 * @module RuleReport
 * @path src/cli/rule_report.ts
 * @description Runs one catalog rule over given roots and ranks the findings by their message value.
 * @architectural-layer Tooling
 * @related-files [src/engine/plugin.ts, tests/rule_report_test.ts]
 * @public Exports are the unit-test surface of this module.
 *
 * Usage:
 *   deno run -A src/cli/rule_report.ts --rule=<id> [--roots=a,b] [--topFiles=5] [--topFns=5] [--json] [--fail]
 */

import { fromFileUrl, relative } from "@std/path";
import { selectionEnvNameForRule } from "../engine/rule_gate.ts";

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

interface ILintReport {
  readonly diagnostics?: readonly ILintDiagnostic[];
}

const DEFAULTS = { topFiles: 5, topFns: 5 };
const VALUE_PATTERN = /(?:complexity|score)\s+(\d+)|has\s+(\d+)\s+lines?/;

/** The numeric value a rule message carries: a complexity, a score, or a line count. */
export function parseValue(message: string): number | null {
  const match = VALUE_PATTERN.exec(message);
  if (match === null) return null;
  return Number(match[1] ?? match[2]);
}

/** Ranks diagnostics by their message value, highest first. */
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

/** Runs `deno lint --json` for one rule over the given roots and returns its diagnostics. The rule id is `<plugin>/<key>`. */
async function runDenoLint(rule: string, roots: readonly string[]): Promise<ILintDiagnostic[]> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["lint", "--json", ...roots],
    env: { [selectionEnvNameForRule(rule)]: rule },
    stdout: "piped",
    stderr: "null",
  });
  const { stdout } = await command.output();
  // SAFETY: `deno lint --json` emits exactly this diagnostic shape.
  const report = JSON.parse(new TextDecoder().decode(stdout)) as ILintReport;
  return (report.diagnostics ?? []).filter((diagnostic) => diagnostic.code === rule);
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const args = Deno.args;
  const rule = flagValue(args, "rule");
  if (!rule) {
    console.error("Usage: rule_report.ts --rule=<id> [--roots=a,b] [--topFiles=5] [--topFns=5] [--json] [--fail]");
    Deno.exit(2);
  }
  const roots = (flagValue(args, "roots") ?? ".").split(",").filter((root) => root.length > 0);
  const topFiles = Number(flagValue(args, "topFiles") ?? DEFAULTS.topFiles);
  const topFns = Number(flagValue(args, "topFns") ?? DEFAULTS.topFns);
  const asJson = args.includes("--json");
  const shouldFail = args.includes("--fail");

  const root = Deno.cwd();
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
    console.log(summary.total === 0 ? "\n✅ No breaches." : `\n⚠️  ${summary.total} breach(es).`);
  }

  if (shouldFail && summary.total > 0) Deno.exit(1);
}

if (import.meta.main) await main();
