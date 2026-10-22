/**
 * @module ReportMarkdown
 * @path src/report/markdown.ts
 * @description Markdown report and rule tables with escaped cells, links, and foreign findings.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/report/model.ts, src/cli/rules_read.ts]
 */

import type { IFinding, IRunReport } from "./model.ts";

/** Escapes one Markdown table cell. */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/** Escapes inline Markdown text outside a table cell. */
export function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!<>])/g, "\\$1");
}

/** A link whose display text is escaped and whose target is percent-encoded. */
export function markdownLink(path: string): string {
  const target = path.split("/").map(encodeURIComponent).join("/");
  return `[${escapeMarkdownCell(escapeMarkdownText(path))}](${target})`;
}

/** A deterministic Markdown table. */
export function markdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const head = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`);
  return [head, divider, ...body].join("\n");
}

function skippedText(skipped: Readonly<Record<string, number>>): string {
  return Object.entries(skipped).map(([reason, count]) => `${reason}=${count}`).join(" ");
}

function findingRow(finding: IFinding, origin: string): string[] {
  return [
    `\`${finding.ruleId}\``,
    origin,
    markdownLink(finding.file),
    `${finding.startLine}:${finding.startColumn}-${finding.endLine}:${finding.endColumn}`,
    finding.effectiveLevel,
    escapeMarkdownText(finding.message),
    finding.hint === null ? "" : escapeMarkdownText(finding.hint),
  ];
}

/** Renders the report as Markdown with separate selected and foreign sections. */
export function markdownReport(report: IRunReport): string {
  const lines = [
    "# unslop-ts report",
    "",
    `- **Completion:** ${report.completion}`,
    ...(report.failure === null ? [] : [`- **Failure:** ${escapeMarkdownText(report.failure)}`]),
    `- **Host exit:** ${report.hostExitCode === null ? "unavailable" : report.hostExitCode}`,
    `- **Files observed:** ${report.filesObserved.length}`,
    "- **Host-wide visitation:** unavailable",
    "",
    "## Rule coverage",
    "",
    markdownTable(
      ["Rule", "Status", "Coverage", "Checked", "Skipped", "Findings"],
      report.rules.map((summary) => [
        `\`${summary.rule.id}\``,
        summary.status,
        summary.coverage,
        String(summary.observedChecked),
        skippedText(summary.observedSkipped),
        String(summary.findings),
      ]),
    ),
    "",
    "## Findings",
    "",
    markdownTable(
      ["Rule", "Origin", "File", "Location", "Level", "Message", "Hint"],
      report.findings.map((finding) => findingRow(finding, "unslop")),
    ),
    "",
    "## Foreign findings",
    "",
    markdownTable(
      ["Rule", "Origin", "File", "Location", "Level", "Message", "Hint"],
      report.foreignFindings.map((finding) => findingRow(finding, "foreign")),
    ),
    "",
    "## Not run",
    "",
    markdownTable(
      ["Check", "Mode", "Command"],
      report.notRun.map((check) => [
        `\`${check.id}\``,
        check.mode,
        check.command === null ? "" : check.command.join(" "),
      ]),
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
