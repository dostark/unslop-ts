/**
 * @module PluginTraceTest
 * @path tests/plugin_trace_test.ts
 * @description The stderr trace protocol: skip records, reconciliation, real-host suppression behavior, and collision safety.
 * @architectural-layer Test
 * @dependencies [@std/assert, zod]
 * @related-files [src/engine/trace.ts, src/engine/plugin.ts, tests/helpers/demo_project.ts]
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { z } from "zod";
import {
  createLintPlugin,
  createRuleRegistry,
  formatTraceRecord,
  type IRulePack,
  type ITraceRecord,
  type JsonValue,
  MANUAL_TRACE_RUN_ID,
  parseCatalog,
  parseTraceStderr,
  reconcileTraceRecords,
  type SkipReason,
  TRACE_PREFIX,
  traceEnvName,
  TraceProtocolError,
  TYPESCRIPT_RULE_PACK,
} from "../mod.ts";
import { runDeno, withDemoProject } from "./helpers/demo_project.ts";
import { loadTestCatalog, TEST_PLUGIN_NAME, TEST_RULE_PACKS } from "./helpers/registry.ts";

const TRACE_ENV = traceEnvName("demo");
const RUN_ID = MANUAL_TRACE_RUN_ID;
const FILES = [
  "packages/x/src/checked.ts",
  "packages/x/src/ignored.ts",
  "tests/fixtures/fixture.ts",
  "packages/x/tests/scope_test.ts",
  "packages/x/src/other.ts",
  "packages/x/src/excluded.ts",
];

function catalogWith(rules: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: { test: ["**/*_test.ts"], fixture: ["**/tests/fixtures/**"] },
    tagVocabulary: Object.keys(rules).length > 0
      ? { "type-safety": { description: "Rules that keep type evidence." } }
      : {},
    rules,
    ...extra,
  } as Record<string, JsonValue>;
}

function skipCatalog(): Record<string, JsonValue> {
  return catalogWith({
    "demo/no-runtime-typeof": {
      engine: "plugin",
      severity: "error",
      scope: "all",
      tags: ["type-safety"],
    },
    "demo/ignore-needs-reason": {
      engine: "plugin",
      severity: "error",
      scope: "prod",
      tags: ["type-safety"],
    },
    "demo/no-explicit-unknown": {
      engine: "plugin",
      severity: "error",
      scope: "all",
      tags: ["type-safety"],
      include: ["packages/x/src/included/**"],
    },
    "demo/no-chained-type-assertions": {
      engine: "plugin",
      severity: "error",
      scope: "all",
      tags: ["type-safety"],
      exclude: ["**/excluded.ts"],
    },
  }, {
    ignore: [{ glob: "**/ignored.ts", reason: "The checker holds the violation." }],
  });
}

function recordsOf(stderr: string): readonly ITraceRecord[] {
  return parseTraceStderr(stderr, RUN_ID).records;
}

function recordFor(
  records: readonly ITraceRecord[],
  file: string,
  rule: string,
  kind: ITraceRecord["kind"],
): ITraceRecord | undefined {
  return records.find((record) => record.file === file && record.rule === rule && record.kind === kind);
}

Deno.test("trace_records_each_skip_reason", async () => {
  await withDemoProject({
    files: Object.fromEntries(FILES.map((file) => [file, "export const value = 1;\n"])),
    catalog: skipCatalog(),
  }, async (dir) => {
    const result = await runDeno(["lint", "--json", "--config", "deno.json", ...FILES], dir, { [TRACE_ENV]: "1" });
    assertEquals(result.code, 0, result.stderr);
    const records = recordsOf(result.stderr);

    assert(
      records.some((record) => record.kind === "observed" && record.file === FILES[0]),
      "the observer saw the checked file",
    );
    assertEquals(recordFor(records, FILES[0], "demo/no-runtime-typeof", "checked")?.kind, "checked");

    const ignored = recordFor(records, FILES[1], "demo/no-runtime-typeof", "skipped");
    assertEquals(ignored?.kind === "skipped" ? ignored.reason : null, "ignored");
    const fixture = recordFor(records, FILES[2], "demo/no-runtime-typeof", "skipped");
    assertEquals(fixture?.kind === "skipped" ? fixture.reason : null, "fixture");
    const scope = recordFor(records, FILES[3], "demo/ignore-needs-reason", "skipped");
    assertEquals(scope?.kind === "skipped" ? scope.reason : null, "scope");
    const include = recordFor(records, FILES[4], "demo/no-explicit-unknown", "skipped");
    assertEquals(include?.kind === "skipped" ? include.reason : null, "include");
    const exclude = recordFor(records, FILES[5], "demo/no-chained-type-assertions", "skipped");
    assertEquals(exclude?.kind === "skipped" ? exclude.reason : null, "exclude");
  });
});

