/**
 * @module CliReportTest
 * @path tests/cli_report_test.ts
 * @description The report route: binding, operand scope, observed counts, foreign findings, failure states, and output safety.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [src/cli/commands/report.ts, src/report/collect.ts, tests/helpers/cli_project.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  collectRunReport,
  compileConfig,
  type IHostDiagnostic,
  type ILintRunResult,
  type IRunReport,
  traceEnvName,
} from "../mod.ts";
import { runReport } from "../src/cli/commands/report.ts";
import { configPath, runCli, runReportCli, runReportWriteCli, withCliProject } from "./helpers/cli_project.ts";
import { testDescriptor } from "./helpers/descriptor.ts";
import { captureSources, SnapshotError } from "../src/report/snapshot.ts";
import type { ISourceSnapshot } from "../src/report/context.ts";

const UNKNOWN_SOURCE = "export let value: unknown = 1;\n";
const CLEAN_SOURCE = "export const value = 1;\n";

function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  return Promise.all(
    Object.entries(files).map(async ([name, source]) => {
      const path = join(dir, name);
      await Deno.mkdir(join(path, ".."), { recursive: true });
      await Deno.writeTextFile(path, source);
    }),
  ).then(() => {});
}

function reportOf(stdout: string): IRunReport {
  return JSON.parse(stdout) as IRunReport;
}

function diagnosticOf(ruleId: string, filename = "src/a.ts"): IHostDiagnostic {
  return {
    filename,
    range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
    code: ruleId,
    message: "A finding.",
    hint: null,
  };
}

function resultOf(diagnostics: readonly IHostDiagnostic[] = []): ILintRunResult {
  return {
    input: {
      descriptor: testDescriptor(),
      selectedPluginUrl: new URL("file:///demo/plugin.ts"),
      paths: ["src/a.ts"],
      selection: null,
      runId: "run",
    },
    exitCode: diagnostics.length > 0 ? 1 : 0,
    diagnostics,
    errors: [],
    records: [],
    hostStderr: "",
    signal: null,
    completion: "complete",
    failure: null,
  };
}

Deno.test("report_counts_checked_skipped_and_findings_per_rule", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "src/a.ts": UNKNOWN_SOURCE, "src/clean.ts": CLEAN_SOURCE });
    const result = await runReportCli(dir, ["--format=json", "src"]);
    assertEquals(result.code, 1, result.stderr);
    const report = reportOf(result.stdout);
    assertEquals(report.completion, "complete");
    assertEquals(report.hostFilesVisited, null);
    const summary = report.rules.find((entry) => entry.rule.id === "demo/no-explicit-unknown");
    assert(summary);
    assertEquals(summary.status, "active");
    assertEquals(summary.coverage, "complete");
    assertEquals(summary.observedChecked, 2);
    assertEquals(summary.findings, 1);
    assert(report.filesObserved.includes("src/a.ts"));
    assert(report.filesObserved.includes("src/clean.ts"));
    assert(report.findings.some((finding) => finding.ruleId === "demo/no-explicit-unknown"));
    const table = await runReportCli(dir, ["src/a.ts"]);
    assertEquals(table.code, 1, table.stderr);
    assertStringIncludes(table.stdout, "Selected findings:");
    assertStringIncludes(table.stdout, "Foreign findings:");
    assertStringIncludes(table.stdout, "Not run:");
    assertStringIncludes(table.stdout, "HINT");
    assertStringIncludes(table.stdout, "constant-restatement");
  });
});

Deno.test("report_lists_parked_off_and_not_selected_rules_without_trace", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, {
      "src/clean.ts": CLEAN_SOURCE,
      "src/interface.ts": "export interface Foo { x: string; }\n",
    });
    const result = await runReportCli(dir, ["--format=json", "src/clean.ts"]);
    assertEquals(result.code, 0, result.stderr);
    const report = reportOf(result.stdout);
    const parked = report.rules.find((entry) => entry.rule.id === "demo/exported-interface-naming");
    assert(parked);
    assertEquals(parked.status, "parked");
    assertEquals(parked.coverage, "unavailable");
    const off = report.rules.find((entry) => entry.rule.id === "demo/require-module-header");
    assert(off);
    assertEquals(off.status, "off");
    const notRun = report.notRun.find((entry) => entry.id === "constant-restatement");
    assert(notRun?.command);
    assert(notRun.command.some((arg) => arg.endsWith("/src/cli/whole_tree.ts")));
    assert(notRun.command.some((arg) => arg.startsWith("--plugin=/")));
    assert(notRun.command.every((arg) => !arg.includes("--catalog")));

    const selected = await runReportCli(dir, [
      "--format=json",
      "--select=demo/exported-interface-naming",
      "src/interface.ts",
    ]);
    assertEquals(selected.code, 1, selected.stderr);
    const selectedReport = reportOf(selected.stdout);
    const finding = selectedReport.findings.find((entry) => entry.ruleId === "demo/exported-interface-naming");
    assert(finding);
    assertEquals(finding.effectiveLevel, "error");
  });
});

Deno.test("report_exits_1_on_an_error_finding_and_0_when_clean", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, {
      "src/clean.ts": CLEAN_SOURCE,
      "src/error.ts": UNKNOWN_SOURCE,
      "src/foreign.ts": "export const value: any = 1;\n",
    });
    const clean = await runReportCli(dir, ["--format=json", "src/clean.ts"]);
    assertEquals(clean.code, 0, clean.stderr);
    const error = await runReportCli(dir, ["--format=json", "src/error.ts"]);
    assertEquals(error.code, 1, error.stderr);
    const foreign = await runReportCli(dir, ["--format=json", "src/foreign.ts"]);
    assertEquals(foreign.code, 1, foreign.stderr);
    const foreignReport = reportOf(foreign.stdout);
    assert(foreignReport.foreignFindings.length > 0);
    assert(foreignReport.findings.every((finding) => finding.effectiveLevel !== "warn"));
  });
});

Deno.test("report_fails_closed_on_host_or_protocol_error", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "src/bad.ts": "export const = ;\n", "src/clean.ts": CLEAN_SOURCE });
    const parseError = await runReportCli(dir, ["--format=json", "src/bad.ts"]);
    assertEquals(parseError.code, 1, parseError.stderr);
    assertEquals(reportOf(parseError.stdout).completion, "failed");

    const empty = await runReport(dir, reportOptions("src/clean.ts"), {
      spawn: () => Promise.resolve(hostOf("", "host noise")),
    });
    assertEquals(empty.completion, "failed");
    assertStringIncludes(empty.failure ?? "", "host output");

    const malformedTrace = await runReport(dir, reportOptions("src/clean.ts"), {
      spawn: (_args, _cwd, env) =>
        Promise.resolve(
          hostOf('{"diagnostics":[],"errors":[]}', `unslop-trace:v1:${env[traceEnvName("demo")]}:{`),
        ),
    });
    assertEquals(malformedTrace.completion, "failed");
    assertStringIncludes(malformedTrace.failure ?? "", "trace protocol");

    const silent = await runReport(dir, reportOptions("src/clean.ts"), {
      spawn: () => Promise.resolve(hostOf('{"diagnostics":[],"errors":[]}', "host noise", 1)),
    });
    assertEquals(silent.completion, "failed");
    assertStringIncludes(silent.failure ?? "", "without findings");

    const missingPlugin = JSON.parse(await Deno.readTextFile(join(dir, "deno.json"))) as {
      lint: { plugins: string[] };
    };
    missingPlugin.lint.plugins = ["./examples/missing_plugin.ts"];
    await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify(missingPlugin, null, 2));
    const missing = await runReportCli(dir, ["--format=json", "src/clean.ts"]);
    assertEquals(missing.code, 2, missing.stderr);
  });
});

function reportOptions(path: string) {
  return { descriptor: null, plugin: null, select: null, profile: null, paths: [path] };
}

function hostJson(diagnostics: readonly IHostDiagnostic[]): string {
  return JSON.stringify({ diagnostics, errors: [] });
}

function fileUrl(dir: string, path: string): string {
  return new URL(`file://${join(dir, path)}`).href;
}

function hostOf(stdout: string, stderr: string, code = 0) {
  const encoder = new TextEncoder();
  return { code, signal: null, stdout: encoder.encode(stdout), stderr: encoder.encode(stderr) };
}

Deno.test("report_binds_explicit_plugin_config_and_root", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "src/clean.ts": CLEAN_SOURCE });
    const subdir = await runReportCli(join(dir, "src"), ["--format=json", "."]);
    assertEquals(subdir.code, 0, subdir.stderr);

    const config = JSON.parse(await Deno.readTextFile(join(dir, "deno.json"))) as {
      lint: { plugins: string[]; rules?: Record<string, unknown> };
    };
    const copy = `${dir}/examples/other_plugin.ts`;
    await Deno.writeTextFile(
      copy,
      [
        'import { createLintPlugin, createRuleRegistry, parseCatalog, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";',
        "const packs = [TYPESCRIPT_RULE_PACK];",
        'const registry = createRuleRegistry("other", packs);',
        'const catalog = parseCatalog({ version: "1", scopes: { test: [], fixture: [] }, tagVocabulary: {}, rules: {} }, { scriptRuleSchemas: null, registry });',
        'export default createLintPlugin("other", catalog, { rulePacks: packs });',
        "",
      ].join("\n"),
    );
    config.lint.plugins = ["./examples/lint_plugin.ts", "./examples/other_plugin.ts"];
    config.lint.rules = { exclude: ["no-explicit-any"] };
    await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify(config, null, 2));
    await writeFiles(dir, { "src/foreign.ts": "export const value: any = 1;\n" });
    const multiple = await runReportCli(dir, ["--format=json", "--plugin=examples/lint_plugin.ts", "src/foreign.ts"]);
    assertEquals(multiple.code, 0, multiple.stderr);
    assertEquals(reportOf(multiple.stdout).foreignFindings.length, 0);

    const mismatch = JSON.parse(await Deno.readTextFile(join(dir, "deno.json"))) as {
      lint: { plugins: string[] };
    };
    mismatch.lint.plugins = ["./examples/other_plugin.ts"];
    await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify(mismatch, null, 2));
    const refused = await runReportCli(dir, ["--format=json", "src/clean.ts"]);
    assertEquals(refused.code, 2, refused.stderr);
  });
});

Deno.test("report_operand_and_output_boundaries", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "-weird.ts": UNKNOWN_SOURCE, "src/clean.ts": CLEAN_SOURCE });
    const weird = await runReportCli(dir, ["--format=json", "--", "-weird.ts"]);
    assertEquals(weird.code, 1, weird.stderr);
    assert(reportOf(weird.stdout).findings.some((finding) => finding.file === "-weird.ts"));

    const unknown = await runReportCli(dir, ["--nope"]);
    assertEquals(unknown.code, 2);
    const data = await runReportCli(dir, ["--", "data:text/typescript,export const x = 1;"]);
    assertEquals(data.code, 2);

    const outside = await Deno.makeTempFile({ prefix: "outside_" });
    try {
      await Deno.writeTextFile(outside, UNKNOWN_SOURCE);
      await Deno.symlink(outside, join(dir, "escape.ts"));
      const escape = await runReportCli(dir, ["--", "escape.ts"]);
      assertEquals(escape.code, 2, escape.stderr);
    } finally {
      await Deno.remove(outside);
    }

    const existing = join(dir, "report.json");
    await Deno.writeTextFile(existing, "{}");
    const out = await runReportWriteCli(dir, ["--format=json", "--out=report.json", "src/clean.ts"]);
    assertEquals(out.code, 2, out.stderr);
    assertEquals(await Deno.readTextFile(existing), "{}");
  });
});

Deno.test("report_preserves_operand_scope", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, {
      "src/target.ts": UNKNOWN_SOURCE,
      "src/unrelated.ts": UNKNOWN_SOURCE,
    });
    const result = await runReportCli(dir, ["--format=json", "src/target.ts"]);
    assertEquals(result.code, 1, result.stderr);
    const report = reportOf(result.stdout);
    assert(report.findings.every((finding) => finding.file === "src/target.ts"));
    assertEquals(report.filesObserved.includes("src/unrelated.ts"), false);
  });
});

Deno.test("collector_uses_explicit_policy_without_disk_access", () => {
  const descriptor = testDescriptor();
  const active = compileConfig({
    version: 2,
    plugin: "demo",
    rules: {
      "demo/no-explicit-unknown": "error",
      "demo/require-module-header": { level: "off", reason: "Own headers." },
    },
  }, descriptor);
  const inactive = compileConfig({
    version: 2,
    plugin: "demo",
    rules: { "demo/no-explicit-unknown": { level: "off", optIn: true, reason: "Opt-in." } },
  }, descriptor);
  const result = resultOf([diagnosticOf("demo/no-explicit-unknown")]);
  const left = collectRunReport(result, { compiled: active, selection: null, policy: [], sources: null });
  const right = collectRunReport(result, { compiled: inactive, selection: null, policy: [], sources: null });
  assertEquals(left.findings.length, 1);
  assertEquals(left.rules.find((entry) => entry.rule.id === "demo/no-explicit-unknown")?.status, "active");
  assertEquals(right.rules.find((entry) => entry.rule.id === "demo/no-explicit-unknown")?.status, "parked");
});

Deno.test("report_policy_changes_mark_run_incomplete", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "src/clean.ts": CLEAN_SOURCE });
    const drift = await runReport(dir, reportOptions("src/clean.ts"), {
      afterSpawn: async () => {
        const config = await Deno.readTextFile(configPath(dir));
        await Deno.writeTextFile(configPath(dir), `${config}\n`);
      },
      spawn: () => Promise.resolve(hostOf('{"diagnostics":[],"errors":[]}', "")),
    });
    assertEquals(drift.completion, "failed");
    assertStringIncludes(drift.failure ?? "", "policy changed");
    const deleted = await runReport(dir, reportOptions("src/clean.ts"), {
      afterSpawn: async () => {
        await Deno.remove(configPath(dir));
      },
      spawn: () => Promise.resolve(hostOf('{"diagnostics":[],"errors":[]}', "")),
    });
    assertEquals(deleted.completion, "failed");
    assertStringIncludes(deleted.failure ?? "", "policy changed");
  });
});

Deno.test("report_classifies_every_host_termination", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "src/clean.ts": CLEAN_SOURCE });
    const complete = await runReport(dir, reportOptions("src/clean.ts"), {
      spawn: () => Promise.resolve(hostOf('{"diagnostics":[],"errors":[]}', "", 0)),
    });
    assertEquals(complete.completion, "complete");
    const findings = await runReport(dir, reportOptions("src/clean.ts"), {
      spawn: () =>
        Promise.resolve(
          hostOf(
            JSON.stringify({ diagnostics: [diagnosticOf("demo/no-explicit-unknown", "src/clean.ts")], errors: [] }),
            "",
            1,
          ),
        ),
    });
    assertEquals(findings.completion, "complete");
    assertEquals(findings.findings.length, 1);
    const silent = await runReport(dir, reportOptions("src/clean.ts"), {
      spawn: () => Promise.resolve(hostOf('{"diagnostics":[],"errors":[]}', "", 1)),
    });
    assertEquals(silent.completion, "failed");
    const spawnFailure = await runReport(dir, reportOptions("src/clean.ts"), {
      spawn: () => {
        throw new Error("cannot spawn");
      },
    });
    assertEquals(spawnFailure.completion, "failed");
    assertStringIncludes(spawnFailure.failure ?? "", "cannot run");
    const signal = await runReport(dir, reportOptions("src/clean.ts"), {
      spawn: () =>
        Promise.resolve({ code: null, signal: "SIGTERM", stdout: new Uint8Array(), stderr: new Uint8Array() }),
    });
    assertEquals(signal.completion, "failed");
    assertStringIncludes(signal.failure ?? "", "signal");
  });
});

Deno.test("report_snapshot_changes_mark_run_incomplete", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "src/a.ts": UNKNOWN_SOURCE, "src/clean.ts": CLEAN_SOURCE });
    const diagnostic = diagnosticOf("demo/no-explicit-unknown", fileUrl(dir, "src/a.ts"));
    const changed = await runReport(dir, reportOptions("src/a.ts"), {
      afterSpawn: async () => {
        await Deno.writeTextFile(join(dir, "src/a.ts"), `${UNKNOWN_SOURCE}// changed\n`);
      },
      spawn: () => Promise.resolve(hostOf(hostJson([diagnostic]), "", 1)),
    });
    assertEquals(changed.completion, "failed");
    assertStringIncludes(changed.failure ?? "", "source changed");

    const missing = await runReport(dir, reportOptions("src/a.ts"), {
      afterSpawn: async () => {
        await Deno.remove(join(dir, "src/a.ts"));
      },
      spawn: () => Promise.resolve(hostOf(hostJson([diagnostic]), "", 1)),
    });
    assertEquals(missing.completion, "failed");
    assertStringIncludes(missing.failure ?? "", "source changed");

    const fresh = diagnosticOf("demo/no-explicit-unknown", fileUrl(dir, "src/new.ts"));
    const added = await runReport(dir, reportOptions("src/clean.ts"), {
      afterSpawn: async () => {
        await Deno.writeTextFile(join(dir, "src/new.ts"), UNKNOWN_SOURCE);
      },
      spawn: () => Promise.resolve(hostOf(hostJson([fresh]), "", 1)),
    });
    assertEquals(added.completion, "failed");
    assertStringIncludes(added.failure ?? "", "source changed");
  });
});

Deno.test("snapshot_scope_matches_the_host_operands", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "src/target.ts": UNKNOWN_SOURCE, "src/unrelated.ts": UNKNOWN_SOURCE });
    const sources = await captureSources([join(dir, "src/target.ts")], dir);
    assertEquals([...sources.keys()].sort(), ["src/target.ts"]);
    const result = await runReportCli(dir, ["--format=json", "src/target.ts"]);
    assertEquals(result.code, 1, result.stderr);
    const report = reportOf(result.stdout);
    assert(report.findings.every((finding) => finding.file === "src/target.ts"));
    assertEquals(report.filesObserved.includes("src/unrelated.ts"), false);
  });
});

Deno.test("snapshot_walk_handles_internal_symlinks_and_rejects_escapes", async () => {
  await withCliProject(async (dir) => {
    await Deno.mkdir(join(dir, "tree"), { recursive: true });
    await Deno.writeTextFile(join(dir, "tree/a.ts"), UNKNOWN_SOURCE);
    await Deno.symlink("a.ts", join(dir, "tree/alias.ts"));
    await Deno.symlink(".", join(dir, "tree/loop"));
    const sources = await captureSources([join(dir, "tree")], dir);
    const direct = sources.get("tree/a.ts");
    const alias = sources.get("tree/alias.ts");
    assert(direct);
    assert(alias);
    assertEquals(direct, alias);
    await Deno.symlink("tree", join(dir, "alias-dir"));
    const aliased = await captureSources([join(dir, "tree"), join(dir, "alias-dir")], dir);
    assertEquals(aliased.get("alias-dir/a.ts"), aliased.get("tree/a.ts"));

    const outside = await Deno.makeTempFile({ prefix: "snapshot_outside_" });
    try {
      await Deno.writeTextFile(outside, UNKNOWN_SOURCE);
      await Deno.symlink(outside, join(dir, "tree/escape.ts"));
      await assertRejects(
        () => captureSources([join(dir, "tree")], dir),
        SnapshotError,
        "escapes",
      );
    } finally {
      await Deno.remove(outside);
    }
  });
});

Deno.test("snapshot_fingerprints_use_captured_lines_without_serializing_source", async () => {
  const descriptor = testDescriptor();
  const compiled = compileConfig({
    version: 2,
    plugin: "demo",
    rules: { "demo/no-explicit-unknown": "error" },
  }, descriptor);
  const bytes = new TextEncoder().encode("// café\r\nexport let value: unknown = 1;\r\n");
  const source: ISourceSnapshot = { canonicalPath: "/demo/src/a.ts", bytes };
  const sources = new Map([["src/a.ts", source]]);
  const first = diagnosticOf("demo/no-explicit-unknown");
  const second = { ...first, range: { ...first.range, start: { line: 2, col: 18 }, end: { line: 2, col: 25 } } };
  const report = collectRunReport(resultOf([first, second, first]), { compiled, selection: null, policy: [], sources });
  assert(report.findings[0].fingerprint);
  const tuple = JSON.stringify(["demo/no-explicit-unknown", encodeURI("src/a.ts"), "// café", 1, 2, "A finding."]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tuple));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assertEquals(report.findings[0].fingerprint, expected);
  assertEquals(report.findings[0].fingerprint, report.findings[2].fingerprint);
  assert(report.findings[0].fingerprint !== report.findings[1].fingerprint);
  assert(!JSON.stringify(report).includes("café"));
});

Deno.test("report_and_list_format_dispatch", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, { "src/clean.ts": CLEAN_SOURCE, "src/error.ts": UNKNOWN_SOURCE });
    const markdown = await runReportCli(dir, ["--format=markdown", "src/clean.ts"]);
    assertEquals(markdown.code, 0, markdown.stderr);
    assertStringIncludes(markdown.stdout, "# unslop-ts report");

    const sarif = await runReportCli(dir, ["--format=sarif", "src/error.ts"]);
    assertEquals(sarif.code, 1, sarif.stderr);
    const sarifJson = JSON.parse(sarif.stdout) as { version: string; $schema: string; runs: unknown[] };
    assertEquals(sarifJson.version, "2.1.0");
    assertStringIncludes(sarifJson.$schema, "sarif-schema-2.1.0.json");
    assertEquals(sarifJson.runs.length, 1);

    const listSarif = await runCli(dir, ["rules", "list", "--format=sarif"]);
    assertEquals(listSarif.code, 0, listSarif.stderr);
    const list = JSON.parse(listSarif.stdout) as { runs: Record<string, unknown>[] };
    assertEquals("results" in list.runs[0], false);
    assertEquals("invocations" in list.runs[0], false);

    const listMarkdown = await runCli(dir, ["rules", "list", "--format=markdown"]);
    assertEquals(listMarkdown.code, 0, listMarkdown.stderr);
    assertStringIncludes(listMarkdown.stdout, "| ID |");

    const showSarif = await runCli(dir, ["rules", "show", "demo/max-params", "--format=sarif"]);
    assertEquals(showSarif.code, 2);
    const presetMarkdown = await runCli(dir, ["presets", "show", "unslop:strict", "--format=markdown"]);
    assertEquals(presetMarkdown.code, 2);
  });
});

Deno.test("every_format_preserves_foreign_findings", async () => {
  await withCliProject(async (dir) => {
    await writeFiles(dir, {
      "src/mixed.ts": "export let value: unknown = 1;\nexport const anyValue: any = 1;\n",
      "src/foreign.ts": "export const anyValue: any = 1;\n",
    });
    for (const format of ["table", "json", "markdown", "sarif"]) {
      const mixed = await runReportCli(dir, [`--format=${format}`, "src/mixed.ts"]);
      assertEquals(mixed.code, 1, mixed.stderr);
      if (format === "json") {
        const report = reportOf(mixed.stdout);
        assert(report.findings.some((finding) => finding.ruleId === "demo/no-explicit-unknown"));
        assert(report.foreignFindings.some((finding) => finding.ruleId === "no-explicit-any"));
      } else if (format === "sarif") {
        const run = (JSON.parse(mixed.stdout) as { runs: Record<string, unknown>[] }).runs[0];
        const results = run.results as Record<string, unknown>[];
        assert(results.some((result) => result.ruleId === "demo/no-explicit-unknown"));
        assert(results.some((result) => result.ruleId === "deno:no-explicit-any"));
      } else {
        assertStringIncludes(mixed.stdout, "demo/no-explicit-unknown");
        assertStringIncludes(mixed.stdout, "no-explicit-any");
      }
    }
    for (const format of ["table", "json", "markdown", "sarif"]) {
      const foreign = await runReportCli(dir, [`--format=${format}`, "src/foreign.ts"]);
      assertEquals(foreign.code, 1, foreign.stderr);
      if (format === "json") {
        const report = reportOf(foreign.stdout);
        assertEquals(report.findings.length, 0);
        assert(report.foreignFindings.some((finding) => finding.ruleId === "no-explicit-any"));
      } else {
        assertStringIncludes(foreign.stdout, "no-explicit-any");
      }
    }
  });
});
