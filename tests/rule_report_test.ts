/**
 * @module RuleReportTest
 * @path tests/rule_report_test.ts
 * @description Ranking and summarising for the rule-report CLI.
 * @architectural-layer Test
 * @related-files [src/cli/rule_report.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  countsByOwner,
  type ILintDiagnostic,
  ownerOf,
  parseDenoLintOutput,
  parseValue,
  rankFindings,
  summarizeFiles,
  workspaceMembersOf,
} from "../src/cli/rule_report.ts";
import { DEMO_PLUGIN_NAME, runDeno, withDemoProject } from "./helpers/demo_project.ts";

Deno.test("parseValue reads the complexity value", () => {
  assertEquals(parseValue("Function f has cyclomatic complexity 30 (limit 15)."), 30);
});

Deno.test("parseValue reads the class-size score", () => {
  assertEquals(parseValue("Class C score 72 (limit 60; 5 methods, 300 lines)."), 72);
});

Deno.test("parseValue reads the function line count", () => {
  assertEquals(parseValue("Function f has 61 lines (limit 60)."), 61);
});

Deno.test("parseValue returns null when the message carries no value", () => {
  assertEquals(parseValue("A boolean-wrapped assertion hides the failing value."), null);
});

function diagnostic(file: string, line: number, value: number): ILintDiagnostic {
  return {
    filename: file,
    code: "demo/max-cyclomatic-complexity",
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

Deno.test("rankFindings keeps the rule id of each finding", () => {
  const [ranked] = rankFindings([diagnostic("a.ts", 1, 20)]);
  assertEquals(ranked.rule, "demo/max-cyclomatic-complexity");
});

Deno.test("summarizeFiles keeps every selected diagnostic apart from the ranked view", () => {
  const ranked = rankFindings([diagnostic("a.ts", 1, 40), diagnostic("a.ts", 2, 20)]);
  const summary = summarizeFiles(ranked, 5, 1, 3);
  assertEquals(summary.selected, 3);
  assertEquals(summary.total, 2);
  assertEquals(summary.topFiles[0].functions.length, 1);
});

Deno.test("summarizeFiles limits the number of top files", () => {
  const ranked = rankFindings([diagnostic("a.ts", 1, 40), diagnostic("b.ts", 2, 30), diagnostic("c.ts", 3, 20)]);
  const summary = summarizeFiles(ranked, 2, 5);
  assertEquals(summary.topFiles.map((f) => f.file), ["a.ts", "b.ts"]);
});

const BRANCHING_SOURCE = "export function pick(flag: boolean): number {\n  if (flag) return 1;\n  return 2;\n}\n";
const LONG_SOURCE = "export function long(): void {\n" + "  void 0;\n".repeat(59) + "}\n";

Deno.test("rule_report run from another cwd reports paths relative to that cwd and selects the rule by plugin name", async () => {
  const script = new URL("../src/cli/rule_report.ts", import.meta.url).href;
  const rule = `${DEMO_PLUGIN_NAME}/max-cyclomatic-complexity`;
  await withDemoProject({ files: { "branching.ts": BRANCHING_SOURCE } }, async (dir) => {
    const result = await runDeno(["run", "-A", script, `--rule=${rule}`, "--roots=branching.ts"], dir);
    assertStringIncludes(result.stdout, `${rule}: 1 finding(s)`);
    assertStringIncludes(result.stdout, "- branching.ts: 2");
  });
});

Deno.test("size-report-ranking: a size-only breach reaches the command with its value and full counts", async () => {
  const script = new URL("../src/cli/rule_report.ts", import.meta.url).href;
  const rule = `${DEMO_PLUGIN_NAME}/max-function-lines`;
  await withDemoProject({ files: { "long_one.ts": LONG_SOURCE, "long_two.ts": LONG_SOURCE } }, async (dir) => {
    const result = await runDeno([
      "run",
      "-A",
      script,
      `--rule=${rule}`,
      "--roots=.",
      "--topFiles=1",
      "--topFns=1",
      "--json",
    ], dir);
    const report = JSON.parse(result.stdout) as {
      selected: number;
      total: number;
      topFiles: { file: string; functions: { rule: string; value: number }[] }[];
    };
    assertEquals(report.selected, 2);
    assertEquals(report.total, 2);
    assertEquals(report.topFiles.length, 1);
    assertEquals(report.topFiles[0].functions.length, 1);
    assertEquals(report.topFiles[0].functions[0].rule, rule);
    assertEquals(report.topFiles[0].functions[0].value, 61);
  });
});

Deno.test("rule-report-generic-owner: nested members, globs, file URLs and the root bucket", async () => {
  const root = await Deno.makeTempDir({ prefix: "unslop_owner_" });
  try {
    await Deno.mkdir(join(root, "packages/alpha/nested"), { recursive: true });
    await Deno.mkdir(join(root, "apps/beta"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "deno.json"),
      JSON.stringify({ workspace: ["./packages/*", "./apps/beta", "./missing/glob/*"] }),
    );
    const members = await workspaceMembersOf(root, join(root, "deno.json"));
    assertEquals(members, ["apps/beta", "packages/alpha"]);
    assertEquals(
      ownerOf(`file://${join(root, "packages/alpha/nested/a.ts")}`, root, members),
      "packages/alpha",
    );
    assertEquals(ownerOf(join(root, "packages/alpha/a.ts"), root, members), "packages/alpha");
    assertEquals(ownerOf(join(root, "scripts/a.ts"), root, members), ".");
    assertEquals(ownerOf("file:///tmp/elsewhere/a.ts", root, members), ".");
    const counts = countsByOwner([
      { filename: join(root, "packages/alpha/a.ts"), code: "demo/a" },
      { filename: join(root, "packages/alpha/b.ts"), code: "demo/a" },
      { filename: join(root, "scripts/c.ts"), code: "demo/a" },
    ], (file) => ownerOf(file, root, members));
    assertEquals(counts, { "demo/a": { "packages/alpha": 2, ".": 1 } });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("rule-report-completeness: malformed, failed and empty scans cannot pass", () => {
  const valid = JSON.stringify({
    diagnostics: [{ filename: "a.ts", code: "demo/a", message: "complexity 16" }],
    errors: [],
    checked_files: ["a.ts"],
  });
  assertEquals(parseDenoLintOutput(valid, 1, "").checked_files.length, 1);
  assertEquals(
    parseDenoLintOutput(JSON.stringify({ diagnostics: [], errors: [], checked_files: ["a.ts"] }), 0, "")
      .diagnostics.length,
    0,
  );
  assertThrows(() => parseDenoLintOutput("not json", 0, ""), Error, "no valid JSON");
  assertThrows(() => parseDenoLintOutput(valid, 2, "boom"), Error, "status 2");
  assertThrows(
    () =>
      parseDenoLintOutput(
        JSON.stringify({ diagnostics: [], errors: [{ message: "parse" }], checked_files: ["a.ts"] }),
        1,
        "",
      ),
    Error,
    "error(s)",
  );
  assertThrows(
    () => parseDenoLintOutput(JSON.stringify({ diagnostics: [], errors: [], checked_files: [] }), 0, ""),
    Error,
    "checked no files",
  );
  assertThrows(
    () => parseDenoLintOutput(JSON.stringify({ diagnostics: [], errors: [], checked_files: ["a.ts"] }), 1, ""),
    Error,
    "without any diagnostic",
  );
  assertThrows(
    () => parseDenoLintOutput(JSON.stringify({ diagnostics: [] }), 0, ""),
    Error,
    "missing",
  );
});

Deno.test("rule-report-all-diagnostics: an unrankable diagnostic still counts and top never lowers the gate", () => {
  const diagnostics: readonly ILintDiagnostic[] = [
    {
      filename: "a.ts",
      code: "demo/a",
      message: "Function f has 61 lines (limit 60).",
      range: { start: { line: 1 } },
    },
    {
      filename: "b.ts",
      code: "demo/a",
      message: "A boolean-wrapped assertion hides the failing value.",
      range: { start: { line: 2 } },
    },
  ];
  const ranked = rankFindings(diagnostics);
  assertEquals(ranked.length, 1);
  const summary = summarizeFiles(ranked, 1, 1, diagnostics.length);
  assertEquals(summary.selected, 2);
  assertEquals(summary.total, 1);
  assertEquals(summary.topFiles.length, 1);
  assertEquals(summary.topFiles[0].functions.length, 1);
});
