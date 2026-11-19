/**
 * @module CliCheckTest
 * @path tests/cli_check_test.ts
 * @description The `unslop check` route runs a configured whole-tree rule, forwards its flags and applies the level.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [src/cli/commands/check.ts, src/cli/check_runner.ts, tests/helpers/cli_project.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { JsonValue } from "../src/engine/catalog.ts";
import { type ICliProjectOptions, runCli, withCliProject } from "./helpers/cli_project.ts";
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
  options: Omit<ICliProjectOptions, "rules"> = {},
): Promise<void> {
  await withCliProject(async (dir) => {
    await Deno.mkdir(join(dir, "src"));
    await Deno.writeTextFile(join(dir, "src/a.ts"), CYCLE_A);
    await Deno.writeTextFile(join(dir, "src/b.ts"), CYCLE_B);
    await Deno.writeTextFile(join(dir, "src/constants.ts"), 'export const HOSTS = ["a.test", "b.test"];\n');
    await Deno.mkdir(join(dir, "tests"));
    await Deno.writeTextFile(join(dir, "tests/placeholder_test.ts"), "export const ok = true;\n");
    await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(CATALOG));
    await body(dir);
  }, { rules, ...options });
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
    assertEquals(unnamed.code, 0, unnamed.stderr);
    assertEquals(unnamed.stdout.indexOf("demo/require-module-header"), -1);
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

/** The fields of the aggregate envelope this test reads. */
interface IEnvelopeRow {
  readonly id: string;
  readonly ran: boolean;
  readonly passed: boolean;
  readonly findings: number;
  readonly report: JsonValue | null;
}

interface ICheckEnvelope {
  readonly descriptor: string;
  readonly passed: boolean;
  readonly rules: readonly IEnvelopeRow[];
}

interface ICycleReportShape {
  readonly cycles?: readonly JsonValue[];
}

const DUPLICATE_TYPE_FILES = {
  "src/a_types.ts": "export interface IThing { a: string; b: number; }\n",
  "src/b_types.ts": "export interface IThing { a: string; b: number; }\n",
};

Deno.test("check-all-text: the aggregate prints a row per rule and the summary", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "import-cycles [warn] failed");
    assertStringIncludes(result.stdout, "duplicate-type [error] passed");
    assertStringIncludes(result.stdout, "passed ·");
    assertStringIncludes(result.stdout, "failed ·");
  });
});

Deno.test("check-all-json: the envelope carries each report or null, and passed is false", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--format=json"]);
    assertEquals(result.code, 0, result.stderr);
    const envelope = JSON.parse(result.stdout) as ICheckEnvelope;
    assertEquals(envelope.passed, false);
    assertEquals(typeof envelope.descriptor, "string");
    const cycleRow = envelope.rules.find((row) => row.id === "import-cycles");
    assert(cycleRow !== undefined);
    assertEquals(cycleRow.ran, true);
    assertEquals(cycleRow.passed, false);
    assertEquals(cycleRow.findings, 1);
    const report = cycleRow.report as ICycleReportShape | null;
    assert(report !== null);
    assertEquals(report.cycles?.length, 1);
    const duplicateRow = envelope.rules.find((row) => row.id === "duplicate-type");
    assert(duplicateRow !== undefined);
    assertEquals(duplicateRow.report, null);
  });
});

Deno.test("check-all-exit: an error failure exits 1, a warning-only set exits 0, and --strict exits 1", async () => {
  await withCycleProject(async (dir) => {
    const warningOnly = await runCli(dir, ["check"]);
    assertEquals(warningOnly.code, 0, warningOnly.stderr);
    const strict = await runCli(dir, ["check", "--strict"]);
    assertEquals(strict.code, 1, strict.stderr);
  });
  await withCycleProject(async (dir) => {
    for (const [name, source] of Object.entries(DUPLICATE_TYPE_FILES)) {
      await Deno.writeTextFile(join(dir, name), source);
    }
    const result = await runCli(dir, ["check"]);
    assertEquals(result.code, 1, result.stderr);
    assertStringIncludes(result.stdout, "duplicate-type [error] failed");
  });
});

Deno.test("check-all-skipped: an off rule is absent and an unrunnable active rule is named", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "duplicate-code [error] skipped — needs a child runner");
    assertEquals(result.stdout.indexOf("magic-literals"), -1);
  }, {
    "duplicate-code": ["error", { groups: [{ name: "src", paths: ["src"], threshold: 10 }] }],
  });
});