Deno.test("no_trace_without_the_variable", async () => {
  await withDemoProject({ files: { "a.ts": "export const x = typeof y === 'string';\n" } }, async (dir) => {
    const baseline = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts"], dir);
    const traced = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts"], dir, { [TRACE_ENV]: "1" });
    assertEquals(JSON.parse(traced.stdout), JSON.parse(baseline.stdout));
    assertEquals(traced.code, baseline.code);
    assertEquals(baseline.stderr.includes(TRACE_PREFIX), false);
    assertStringIncludes(traced.stderr, TRACE_PREFIX);
  });
});

Deno.test("trace_survives_qualified_and_line_ignores", async () => {
  const catalog = catalogWith({
    "demo/no-runtime-typeof": { engine: "plugin", severity: "error", scope: "all", tags: ["type-safety"] },
    "demo/no-explicit-unknown": { engine: "plugin", severity: "error", scope: "all", tags: ["type-safety"] },
  });
  const qualified = [
    "// deno-lint-ignore-file demo/no-explicit-unknown",
    "export function f(x: string | number): boolean {",
    '  return typeof x === "string";',
    "}",
    "// deno-lint-ignore demo/no-runtime-typeof",
    'export const y = typeof z === "string";',
    'export const later = typeof w === "string";',
    "export let loose: unknown = 1;",
    "",
  ].join("\n");
  const unqualified = "// deno-lint-ignore-file\nexport const x = typeof y === 'string';\n";
  await withDemoProject({ files: { "a.ts": qualified, "b.ts": unqualified }, catalog }, async (dir) => {
    const result = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts", "b.ts"], dir, {
      [TRACE_ENV]: "1",
    });
    assertEquals(result.code, 1, result.stderr);
    const records = recordsOf(result.stderr);
    assertEquals(recordFor(records, "a.ts", "demo/no-explicit-unknown", "checked")?.kind, "checked");
    assertEquals(recordFor(records, "a.ts", "demo/no-runtime-typeof", "checked")?.kind, "checked");
    assertEquals(records.some((record) => record.file === "b.ts"), false);
    const diagnostics = (JSON.parse(result.stdout) as { diagnostics: { code?: string }[] }).diagnostics;
    assert(diagnostics.some((diagnostic) => diagnostic.code === "demo/no-runtime-typeof"));
    assert(!diagnostics.some((diagnostic) => diagnostic.code === "demo/no-explicit-unknown"));
  });
});

Deno.test("trace_all_off_host_excluded_and_cached_runs", async () => {
  const offCatalog = catalogWith({
    "demo/no-runtime-typeof": {
      engine: "plugin",
      severity: "off",
      optIn: true,
      reason: "Manual today.",
      scope: "all",
      tags: ["type-safety"],
    },
  });
  await withDemoProject(
    { files: { "a.ts": "export const x = typeof y === 'string';\n" }, catalog: offCatalog },
    async (dir) => {
      const first = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts"], dir, { [TRACE_ENV]: "1" });
      const second = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts"], dir, { [TRACE_ENV]: "1" });
      assertEquals(recordsOf(first.stderr), recordsOf(second.stderr));
      assert(recordsOf(first.stderr).every((record) => record.kind === "observed"));
    },
  );

  const activeCatalog = catalogWith({
    "demo/no-runtime-typeof": { engine: "plugin", severity: "error", scope: "all", tags: ["type-safety"] },
  });
  await withDemoProject({
    files: { "a.ts": "export const x = typeof y === 'string';\n" },
    catalog: activeCatalog,
    lintRules: { exclude: ["demo/internal-coverage"] },
  }, async (dir) => {
    const result = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts"], dir, { [TRACE_ENV]: "1" });
    assertEquals(recordsOf(result.stderr).some((record) => record.kind === "observed"), false);
    assertEquals(recordFor(recordsOf(result.stderr), "a.ts", "demo/no-runtime-typeof", "checked")?.kind, "checked");
  });

  const programRule = {
    meta: TYPESCRIPT_RULE_PACK.rules["no-runtime-typeof"].meta,
    create(context: Deno.lint.RuleContext) {
      return {
        Program(): void {
          context.report({ range: [0, 0], message: "program ran" });
        },
      };
    },
  };
  const programPack: IRulePack = {
    name: "program",
    rules: { "program-rule": programRule },
    optionSchemas: { "program-rule": z.object({}) },
  };
  const programCatalog = catalogWith({
    "demo/program-rule": { engine: "plugin", severity: "error", scope: "all", tags: ["type-safety"] },
  });
  const programRegistry = createRuleRegistry("demo", [...TEST_RULE_PACKS, programPack]);
  const parsedProgram = parseCatalog(programCatalog, { scriptRuleSchemas: null, registry: programRegistry });
  const plugin = createLintPlugin("demo", parsedProgram, {
    rulePacks: [...TEST_RULE_PACKS, programPack],
    selection: "",
    trace: "1",
  });
  const diagnostics = Deno.lint.runPlugin(plugin, "a.ts", "export const x = 1;\n");
  assertEquals(diagnostics.some((diagnostic) => diagnostic.message === "program ran"), true);
});

