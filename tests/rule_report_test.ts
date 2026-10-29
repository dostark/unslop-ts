/**
 * @module RuleReportTest
 * @path tests/rule_report_test.ts
 * @description Ranking and summarising for the rule-report CLI.
 * @architectural-layer Test
 * @related-files [src/cli/rule_report.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { formatTraceRecord, type ITraceRecord } from "../src/engine/trace.ts";
import {
  assertRuleEvidence,
  countsByOwner,
  type ILintDiagnostic,
  ownerOf,
  parseDenoLintOutput,
  parseValue,
  rankFindings,
  summarizeFiles,
  workspaceMembersOf,
} from "../src/cli/rule_report.ts";
import { DEMO_PLUGIN_NAME, enginePins, runDeno, withDemoProject } from "./helpers/demo_project.ts";

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
    () => parseDenoLintOutput(JSON.stringify({ diagnostics: [], errors: [], checked_files: [] }), 1, ""),
    Error,
    "checked-file population",
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

const EVIDENCE_RULE = "demo/max-cyclomatic-complexity";
const EVIDENCE_RUN = "evidence-run";

/** One trace line for the evidence rule. */
function traceLine(kind: ITraceRecord["kind"], file: string, rule = EVIDENCE_RULE, runId = EVIDENCE_RUN): string {
  const base = { runId, plugin: DEMO_PLUGIN_NAME, file };
  if (kind === "observed") return formatTraceRecord({ ...base, kind, rule: "internal-coverage" });
  if (kind === "checked") return formatTraceRecord({ ...base, kind, rule });
  return formatTraceRecord({ ...base, kind, rule, reason: "scope" });
}

/** The evidence check with the fixed rule, run id and working directory of these tests. */
function evidence(lines: readonly string[], checkedFiles: readonly string[] = []): void {
  assertRuleEvidence({
    rule: EVIDENCE_RULE,
    runId: EVIDENCE_RUN,
    stderr: lines.join("\n"),
    checkedFiles,
    cwd: "/project",
  });
}

Deno.test("rule-report-evidence: only a loaded plugin that evaluated the rule on its files is evidence", () => {
  assertThrows(() => evidence([]), Error, "reported no observation");
  assertThrows(() => evidence(["unrelated host line"]), Error, "reported no observation");
  assertThrows(() => evidence([traceLine("observed", "a.ts")]), Error, "did not evaluate");
  assertThrows(() => evidence([traceLine("checked", "a.ts", "demo/other-rule")]), Error, "did not evaluate");
  assertThrows(() => evidence([traceLine("skipped", "a.ts")]), Error, "no file in the requested roots");
  assertThrows(
    () => evidence([traceLine("checked", "a.ts", EVIDENCE_RULE, "forged")]),
    Error,
    "reported no observation",
  );
  evidence([traceLine("checked", "a.ts")]);
  evidence([traceLine("checked", "a.ts"), traceLine("skipped", "b_test.ts")], [
    "file:///project/a.ts",
    "/project/b_test.ts",
  ]);
  assertThrows(
    () => evidence([traceLine("checked", "a.ts")], ["file:///project/a.ts", "file:///project/missed.ts"]),
    Error,
    "incomplete coverage: missed.ts",
  );
});

const REPORT_DESCRIPTOR = `import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";

const rootUrl = new URL("./", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "demo",
  rootUrl,
  configUrl: new URL("unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {},
  wholeTreeHosts: {},
};
`;

const REPORT_PLUGIN = `import { createUnslopProject } from "@dostark/unslop-ts/deno";
import { descriptor } from "./unslop.project.ts";
import config from "./unslop.config.json" with { type: "json" };

export default createUnslopProject({ descriptor, config }).plugin;
`;

const REPORT_CONFIG = {
  version: 2,
  plugin: "demo",
  extends: [],
  docsBase: "docs/",
  paths: { test: ["**/*_test.ts"], fixture: ["**/fixtures/**"], ignore: [] },
  rules: { "demo/max-cyclomatic-complexity": { level: "error", options: { max: 1, variant: "classic" } } },
};

