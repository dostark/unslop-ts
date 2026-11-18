/**
 * @module CycleReport
 * @path src/rules/whole_tree/cycle_report.ts
 * @description Bounded text, JSON and SARIF views of one import cycle analysis.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/whole_tree/import_cycles.ts, src/report/sarif.ts, src/cli/whole_tree.ts]
 */

import { type ISarifLog, sarifCycleReport } from "../../report/sarif.ts";
import type { ICycleAnalysis, ICycleFinding } from "./import_cycles.ts";

/** One selected, bounded set of cycle rows. */
interface ICycleView {
  readonly cycles: readonly ICycleFinding[];
  readonly truncated: boolean;
}

/** The JSON document of one cycle report. */
export interface ICycleJsonReport {
  readonly version: number;
  readonly truncated: boolean;
  readonly totals: ICycleAnalysis["totals"];
  readonly graph: ICycleAnalysis["graph"];
  readonly cycles: readonly ICycleFinding[];
}

/** The text document of one cycle report. */
export interface ICycleTextReport {
  readonly text: string;
  readonly truncated: boolean;
  readonly shown: number;
}

/** The SARIF document of one cycle report. */
export interface ICycleSarifReport {
  readonly sarif: ISarifLog;
  readonly truncated: boolean;
  readonly shown: number;
}

/** The schema version of the JSON cycle report. */
const CYCLE_REPORT_VERSION = 1;

/** The largest cycle row count any report prints, whatever `--top` asks. */
export const MAX_CYCLES_REPORTED = 1000;

/** The largest report any renderer writes, in UTF-8 bytes. */
const MAX_REPORT_BYTES = 8 * 1024 * 1024;

/** The rows one report may print: `--top` first, then the hard row cap. */
function selectCycleView(rows: readonly ICycleFinding[], top: number): ICycleView {
  const limit = Math.min(top, MAX_CYCLES_REPORTED);
  return { cycles: rows.slice(0, limit), truncated: rows.length > limit };
}

/** The UTF-8 byte length of a rendered report. */
function reportBytes(value: string | object): number {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length;
}

/** Halves the row count until the rendered report fits the byte bound. */
function fitToBytes<T extends string | object>(
  rows: readonly ICycleFinding[],
  render: (rows: readonly ICycleFinding[]) => T,
  maxBytes: number,
): { readonly value: T; readonly shown: number } {
  let count = rows.length;
  for (;;) {
    const value = render(rows.slice(0, count));
    if (count === 0 || reportBytes(value) <= maxBytes) return { value, shown: count };
    count = Math.floor(count / 2);
  }
}

/** The summary lines of one cycle report, shared by every renderer. */
function cycleSummaryLines(analysis: ICycleAnalysis): string[] {
  const { totals, graph } = analysis;
  const lines = [
    `${totals.runtime_sccs} runtime cycle(s) · ${totals.files} file(s) in runtime cycles · ` +
    `${totals.type_only_sccs} type-only cycle(s) · ${totals.mixed_sccs} mixed cycle(s)`,
    `${graph.runtime_edges} runtime edge(s) · ${graph.type_edges} type edge(s) · ${graph.code_files} code file(s)`,
  ];
  if (graph.complete) {
    lines.push("Graph complete within the scan scope.");
    return lines;
  }
  lines.push(
    `Graph incomplete · ${graph.unresolved} unresolved reference(s); the gate cannot certify a cycle-free run.`,
  );
  for (const reference of graph.unresolved_refs) {
    lines.push(`  ${reference.from} imports '${reference.specifier}'`);
  }
  return lines;
}

/** The lines of one cycle finding. */
function cycleFindingLines(finding: ICycleFinding): string[] {
  const lines = [
    `${finding.kind} ${finding.id} · ${finding.size} file(s) · ${finding.edge_count} edge(s)`,
    `  members: ${finding.files.join(", ")}`,
    `  path: ${finding.path.join(" -> ")}${finding.path_truncated ? " (truncated)" : ""}`,
  ];
  if (finding.edges.length > 0) {
    lines.push("  edges:");
    for (const edge of finding.edges) lines.push(`    ${edge.from} -> ${edge.to} (${edge.kind}, ${edge.form})`);
  }
  return lines;
}

/** The text view of one cycle report. */
export function cycleTextReport(
  analysis: ICycleAnalysis,
  rows: readonly ICycleFinding[],
  top: number,
  trace: string | null = null,
  maxBytes: number = MAX_REPORT_BYTES,
): ICycleTextReport {
  const view = selectCycleView(rows, top);
  const render = (cycles: readonly ICycleFinding[]): string => {
    const lines = ["UNSLOP IMPORT CYCLES", "====================", ...cycleSummaryLines(analysis)];
    if (trace !== null) lines.push(`Cycles that contain ${trace}:`);
    if (rows.length === 0) {
      lines.push("", trace === null ? "✅ No import cycles found." : `No cycle contains ${trace}.`);
      return lines.join("\n");
    }
    const truncated = view.truncated || cycles.length < view.cycles.length;
    lines.push("", `${cycles.length} shown of ${rows.length} cycle(s):`);
    if (truncated) lines.push("Report bounded: more cycle rows exist than this report prints.");
    for (const finding of cycles) lines.push(...cycleFindingLines(finding), "");
    return lines.join("\n");
  };
  const fit = fitToBytes(view.cycles, render, maxBytes);
  return { text: fit.value, truncated: view.truncated || fit.shown < view.cycles.length, shown: fit.shown };
}

/** The JSON view of one cycle report. */
export function cycleJsonReport(
  analysis: ICycleAnalysis,
  rows: readonly ICycleFinding[],
  top: number,
  maxBytes: number = MAX_REPORT_BYTES,
): ICycleJsonReport {
  const view = selectCycleView(rows, top);
  const render = (cycles: readonly ICycleFinding[]): ICycleJsonReport => ({
    version: CYCLE_REPORT_VERSION,
    truncated: view.truncated || cycles.length < view.cycles.length,
    totals: analysis.totals,
    graph: analysis.graph,
    cycles,
  });
  return fitToBytes(view.cycles, render, maxBytes).value;
}

/** The SARIF view of one cycle report. */
export function cycleSarifReport(
  rows: readonly ICycleFinding[],
  top: number,
  projectRoot: string,
  maxBytes: number = MAX_REPORT_BYTES,
): ICycleSarifReport {
  const view = selectCycleView(rows, top);
  const render = (cycles: readonly ICycleFinding[]): ISarifLog =>
    sarifCycleReport(cycles, projectRoot, view.truncated || cycles.length < view.cycles.length);
  const fit = fitToBytes(view.cycles, render, maxBytes);
  return { sarif: fit.value, truncated: view.truncated || fit.shown < view.cycles.length, shown: fit.shown };
}
