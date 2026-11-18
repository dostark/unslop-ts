/**
 * @module WholeTreeImportCyclesTest
 * @path tests/whole_tree_import_cycles_test.ts
 * @description The whole-tree CLI reports import cycles in text and JSON, filters them, and gates with --fail.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/cli/whole_tree.ts, src/rules/whole_tree/checks.ts, src/rules/whole_tree/options.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { compileConfig, ConfigError, type JsonValue } from "../mod.ts";
import { testDescriptor } from "./helpers/descriptor.ts";
import { runDeno } from "./helpers/demo_project.ts";

const CLI = new URL("../src/cli/whole_tree.ts", import.meta.url).href;
const USAGE_EXIT = 2;
const RUNTIME_A = 'import { b } from "./b.ts";\nexport const a = b;\n';
const RUNTIME_B = 'import { a } from "./a.ts";\nexport const b = 1;\n';
const TYPE_ONE = 'import type { T2 } from "./t2.ts";\nexport type T1 = T2;\n';
const TYPE_TWO = 'import type { T1 } from "./t1.ts";\nexport type T2 = T1;\n';
const SELF_IMPORT = 'import { value } from "./self.ts";\nexport const value = 1;\n';

/** A catalog that enables the import-cycles check with the given settings. */
function catalogOf(settings: JsonValue): JsonValue {
  return {
    version: "1",
    scopes: { test: ["**/tests/**"], fixture: ["**/fixtures/**"] },
    wholeTree: { importCycles: settings },
  } as JsonValue;
}

/** Writes a project with one runtime cycle and one type-only cycle. */
async function writeCycleProject(dir: string, settings: JsonValue): Promise<void> {
  await Deno.mkdir(join(dir, "src"));
  await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(catalogOf(settings)));
  await Deno.writeTextFile(join(dir, "src/a.ts"), RUNTIME_A);
  await Deno.writeTextFile(join(dir, "src/b.ts"), RUNTIME_B);
  await Deno.writeTextFile(join(dir, "src/t1.ts"), TYPE_ONE);
  await Deno.writeTextFile(join(dir, "src/t2.ts"), TYPE_TWO);
}

