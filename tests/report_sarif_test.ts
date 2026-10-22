/**
 * @module ReportSarifTest
 * @path tests/report_sarif_test.ts
 * @description Validates the SARIF 2.1.0 report and rule-list adapters against the vendored official schema.
 * @architectural-layer Test
 * @dependencies [@std/assert, ajv-draft-04, ajv-formats]
 * @related-files [src/report/sarif.ts, tests/fixtures/sarif-2.1.0-schema.json]
 */

import { assert, assertEquals } from "@std/assert";
import * as Ajv04Module from "ajv-draft-04";
import * as addFormatsModule from "ajv-formats";
import schema from "./fixtures/sarif-2.1.0-schema.json" with { type: "json" };
import { collectRunReport, compileConfig, type IHostDiagnostic, type ILintRunResult, type IRunReport } from "../mod.ts";
import { sarifReport, sarifRules } from "../src/report/sarif.ts";
import { testDescriptor } from "./helpers/descriptor.ts";
import type { ISourceSnapshot } from "../src/report/context.ts";

const SOURCE = "export let value: unknown = 1;\n";
type Ajv04Instance = {
  compile: (schema: object) => ((data: unknown) => boolean) & { errors?: unknown };
};

function isAjvConstructor(value: unknown): value is new (options: object) => Ajv04Instance {
  return typeof value === "function";
}

function isFormats(value: unknown): value is (ajv: Ajv04Instance) => void {
  return typeof value === "function";
}

const VALIDATOR = (() => {
  const constructor: unknown = Ajv04Module.default;
  if (!isAjvConstructor(constructor)) throw new Error("ajv-draft-04 does not export a constructor.");
  const ajv = new constructor({ allErrors: true, strict: false });
  const formats: unknown = addFormatsModule.default;
  if (!isFormats(formats)) throw new Error("ajv-formats does not export a callable.");
  formats(ajv);
  return ajv.compile(schema);
})();

function diagnostic(code: string, startColumn = 18, endColumn = 25, message = "A finding."): IHostDiagnostic {
  return {
    filename: "src/a.ts",
    range: { start: { line: 1, col: startColumn }, end: { line: 1, col: endColumn } },
    code,
    message,
    hint: null,
  };
}

function reportOf(diagnostics: readonly IHostDiagnostic[]): IRunReport {
  const descriptor = testDescriptor();
  const compiled = compileConfig({
    version: 2,
    plugin: "demo",
    rules: {
      "demo/no-explicit-unknown": {
        level: "error",
        docs: "https://guide.test/#strict",
      },
      "demo/max-params": "error",
    },
  }, descriptor);
  const source: ISourceSnapshot = {
    canonicalPath: "/demo/src/a.ts",
    bytes: new TextEncoder().encode(SOURCE),
  };
  const result: ILintRunResult = {
    input: {
      descriptor,
      selectedPluginUrl: new URL("file:///demo/plugin.ts"),
      paths: ["src/a.ts"],
      selection: null,
      runId: "run",
    },
    exitCode: 1,
    diagnostics,
    errors: [],
    records: [],
    hostStderr: "",
    signal: null,
    completion: "complete",
    failure: null,
  };
  return collectRunReport(result, {
    compiled,
    selection: null,
    policy: [],
    sources: new Map([["src/a.ts", source]]),
  });
}

function firstResult(sarif: Record<string, unknown>): Record<string, unknown> {
  const runs = sarif.runs as Record<string, unknown>[];
  return (runs[0].results as Record<string, unknown>[])[0];
}

Deno.test("sarif_validates_against_the_2_1_0_schema", () => {
  const sarif = sarifReport(reportOf([diagnostic("demo/no-explicit-unknown")]));
  assert(VALIDATOR(sarif), JSON.stringify(VALIDATOR.errors));
  const bad = structuredClone(sarif) as Record<string, unknown>;
  (bad.runs as Record<string, unknown>[])[0].version = "9";
  const badResult = structuredClone(sarif) as Record<string, unknown>;
  firstResult(badResult).level = "fatal";
  assertEquals(VALIDATOR(badResult), false);
});

