/**
 * @module ExampleProjectTest
 * @path tests/example_project_test.ts
 * @description A Deno project that is not the engine's own loads the example plugin and sees the rule ids under `demo/`.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [examples/lint_plugin.ts, examples/catalog.json]
 */

import { assertArrayIncludes, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runDeno } from "./helpers/demo_project.ts";

const VIOLATION = "export const value = 1 as never as number;\n";
const EXAMPLE_FILES = ["catalog.json", "lint_plugin.ts"];

interface ILintReport {
  readonly diagnostics?: readonly { readonly code?: string }[];
}

async function projectConfig(): Promise<string> {
  const own = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
  return JSON.stringify({
    imports: { "@dostark/unslop-ts": new URL("../mod.ts", import.meta.url).href, zod: own.imports.zod },
    lint: { plugins: ["./examples/lint_plugin.ts"] },
  });
}

Deno.test("the example plugin lints a project outside the engine repository", async () => {
  const dir = await Deno.makeTempDir({ prefix: "example_project_" });
  try {
    await Deno.mkdir(join(dir, "examples"));
    for (const name of EXAMPLE_FILES) {
      await Deno.copyFile(new URL(`../examples/${name}`, import.meta.url), join(dir, "examples", name));
    }
    await Deno.writeTextFile(join(dir, "deno.json"), await projectConfig());
    await Deno.writeTextFile(join(dir, "violation.ts"), VIOLATION);
    const result = await runDeno(["lint", "--json", "violation.ts"], dir);
    const report = JSON.parse(result.stdout) as ILintReport;
    const codes = (report.diagnostics ?? []).map((diagnostic) => diagnostic.code);
    assertArrayIncludes(codes, ["demo/no-chained-type-assertions"]);
    assertEquals(result.code, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the example boundary zone reports an import in a project outside the engine repository", async () => {
  const dir = await Deno.makeTempDir({ prefix: "example_zone_" });
  try {
    await Deno.mkdir(join(dir, "examples"));
    for (const name of EXAMPLE_FILES) {
      await Deno.copyFile(new URL(`../examples/${name}`, import.meta.url), join(dir, "examples", name));
    }
    await Deno.writeTextFile(join(dir, "deno.json"), await projectConfig());
    await Deno.mkdir(join(dir, "src", "ui"), { recursive: true });
    await Deno.mkdir(join(dir, "src", "data"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "src", "ui", "view.ts"),
      'import { db } from "../data/db.ts";\nexport const view = db;\n',
    );
    await Deno.writeTextFile(join(dir, "src", "data", "db.ts"), "export const db = 1;\n");
    const silent = JSON.parse((await runDeno(["lint", "--json", "src"], dir)).stdout) as ILintReport;
    assertEquals(
      (silent.diagnostics ?? []).map((diagnostic) => diagnostic.code).includes("demo/import-boundaries"),
      false,
    );
    const selected = await runDeno(["lint", "--json", "src"], dir, { DEMO_LINT_RULES: "demo/import-boundaries" });
    const codes = ((JSON.parse(selected.stdout) as ILintReport).diagnostics ?? []).map((diagnostic) => diagnostic.code);
    assertArrayIncludes(codes, ["demo/import-boundaries"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