Deno.test("trace_does_not_change_non_trace_diagnostics", async () => {
  const files = {
    "a.ts": [
      "// deno-lint-ignore demo/no-runtime-typeof",
      "export const unused = 1;",
      "// deno-lint-ignore no-explicit-any",
      'export const x = typeof y === "string";',
      "",
    ].join("\n"),
  };
  await withDemoProject({ files }, async (dir) => {
    const baseline = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts"], dir);
    const traced = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts"], dir, { [TRACE_ENV]: "1" });
    assertEquals(JSON.parse(traced.stdout), JSON.parse(baseline.stdout));
    assertEquals(traced.code, baseline.code);
    assertEquals(baseline.stderr.includes(TRACE_PREFIX), false);
  });
});

Deno.test("restricted_env_and_explicit_trace_override", async () => {
  const root = new URL("..", import.meta.url);
  const dir = await Deno.makeTempDir({ prefix: "trace_restricted_" });
  try {
    const script = joinPath(dir, "restricted.ts");
    await Deno.writeTextFile(
      script,
      [
        `import { createLintPlugin, createRuleRegistry, parseCatalog, TYPESCRIPT_RULE_PACK } from ${
          JSON.stringify(new URL("../mod.ts", import.meta.url).href)
        };`,
        'const registry = createRuleRegistry("demo", [TYPESCRIPT_RULE_PACK]);',
        'const catalog = parseCatalog({ version: "1", scopes: { test: [], fixture: [] }, tagVocabulary: {}, rules: {} }, { scriptRuleSchemas: null, registry });',
        'createLintPlugin("demo", catalog, { rulePacks: [TYPESCRIPT_RULE_PACK], selection: "", trace: "manual" });',
        'console.log("ok");',
        "",
      ].join("\n"),
    );
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", "--no-lock", "--config", new URL("deno.json", root).pathname, script],
      cwd: dir,
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    assertEquals(result.code, 0, decoder.decode(result.stderr));
    assertEquals(decoder.decode(result.stdout).trim(), "ok");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }

  const before = Deno.env.get(TRACE_ENV);
  Deno.env.set(TRACE_ENV, "preserved");
  try {
    createLintPlugin("demo", loadTestCatalog(catalogWith({})), {
      rulePacks: TEST_RULE_PACKS,
      selection: "",
      trace: "explicit",
    });
    assertEquals(Deno.env.get(TRACE_ENV), "preserved");
  } finally {
    if (before === undefined) Deno.env.delete(TRACE_ENV);
    else Deno.env.set(TRACE_ENV, before);
  }
});

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/$/, "")}/${name}`;
}

Deno.test("trace_protocol_reconciliation_rejects_contradictions", () => {
  const base = { runId: RUN_ID, plugin: "demo", file: "a.ts" };
  const observed: ITraceRecord = { kind: "observed", ...base, rule: "internal-coverage" };
  const checked: ITraceRecord = { kind: "checked", ...base, rule: "demo/no-runtime-typeof" };
  const skipped: ITraceRecord = { kind: "skipped", ...base, rule: "demo/no-runtime-typeof", reason: "scope" };
  const expected = { runId: RUN_ID, plugin: "demo", activeRules: new Set(["demo/no-runtime-typeof"]) };

  assertEquals(reconcileTraceRecords([observed, checked, checked], expected).length, 2);
  assertThrows(() => reconcileTraceRecords([checked, skipped], expected), TraceProtocolError);
  assertThrows(
    () => reconcileTraceRecords([skipped, { ...skipped, reason: "include" as SkipReason }], expected),
    TraceProtocolError,
  );
  assertThrows(
    () => reconcileTraceRecords([{ ...checked, runId: "other" }], expected),
    TraceProtocolError,
  );
  assertThrows(
    () => reconcileTraceRecords([{ ...checked, plugin: "other" }], expected),
    TraceProtocolError,
  );
  assertThrows(
    () => reconcileTraceRecords([{ ...checked, rule: "demo/unknown" }], expected),
    TraceProtocolError,
  );
  assertThrows(
    () => reconcileTraceRecords([{ ...observed, rule: "demo/no-runtime-typeof" } as ITraceRecord], expected),
    TraceProtocolError,
  );
  assertThrows(() => parseTraceStderr("unslop-trace:v2:run:{}"), TraceProtocolError);
  assertThrows(() => parseTraceStderr("unslop-trace:v1:run:{"), TraceProtocolError);
});

Deno.test("trace_protocol_preserves_unrelated_stderr", () => {
  const base = { runId: RUN_ID, plugin: "demo", file: "a.ts" };
  const checked: ITraceRecord = { kind: "checked", ...base, rule: "demo/no-runtime-typeof" };
  const other: ITraceRecord = { kind: "checked", ...base, runId: "other", rule: "demo/no-runtime-typeof" };
  const stderr = ["host line", formatTraceRecord(checked), formatTraceRecord(other), "tail line"].join("\n");
  const parsed = parseTraceStderr(stderr, RUN_ID);
  assertEquals(parsed.records, [checked]);
  assertEquals(parsed.unrelated, ["host line", formatTraceRecord(other), "tail line"]);
  assertEquals(parseTraceStderr("plain host output").unrelated, ["plain host output"]);
});

Deno.test("throwing_rule_never_emits_checked", async () => {
  const catalog = catalogWith({
    "demo/explode": { engine: "plugin", severity: "error", scope: "all", tags: ["type-safety"] },
  });
  const catalogJson = JSON.stringify(catalog);
  const pluginSource = [
    `import { createLintPlugin, createRuleRegistry, parseCatalog, TYPESCRIPT_RULE_PACK } from "engine";`,
    `import { z } from "zod";`,
    `const throwing = {`,
    `  name: "throwing",`,
    `  rules: { explode: { meta: TYPESCRIPT_RULE_PACK.rules["no-runtime-typeof"].meta, create() { throw new Error("boom"); } } },`,
    `  optionSchemas: { explode: z.object({}) },`,
    `};`,
    `const packs = [TYPESCRIPT_RULE_PACK, throwing];`,
    `const registry = createRuleRegistry("demo", packs);`,
    `const catalog = parseCatalog(${catalogJson}, { scriptRuleSchemas: null, registry });`,
    `export default createLintPlugin("demo", catalog, { rulePacks: packs });`,
    "",
  ].join("\n");
  await withDemoProject({ files: { "a.ts": "export const x = 1;\n" }, catalog, pluginSource }, async (dir) => {
    const result = await runDeno(["lint", "--json", "--config", "deno.json", "a.ts"], dir, { [TRACE_ENV]: "1" });
    assertEquals(result.code === 0, false, result.stderr);
    const records = recordsOf(result.stderr);
    assertEquals(records.some((record) => record.kind === "checked" && record.rule === "demo/explode"), false);
  });
});

Deno.test("reserved_observer_key_collision_is_refused", () => {
  const reserved: IRulePack = {
    name: "reserved",
    rules: {
      "internal-coverage": {
        meta: TYPESCRIPT_RULE_PACK.rules["no-runtime-typeof"].meta,
        create: () => ({}),
      },
    },
    optionSchemas: { "internal-coverage": z.object({}) },
  };
  assertThrows(
    () =>
      createLintPlugin(TEST_PLUGIN_NAME, loadTestCatalog(catalogWith({})), {
        rulePacks: [...TEST_RULE_PACKS, reserved],
      }),
    Error,
    "reserved",
  );
});