Deno.test("sarif_columns_are_one_based_and_end_exclusive", () => {
  const report = reportOf([diagnostic("demo/no-explicit-unknown", 1, 7)]);
  const result = firstResult(sarifReport(report));
  const region = ((result.locations as Record<string, unknown>[])[0].physicalLocation as Record<string, unknown>)
    .region as Record<string, unknown>;
  assertEquals(region.startColumn, 2);
  assertEquals(region.endColumn, 8);
  const run = (sarifReport(report).runs as Record<string, unknown>[])[0];
  assertEquals(run.columnKind, "unicodeCodePoints");
  const location = (result.locations as Record<string, unknown>[])[0].physicalLocation as Record<string, unknown>;
  assertEquals((location.artifactLocation as Record<string, unknown>).uri, "src/a.ts");
  assertEquals((location.artifactLocation as Record<string, unknown>).uriBaseId, "%SRCROOT%");
});

Deno.test("sarif_rules_carry_description_help_and_category", () => {
  const sarif = sarifReport(reportOf([diagnostic("demo/no-explicit-unknown")]));
  const rules = ((sarif.runs as Record<string, unknown>[])[0].tool as Record<string, unknown>).driver as Record<
    string,
    unknown
  >;
  const descriptors = rules.rules as Record<string, unknown>[];
  const absolute = descriptors.find((descriptor) => descriptor.id === "demo/no-explicit-unknown");
  assert(absolute);
  assertEquals(absolute.helpUri, "https://guide.test/#strict");
  assert(Array.isArray((absolute.properties as Record<string, unknown>).tags));
  const relative = descriptors.find((descriptor) => descriptor.id === "demo/max-params");
  assert(relative);
  assertEquals("helpUri" in relative, false);
  assertEquals(typeof absolute.shortDescription, "object");
  assertEquals(typeof absolute.fullDescription, "object");
  assertEquals(typeof absolute.help, "object");

  const foreignSarif = sarifReport(reportOf([diagnostic("no-explicit-any")]));
  const foreignRules =
    (((foreignSarif.runs as Record<string, unknown>[])[0].tool as Record<string, unknown>).driver as Record<
      string,
      unknown
    >).rules as Record<string, unknown>[];
  assert(foreignRules.some((descriptor) => descriptor.id === "deno:no-explicit-any"));
});

Deno.test("sarif_fingerprints_are_stable_across_runs", () => {
  const first = reportOf([diagnostic("demo/no-explicit-unknown")]);
  const second = reportOf([diagnostic("demo/no-explicit-unknown")]);
  assertEquals(first.findings[0].fingerprint, second.findings[0].fingerprint);
  const distinct = reportOf([
    diagnostic("demo/no-explicit-unknown", 1, 7, "First message."),
    diagnostic("demo/no-explicit-unknown", 8, 14, "Second message."),
  ]);
  assert(distinct.findings[0].fingerprint !== distinct.findings[1].fingerprint);
  const results = (sarifReport(distinct).runs as Record<string, unknown>[])[0].results as Record<string, unknown>[];
  assertEquals(
    (results[0].partialFingerprints as Record<string, string>)["unslop/v1"],
    distinct.findings[0].fingerprint,
  );
  assertEquals(
    (results[1].partialFingerprints as Record<string, string>)["unslop/v1"],
    distinct.findings[1].fingerprint,
  );

  const descriptor = testDescriptor();
  const compiled = compileConfig({
    version: 2,
    plugin: "demo",
    rules: { "demo/no-explicit-unknown": "error" },
  }, descriptor);
  const list = sarifRules(compiled);
  assert(VALIDATOR(list), JSON.stringify(VALIDATOR.errors));
  const run = (list.runs as Record<string, unknown>[])[0];
  assertEquals("results" in run, false);
  assertEquals("invocations" in run, false);
});
