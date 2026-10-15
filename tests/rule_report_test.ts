/**
 * @module RuleReportTest
 * @path packages/lint-rules/tests/rule_report_test.ts
 * @description Ranking and summarising for the rule-report CLI.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/cli/rule_report.ts]
 */

import { assertEquals } from "@std/assert";
import { type ILintDiagnostic, parseValue, rankFindings, summarizeFiles } from "../src/cli/rule_report.ts";

Deno.test("parseValue reads the complexity value", () => {
  assertEquals(parseValue("Function f has cyclomatic complexity 30 (limit 15)."), 30);
});

Deno.test("parseValue reads the class-size score", () => {
  assertEquals(parseValue("Class C score 72 (limit 60; 5 methods, 300 lines)."), 72);
});

Deno.test("parseValue returns null when the message carries no value", () => {
  assertEquals(parseValue("A boolean-wrapped assertion hides the failing value."), null);
});

function diagnostic(file: string, line: number, value: number): ILintDiagnostic {
  return {
    filename: file,
    code: "exaix/max-cyclomatic-complexity",
    message: `Function f${value} has cyclomatic complexity ${value} (limit 15).`,
    range: { start: { line } },
  };
}

Deno.test("rankFindings sorts by value, highest first", () => {
  const ranked = rankFindings([diagnostic("a.ts", 1, 16), diagnostic("b.ts", 2, 30), diagnostic("c.ts", 3, 20)]);
  assertEquals(ranked.map((f) => f.value), [30, 20, 16]);
  assertEquals(ranked[0].line, 2);
});

Deno.test("rankFindings drops diagnostics without a numeric value", () => {
  const ranked = rankFindings([{ filename: "a.ts", message: "no number here" }]);
  assertEquals(ranked, []);
});

Deno.test("summarizeFiles groups by file and keeps the top functions", () => {
  const ranked = rankFindings([
    diagnostic("a.ts", 1, 40),
    diagnostic("a.ts", 2, 20),
    diagnostic("a.ts", 3, 16),
    diagnostic("b.ts", 4, 30),
  ]);
  const summary = summarizeFiles(ranked, 5, 2);
  assertEquals(summary.total, 4);
  assertEquals(summary.topFiles.map((f) => f.file), ["a.ts", "b.ts"]);
  assertEquals(summary.topFiles[0].max, 40);
  assertEquals(summary.topFiles[0].functions.map((f) => f.value), [40, 20]);
});

Deno.test("summarizeFiles limits the number of top files", () => {
  const ranked = rankFindings([diagnostic("a.ts", 1, 40), diagnostic("b.ts", 2, 30), diagnostic("c.ts", 3, 20)]);
  const summary = summarizeFiles(ranked, 2, 5);
  assertEquals(summary.topFiles.map((f) => f.file), ["a.ts", "b.ts"]);
});