const ENGINE_MODULE = new URL("../mod.ts", import.meta.url).href;
const ENGINE_DENO_MODULE = new URL("../deno.ts", import.meta.url).href;
const SCRIPT_URL = new URL("../src/cli/rule_report.ts", import.meta.url).href;
const CEILING_RULE = "demo/max-cyclomatic-complexity";

/** Writes a ceiling project whose lint config loads the plugin only when asked. */
async function withCeilingProject(
  options: { readonly plugin: boolean; readonly source: string; readonly ceiling: number },
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "rule_report_ceiling_" });
  try {
    await Deno.mkdir(join(dir, "packages/x/src"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({
        imports: {
          "@dostark/unslop-ts": ENGINE_MODULE,
          "@dostark/unslop-ts/deno": ENGINE_DENO_MODULE,
          ...(await enginePins()),
        },
        lint: options.plugin ? { plugins: ["./plugin.ts"] } : {},
      }),
    );
    await Deno.writeTextFile(join(dir, "unslop.project.ts"), REPORT_DESCRIPTOR);
    await Deno.writeTextFile(join(dir, "unslop.config.json"), JSON.stringify(REPORT_CONFIG));
    await Deno.writeTextFile(join(dir, "plugin.ts"), REPORT_PLUGIN);
    await Deno.writeTextFile(
      join(dir, "rule_ceilings.json"),
      JSON.stringify({ [CEILING_RULE]: { ".": options.ceiling } }),
    );
    await Deno.writeTextFile(join(dir, "packages/x/src/branching.ts"), options.source);
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const CLEAN_SOURCE = "export function clean(): number {\n  return 1;\n}\n";

/** Runs the reporter in a ceiling project from the given working directory. */
function reportCeilings(
  cwd: string,
  prefix: string,
  config: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runDeno([
    "run",
    "-A",
    `--config=${config}`,
    SCRIPT_URL,
    `--rule=${CEILING_RULE}`,
    `--roots=${prefix}packages`,
    `--descriptor=${prefix}unslop.project.ts`,
    `--ceilings=${prefix}rule_ceilings.json`,
    "--json",
    "--fail",
  ], cwd);
}

Deno.test("rule-report-plugin-absent: a missing plugin fails, while a loaded clean plugin passes", async () => {
  await withCeilingProject({ plugin: false, source: BRANCHING_SOURCE, ceiling: 0 }, async (dir) => {
    const absent = await reportCeilings(dir, "", "deno.json");
    assertEquals(absent.code !== 0, true, absent.stdout);
    assertStringIncludes(absent.stderr, "reported no observation");
  });
  await withCeilingProject({ plugin: true, source: BRANCHING_SOURCE, ceiling: 0 }, async (dir) => {
    const loaded = await reportCeilings(dir, "", "deno.json");
    assertEquals(loaded.code, 1, loaded.stderr);
    assertEquals(JSON.parse(loaded.stdout).ceilings.over[0].count, 1);
  });
  await withCeilingProject({ plugin: true, source: CLEAN_SOURCE, ceiling: 0 }, async (dir) => {
    const clean = await reportCeilings(dir, "", "deno.json");
    assertEquals(clean.code, 0, clean.stderr);
    assertEquals(JSON.parse(clean.stdout).selected, 0);
  });
});

Deno.test("rule-report-descriptor-root: another cwd still scans with the descriptor lint config and roots", async () => {
  await withCeilingProject({ plugin: true, source: BRANCHING_SOURCE, ceiling: 0 }, async (dir) => {
    const parent = await Deno.makeTempDir({ prefix: "rule_report_cwd_" });
    try {
      const name = dir.slice(dir.lastIndexOf("/") + 1);
      const relative = await reportCeilings(parent, `${"../"}${name}/`, join(dir, "deno.json"));
      assertEquals(relative.code, 1, relative.stderr);
      assertEquals(JSON.parse(relative.stdout).ceilings.over[0].count, 1);
    } finally {
      await Deno.remove(parent, { recursive: true });
    }
  });
});
