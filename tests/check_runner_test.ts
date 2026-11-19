/**
 * @module CheckRunnerTest
 * @path tests/check_runner_test.ts
 * @description The shared whole-tree runner returns a result, matches the CLI output, and reports usage faults and writes.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/cli/check_runner.ts, src/cli/whole_tree.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { JsonValue } from "../mod.ts";
import { asJsonValue } from "../src/engine/catalog.ts";
import { runWholeTreeCheck } from "../src/cli/check_runner.ts";
import { runDeno } from "./helpers/demo_project.ts";
import { OPTIONAL_PARAMS_SETTINGS } from "./helpers/whole_tree_settings.ts";

const CLI = new URL("../src/cli/whole_tree.ts", import.meta.url).href;

/** The fields of a written cycle baseline this test reads. */
interface ICycleBaselineFixture {
  readonly cycles: readonly JsonValue[];
}
const RUNTIME_A = 'import { b } from "./b.ts";\nexport const a = b;\n';
const RUNTIME_B = 'import { a } from "./a.ts";\nexport const b = 1;\n';

function catalogOf(baseline: string | null = null): JsonValue {
  return {
    version: "1",
    scopes: { test: ["**/tests/**"], fixture: [] },
    wholeTree: { importCycles: baseline === null ? {} : { baseline } },
  } as JsonValue;
}

async function withCycleProject<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "check_runner_" });
  try {
    await Deno.mkdir(join(dir, "src"));
    await Deno.writeTextFile(join(dir, "src/a.ts"), RUNTIME_A);
    await Deno.writeTextFile(join(dir, "src/b.ts"), RUNTIME_B);
    return await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("check-runner-result: a runtime cycle returns a verdict, a count and a JSON document", async () => {
  await withCycleProject(async (dir) => {
    const result = await runWholeTreeCheck("import-cycles", {
      catalog: catalogOf(),
      rootPath: dir,
      args: ["--format=json"],
    });
    assertEquals(result.code, 0);
    assertEquals(result.passed, false);
    assertEquals(result.findings, 1);
    assert(result.json !== null);
    assert(result.summary.length > 0);
    assertStringIncludes(result.stdout, '"cycles"');
    assertEquals(result.stderr, "");
  });
});

Deno.test("check-runner-parity: the CLI prints exactly the runner output and returns its code", async () => {
  await withCycleProject(async (dir) => {
    await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(catalogOf()));
    const runner = await runWholeTreeCheck("import-cycles", {
      catalog: catalogOf(),
      rootPath: dir,
      args: ["--format=text"],
    });
    const cli = await runDeno(
      ["run", "-A", CLI, "--rule=import-cycles", "--catalog=catalog.json", "--format=text"],
      dir,
    );
    assertEquals(cli.code, runner.code);
    assertEquals(cli.stdout, runner.stdout);

    const runnerJson = await runWholeTreeCheck("import-cycles", {
      catalog: catalogOf(),
      rootPath: dir,
      args: ["--format=json"],
    });
    const cliJson = await runDeno(
      ["run", "-A", CLI, "--rule=import-cycles", "--catalog=catalog.json", "--format=json"],
      dir,
    );
    assertEquals(cliJson.code, runnerJson.code);
    assertEquals(cliJson.stdout, runnerJson.stdout);
  });
});

Deno.test("check-runner-usage-error: an invalid flag returns code 2 instead of exiting", async () => {
  await withCycleProject(async (dir) => {
    const result = await runWholeTreeCheck("import-cycles", {
      catalog: catalogOf(),
      rootPath: dir,
      args: ["--min-files=0"],
    });
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "--min-files must be a positive integer");
    assertEquals(result.stdout, "");
  });
});

Deno.test("check-runner-side-effect: --update-baseline reports the file it wrote", async () => {
  await withCycleProject(async (dir) => {
    const result = await runWholeTreeCheck("import-cycles", {
      catalog: catalogOf("cycle_baseline.json"),
      rootPath: dir,
      args: ["--update-baseline"],
    });
    assertEquals(result.code, 0);
    const baseline = JSON.parse(await Deno.readTextFile(join(dir, "cycle_baseline.json"))) as ICycleBaselineFixture;
    assertEquals(baseline.cycles.length, 1);
  });
});

Deno.test("check-runner-scan-root: a scan root different from the project root is walked", async () => {
  const projectRoot = await Deno.makeTempDir({ prefix: "runner_root_" });
  const scanRoot = await Deno.makeTempDir({ prefix: "runner_scan_" });
  try {
    await Deno.mkdir(join(scanRoot, "src"));
    await Deno.writeTextFile(
      join(scanRoot, "src/fixture.ts"),
      "export function sample(value?: string) { return value; }\n",
    );
    const catalog = asJsonValue({
      version: "1",
      scopes: { test: [], fixture: [] },
      wholeTree: { optionalParams: OPTIONAL_PARAMS_SETTINGS },
    });
    const scanned = await runWholeTreeCheck("optional-params", {
      catalog,
      rootPath: projectRoot,
      scanRootPath: scanRoot,
      args: [],
    });
    assertEquals(scanned.findings, 1);
    assertStringIncludes(scanned.stderr, "BARE_OPTIONAL");
    const unscanned = await runWholeTreeCheck("optional-params", {
      catalog,
      rootPath: projectRoot,
      args: [],
    });
    assertEquals(unscanned.findings, 0);
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
    await Deno.remove(scanRoot, { recursive: true });
  }
});