Deno.test("check-all-skipped-exit: a skipped rule contributes no exit failure", async () => {
  await withCycleProject(async (dir) => {
    await Deno.remove(join(dir, "src/a.ts"));
    await Deno.remove(join(dir, "src/b.ts"));
    const result = await runCli(dir, ["check"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "duplicate-code [error] skipped — needs a child runner");
  }, {
    "duplicate-code": ["error", { groups: [{ name: "src", paths: ["src"], threshold: 10 }] }],
  });
});

Deno.test("check-all-hosted: an active script rule appears as hosted with its command", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "project-check [warn] hosted — run deno task check:project");
  });
});

Deno.test("check-all-spawned-skipped: duplicate-code is skipped with its reason", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "duplicate-code [error] skipped — needs a child runner");
  }, {
    "duplicate-code": ["error", { groups: [{ name: "src", paths: ["src"], threshold: 10 }] }],
  });
});

Deno.test("check-all-sarif-refused: the aggregate with --format=sarif exits 2", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--format=sarif"]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "aggregate check does not produce SARIF");
  });
});

Deno.test("check-filter-select: --select runs only the named rules and tags", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--select=tag:imports,import-cycles"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "import-cycles [warn]");
    assertEquals(result.stdout.indexOf("duplicate-type"), -1);
  });
});

Deno.test("check-filter-profile: a named profile narrows the set", async () => {
  await withCycleProject(
    async (dir) => {
      const result = await runCli(dir, ["check", "--profile=imports"]);
      assertEquals(result.code, 0, result.stderr);
      assertStringIncludes(result.stdout, "import-cycles [warn]");
      assertEquals(result.stdout.indexOf("duplicate-type"), -1);
    },
    { "import-cycles": IMPORT_CYCLES_WARN },
    { profiles: { imports: ["tag:imports"] } },
  );
});

Deno.test("check-filter-category: the category narrows the set and composes with a level", async () => {
  await withCycleProject(async (dir) => {
    const imports = await runCli(dir, ["check", "--category=imports"]);
    assertEquals(imports.code, 0, imports.stderr);
    assertStringIncludes(imports.stdout, "import-cycles [warn]");
    assertEquals(imports.stdout.indexOf("duplicate-type"), -1);
    const crossed = await runCli(dir, ["check", "--category=imports", "--level=error"]);
    assertEquals(crossed.code, 0, crossed.stderr);
    assertEquals(crossed.stdout.indexOf("import-cycles"), -1);
  });
});

Deno.test("check-filter-level: --level=error drops warning-level rules", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--level=error"]);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.stdout.indexOf("import-cycles"), -1);
    assertStringIncludes(result.stdout, "duplicate-type [error]");
  });
});

Deno.test("check-filter-off-rule: an off rule never enters a selected run", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--select=project-check"]);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.stdout.indexOf("project-check"), -1);
  }, {
    "project-check": { level: "off", reason: "Retired for this project." },
  });
});

Deno.test("check-filter-exclude: excluding the failing rule flips the exit code", async () => {
  await withCycleProject(async (dir) => {
    for (const [name, source] of Object.entries(DUPLICATE_TYPE_FILES)) {
      await Deno.writeTextFile(join(dir, name), source);
    }
    const failing = await runCli(dir, ["check"]);
    assertEquals(failing.code, 1, failing.stderr);
    const excluded = await runCli(dir, ["check", "--exclude=duplicate-type"]);
    assertEquals(excluded.code, 0, excluded.stderr);
    assertEquals(excluded.stdout.indexOf("duplicate-type"), -1);
  });
});

Deno.test("check-filter-unknown: an unknown token exits 2", async () => {
  await withCycleProject(async (dir) => {
    for (
      const args of [
        ["check", "--select=tag:nope"],
        ["check", "--category=nope"],
        ["check", "--level=nope"],
        ["check", "--exclude=nope"],
      ]
    ) {
      const result = await runCli(dir, args);
      assertEquals(result.code, 2, `${args.join(" ")}\n${result.stderr}`);
    }
    const category = await runCli(dir, ["check", "--category=nope"]);
    assertStringIncludes(category.stderr, "known:");
  });
});

Deno.test("check-filter-parked-refused: --include-parked exits 2 with the plugin-only message", async () => {
  await withCycleProject(async (dir) => {
    const result = await runCli(dir, ["check", "--include-parked"]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "plugin-only");
  });
});