async function inProject<T>(settings: JsonValue, body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "whole_tree_cycles_" });
  try {
    await writeCycleProject(dir, settings);
    return await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function run(dir: string, ...args: readonly string[]) {
  return runDeno(["run", "-A", CLI, "--rule=import-cycles", "--catalog=catalog.json", ...args], dir);
}

Deno.test("import-cycles-cli-text: a runtime cycle prints its members, path and the totals", async () => {
  await inProject({}, async (dir) => {
    const result = await run(dir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "1 runtime cycle(s)");
    assertStringIncludes(result.stdout, "1 type-only cycle(s)");
    assertStringIncludes(result.stdout, "runtime cyc-");
    assertStringIncludes(result.stdout, "members: src/a.ts, src/b.ts");
    assertStringIncludes(result.stdout, "path: src/a.ts -> src/b.ts -> src/a.ts");
  });
});

Deno.test("import-cycles-cli-json: the report is versioned, sorted and carries the graph state", async () => {
  await inProject({}, async (dir) => {
    const result = await run(dir, "--format=json");
    assertEquals(result.code, 0);
    const report = JSON.parse(result.stdout) as {
      version: number;
      truncated: boolean;
      totals: { runtime_sccs: number; type_only_sccs: number; mixed_sccs: number; files: number };
      graph: { complete: boolean; code_files: number; unresolved: number };
      cycles: readonly {
        id: string;
        kind: string;
        files: readonly string[];
        path: readonly string[];
        path_truncated: boolean;
        size: number;
        edge_count: number;
      }[];
    };
    assertEquals(report.version, 1);
    assertEquals(report.truncated, false);
    assertEquals(report.totals.runtime_sccs, 1);
    assertEquals(report.totals.type_only_sccs, 1);
    assertEquals(report.totals.mixed_sccs, 0);
    assertEquals(report.totals.files, 2);
    assertEquals(report.graph.complete, true);
    assertEquals(report.graph.code_files, 4);
    assertEquals(report.graph.unresolved, 0);
    assertEquals(report.cycles.map((cycle) => cycle.kind), ["runtime", "type-only"]);
    assertEquals(report.cycles[0].files, ["src/a.ts", "src/b.ts"]);
    assertEquals(report.cycles[0].path, ["src/a.ts", "src/b.ts", "src/a.ts"]);
    assertEquals(report.cycles[0].path_truncated, false);
    assertEquals(report.cycles[0].size, 2);
    assertEquals(report.cycles[0].edge_count, 2);
    assertStringIncludes(report.cycles[0].id, "cyc-");
    const second = await run(dir, "--format=json");
    assertEquals(second.stdout, result.stdout, "the JSON report is deterministic across runs");
  });
});

Deno.test("import-cycles-cli-fail: --fail exits 1 on a runtime cycle and the default exits 0", async () => {
  await inProject({}, async (dir) => {
    assertEquals((await run(dir)).code, 0);
    const gated = await run(dir, "--fail");
    assertEquals(gated.code, 1);
    assertStringIncludes(gated.stderr, "runtime cycle");
  });
});

/** One listed cycle, as the report prints it. */
interface IListedCycle {
  readonly kind: string;
  readonly size: number;
}

/** The subset of the JSON report that the filter test reads. */
interface IFilteredReport {
  readonly truncated?: boolean;
  readonly cycles: readonly IListedCycle[];
  readonly totals?: { readonly runtime_sccs: number; readonly type_only_sccs: number };
}

function reportOf(result: { readonly stdout: string }): IFilteredReport {
  return JSON.parse(result.stdout) as IFilteredReport;
}

Deno.test("import-cycles-cli-filter: the flags filter findings without changing the totals", async () => {
  await inProject({ includeTypeOnly: false }, async (dir) => {
    const runtimeOnly = reportOf(await run(dir, "--format=json"));
    assertEquals(runtimeOnly.cycles.map((cycle) => cycle.kind), ["runtime"]);

    const withTypes = reportOf(await run(dir, "--format=json", "--include-type-only"));
    assertEquals(withTypes.cycles.map((cycle) => cycle.kind), ["runtime", "type-only"]);

    const hidden = reportOf(await run(dir, "--format=json", "--min-files=3"));
    assertEquals(hidden.cycles, []);

    const capped = reportOf(await run(dir, "--format=json", "--top=1", "--include-type-only"));
    assertEquals(capped.cycles.length, 1);
    assertEquals(capped.truncated, true);
    assertEquals(capped.totals?.runtime_sccs, 1);
    assertEquals(capped.totals?.type_only_sccs, 1);

    await Deno.writeTextFile(join(dir, "src/self.ts"), SELF_IMPORT);
    const withoutSelf = reportOf(await run(dir, "--format=json"));
    assertEquals(withoutSelf.cycles.filter((cycle) => cycle.size === 1).length, 0);
    const withSelf = reportOf(await run(dir, "--format=json", "--include-self"));
    assertEquals(withSelf.cycles.filter((cycle) => cycle.size === 1).length, 1);
  });
});

Deno.test("import-cycles-catalog: the compiled catalog carries wholeTree.importCycles and rejects an unknown key", () => {
  const compiled = compileConfig({
    version: 2,
    plugin: "demo",
    rules: { "import-cycles": { level: "warn", options: { minFiles: 3, includeSelf: true } } },
  } as JsonValue, testDescriptor());
  assertEquals(compiled.catalog.wholeTree?.importCycles, {
    minFiles: 3,
    includeSelf: true,
    includeTypeOnly: true,
    gateRoots: [],
    baseline: null,
    failOnNew: true,
    failOnStale: false,
  });

  const unknown = assertThrows(
    () =>
      compileConfig({
        version: 2,
        plugin: "demo",
        rules: { "import-cycles": { level: "warn", options: { surprise: true } } },
      } as JsonValue, testDescriptor()),
    ConfigError,
  );
  assertEquals(unknown.path, "rules.import-cycles.options.surprise");
});

Deno.test("import-cycles-options: an invalid settings value exits 2 before any report", async () => {
  await inProject({ minFiles: 0 }, async (dir) => {
    const result = await run(dir);
    assertEquals(result.code, USAGE_EXIT);
    assertStringIncludes(result.stderr, "wholeTree.importCycles.minFiles");
    assertEquals(result.stdout, "");
  });
});
