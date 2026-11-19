/**
 * @module CliCheckTest
 * @path tests/cli_check_test.ts
 * @description The `unslop check` route runs a configured whole-tree rule, forwards its flags and applies the level.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [src/cli/commands/check.ts, src/cli/check_runner.ts, tests/helpers/cli_project.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { JsonValue } from "../src/engine/catalog.ts";
import { runCli, withCliProject } from "./helpers/cli_project.ts";
import { runDeno } from "./helpers/demo_project.ts";

const CYCLE_A = 'import { b } from "./b.ts";\nexport const a = b;\n';
const CYCLE_B = 'import { a } from "./a.ts";\nexport const b = 1;\n';
const WHOLE_TREE_CLI = new URL("../src/cli/whole_tree.ts", import.meta.url).href;
const IMPORT_CYCLES_WARN: JsonValue = ["warn", {}];

/** The catalog fields a whole-tree run reads, written beside the fixture for the parity comparison. */
const CATALOG: JsonValue = {
  version: "1",
  scopes: { test: ["**/*_test.ts"], fixture: ["**/tests/fixtures/**"] },
  wholeTree: { importCycles: {} },
};

async function withCycleProject(
  body: (dir: string) => Promise<void>,
  rules: Readonly<Record<string, JsonValue>> = { "import-cycles": IMPORT_CYCLES_WARN },
): Promise<void> {
  await withCliProject(async (dir) => {
    await Deno.mkdir(join(dir, "src"));
    await Deno.writeTextFile(join(dir, "src/a.ts"), CYCLE_A);
    await Deno.writeTextFile(join(dir, "src/b.ts"), CYCLE_B);
    await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(CATALOG));
    await body(dir);
  }, { rules });
}

Deno.test("check-route-text: the route prints the whole-tree report for a configured rule", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--rule=import-cycles"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "1 runtime cycle(s)");
  });
});

Deno.test("check-route-json: the route emits exactly the whole-tree JSON document", async () => {
  await withCycleProject(async (dir) => {
    const route = await runCli(dir, ["check", "--rule=import-cycles", "--format=json"]);
    const direct = await runDeno(
      ["run", "-A", WHOLE_TREE_CLI, "--rule=import-cycles", "--catalog=catalog.json", "--format=json"],
      dir,
    );
    assertEquals(route.code, 0, route.stderr);
    assertEquals(JSON.parse(route.stdout), JSON.parse(direct.stdout));
  });
});

Deno.test("check-route-json-absent: a check without JSON exits 2", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--rule=constant-restatement", "--format=json"]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "does not produce JSON");
  });
});

Deno.test("check-route-flag: --trace and --fail reach the runner", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--rule=import-cycles", "--trace=src/a.ts", "--fail"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "Cycles that contain src/a.ts:");
    assertStringIncludes(result.stderr, "1 runtime cycle(s) found");
  });
});

Deno.test("check-route-strict: a warning-level finding exits 0, and --strict promotes it", async () => {
  await withCycleProject(async (dir) => {
    const plain = await runCli(dir, ["check", "--rule=import-cycles"]);
    assertEquals(plain.code, 0, plain.stderr);
    const strict = await runCli(dir, ["check", "--rule=import-cycles", "--strict"]);
    assertEquals(strict.code, 1, strict.stderr);
  });
});

Deno.test("check-route-warn-exit: a warn rule with a finding exits 0", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--rule=import-cycles"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "1 runtime cycle(s)");
  });
});

Deno.test("check-route-off-rule: an off rule never runs, and a whole-tree level stays host-fixed", async () => {
  await withCycleProject(async (dir) => {
    const off = await runCli(dir, ["check", "--rule=demo/require-module-header"]);
    assertEquals(off.code, 2);
    assertStringIncludes(off.stderr, "unslop report");
    const unnamed = await runCli(dir, ["check"]);
    assertEquals(unnamed.code, 2);
    assertStringIncludes(unnamed.stderr, "check needs --rule=<id>");
  });
  await withCycleProject(async (dir) => {
    const fixed = await runCli(dir, ["check", "--rule=import-cycles"]);
    assertEquals(fixed.code, 1);
    assertStringIncludes(fixed.stderr, "fixes the level at 'warn'");
  }, { "import-cycles": { level: "off", reason: "Measured separately." } });
});

Deno.test("check-route-legacy-catalog: a --catalog run resolves the rule and reports", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--rule=import-cycles", "--catalog=catalog.json"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "1 runtime cycle(s)");
  });
});

Deno.test("check-route-unknown-flag: a flag the check does not consume exits 2", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--rule=import-cycles", "--verbose"]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "does not accept --verbose");
  });
});

Deno.test("check-route-unknown: an unknown rule id exits 2 with candidates", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--rule=import-cycle"]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "unknown rule");
    assertStringIncludes(result.stderr, "import-cycles");
  });
});

Deno.test("check-route-hosted-rule: a plugin rule and a script rule are refused with their route", async () => {
  await withCycleProject(async (dir) => {
    const plugin = await runCli(dir, ["check", "--rule=demo/no-explicit-unknown"]);
    assertEquals(plugin.code, 2);
    assertStringIncludes(plugin.stderr, "unslop report");
    const script = await runCli(dir, ["check", "--rule=project-check"]);
    assertEquals(script.code, 2);
    assertStringIncludes(script.stderr, "hosted");
    assertStringIncludes(script.stderr, "deno task check:project");
  });
});

Deno.test("check-route-sarif: import-cycles writes SARIF and another check refuses it", async () => {
  await withCycleProject(async (dir) => {
    const sarif = await runCli(dir, ["check", "--rule=import-cycles", "--format=sarif"]);
    assertEquals(sarif.code, 0, sarif.stderr);
    assertStringIncludes(sarif.stdout, '"runs"');
    const refused = await runCli(dir, ["check", "--rule=constant-restatement", "--format=sarif"]);
    assertEquals(refused.code, 2);
    assertStringIncludes(refused.stderr, "does not produce SARIF");
  });
});

Deno.test("check-route-descriptor: --descriptor selects the project input", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, [
      "check",
      "--rule=import-cycles",
      "--descriptor=examples/unslop.project.ts",
    ]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "1 runtime cycle(s)");
  });
});
