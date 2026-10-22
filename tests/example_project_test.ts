/**
 * @module ExampleProjectTest
 * @path tests/example_project_test.ts
 * @description A Deno project outside the engine loads the version 2 example project and sees preset, override, ignore, and selection behavior.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [examples/lint_plugin.ts, examples/unslop.project.ts, examples/unslop.config.json]
 */

import { assertArrayIncludes, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runDeno } from "./helpers/demo_project.ts";

const PRESET_VIOLATION = "export const value = 1 as never as number;\n";
const OVERRIDE_VIOLATION = "export function wider(a: number, b: number, c: number): number {\n  return a + b + c;\n}\n";
const NAMED_IGNORE =
  "// deno-lint-ignore demo/no-explicit-unknown -- the fixture stores an unknown\nexport const value: unknown = 1;\n";
const UNIGNORED = "export const value: unknown = 1;\n";
const EXAMPLE_FILES = ["unslop.config.json", "unslop.project.ts", "lint_plugin.ts"];

interface ILintReport {
  readonly diagnostics?: readonly { readonly code?: string }[];
  readonly errors?: readonly unknown[];
}

async function projectConfig(): Promise<string> {
  const own = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
  return JSON.stringify({
    imports: { "@dostark/unslop-ts": new URL("../mod.ts", import.meta.url).href, zod: own.imports.zod },
    lint: { plugins: ["./examples/lint_plugin.ts"] },
  });
}

async function exampleProject(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "example_project_" });
  await Deno.mkdir(join(dir, "examples"));
  for (const name of EXAMPLE_FILES) {
    await Deno.copyFile(new URL(`../examples/${name}`, import.meta.url), join(dir, "examples", name));
  }
  await Deno.writeTextFile(join(dir, "deno.json"), await projectConfig());
  return dir;
}

async function lintReport(
  dir: string,
  files: readonly string[],
  env: Record<string, string> = {},
): Promise<ILintReport> {
  const result = await runDeno(["lint", "--json", ...files], dir, env);
  return JSON.parse(result.stdout) as ILintReport;
}

function codes(report: ILintReport): (string | undefined)[] {
  return (report.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}

Deno.test("the_example_reports_a_preset_rule_and_honors_a_long_form_override", async () => {
  const dir = await exampleProject();
  try {
    await Deno.writeTextFile(join(dir, "violation.ts"), PRESET_VIOLATION);
    await Deno.writeTextFile(join(dir, "override.ts"), OVERRIDE_VIOLATION);
    const report = await lintReport(dir, ["violation.ts", "override.ts"]);
    assertArrayIncludes(codes(report), ["demo/no-chained-type-assertions", "demo/max-params"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an_ignore_comment_for_an_unnamed_rule_is_known_to_deno", async () => {
  const dir = await exampleProject();
  try {
    const selection = { DEMO_LINT_RULES: "demo/no-explicit-unknown" };
    await Deno.writeTextFile(join(dir, "ignored.ts"), NAMED_IGNORE);
    await Deno.writeTextFile(join(dir, "plain.ts"), UNIGNORED);
    const ignored = await runDeno(["lint", "--json", "ignored.ts"], dir, selection);
    const ignoredReport = JSON.parse(ignored.stdout) as ILintReport;
    assertEquals(ignored.code, 0, ignored.stderr);
    assertEquals(ignoredReport.errors ?? [], []);
    assertEquals(codes(ignoredReport), []);
    assertArrayIncludes(codes(await lintReport(dir, ["plain.ts"], selection)), ["demo/no-explicit-unknown"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("existing_example_boundary_and_naming_cases", async () => {
  const dir = await exampleProject();
  try {
    await Deno.mkdir(join(dir, "src", "ui"), { recursive: true });
    await Deno.mkdir(join(dir, "src", "data"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "src", "ui", "view.ts"),
      'import { db } from "../data/db.ts";\nexport const view = db;\n',
    );
    await Deno.writeTextFile(join(dir, "src", "data", "db.ts"), "export const db = 1;\n");
    const silent = await lintReport(dir, ["src"]);
    assertEquals(codes(silent).includes("demo/import-boundaries"), false);
    const selected = await lintReport(dir, ["src"], { DEMO_LINT_RULES: "demo/import-boundaries" });
    assertArrayIncludes(codes(selected), ["demo/import-boundaries"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
