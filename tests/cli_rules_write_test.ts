/**
 * @module CliRulesWriteTest
 * @path tests/cli_rules_write_test.ts
 * @description The spawned write routes validate before writing, print a diff without touching disk, and reach a real lint run.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [src/cli/commands/rules_write.ts, src/config/edit.ts, tests/helpers/cli_project.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { replaceFile, WriteRefusalError } from "../src/cli/safe_write.ts";
import { CLI_PATH, withCliProject } from "./helpers/cli_project.ts";
import { runDeno } from "./helpers/demo_project.ts";

interface IRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Edits write, so the spawned CLI gets write access on top of read and env. */
async function runWriteCli(cwd: string, args: readonly string[]): Promise<IRun> {
  return await runDeno(["run", "--allow-read", "--allow-write", "--allow-env", CLI_PATH, ...args], cwd);
}

function configFile(dir: string): string {
  return join(dir, "examples", "unslop.config.json");
}

async function leftovers(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(join(dir, "examples"))) {
    if (entry.name.includes(".unslop")) names.push(entry.name);
  }
  return names.sort();
}

const VIOLATION = [
  "export function wider(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "export const value = 1 as never as number;",
  "",
].join("\n");

Deno.test("a_failed_compilation_leaves_the_file_unchanged", async () => {
  await withCliProject(async (dir) => {
    const before = await Deno.readTextFile(configFile(dir));
    const invalid = await runWriteCli(dir, ["rules", "set", "demo/max-params", 'max="wrong"']);
    assertEquals(invalid.code, 1);
    assertEquals(await Deno.readTextFile(configFile(dir)), before);

    const warn = await runWriteCli(dir, ["rules", "enable", "demo/import-boundaries", "--level=warn"]);
    assertEquals(warn.code, 2);
    assertEquals(await Deno.readTextFile(configFile(dir)), before);

    const fixed = await runWriteCli(dir, ["rules", "enable", "optional-params"]);
    assertEquals(fixed.code, 2);
    assertEquals(await Deno.readTextFile(configFile(dir)), before);

    const lock = join(dir, "examples", ".unslop.config.json.unslop.lock");
    await Deno.writeTextFile(lock, "");
    const locked = await runWriteCli(dir, ["rules", "set", "demo/max-params", "max=9"]);
    assertEquals(locked.code, 2);
    assertStringIncludes(locked.stderr, "holds");
    assertEquals(await Deno.readTextFile(configFile(dir)), before);
    await Deno.remove(lock);

    const copy = join(dir, "examples", "copy.json");
    await Deno.copyFile(configFile(dir), copy);
    await Deno.remove(configFile(dir));
    await Deno.symlink(copy, configFile(dir));
    const linked = await runWriteCli(dir, ["rules", "set", "demo/max-params", "max=9"]);
    assertEquals(linked.code, 2);
    assertStringIncludes(linked.stderr, "symlink");
    assertEquals(await Deno.readTextFile(copy), before);
  });

  const dir = await Deno.makeTempDir({ prefix: "unslop_stale_" });
  try {
    const path = join(dir, "config.json");
    await Deno.writeTextFile(path, "original\n");
    const error = await runStaleEdit(path);
    assertEquals(error instanceof WriteRefusalError, true);
    assertEquals(await Deno.readTextFile(path), "external\n");
    const names: string[] = [];
    for await (const entry of Deno.readDir(dir)) names.push(entry.name);
    assertEquals(names, ["config.json"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

async function runStaleEdit(path: string): Promise<unknown> {
  try {
    await replaceFile({
      path,
      contents: "replacement\n",
      expected: "original\n",
      hooks: {
        beforeCompare: async () => {
          await Deno.writeTextFile(path, "external\n");
        },
      },
    });
    throw new Error("the stale edit was not refused");
  } catch (error) {
    return error;
  }
}

Deno.test("dry_run_prints_a_diff_and_writes_nothing", async () => {
  await withCliProject(async (dir) => {
    const before = await Deno.readTextFile(configFile(dir));
    const result = await runWriteCli(dir, ["rules", "enable", "demo/no-boolean-assert", "--dry-run"]);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "--- ");
    assertStringIncludes(result.stdout, "+++ ");
    assertStringIncludes(result.stdout, '"demo/no-boolean-assert"');
    assertEquals(await Deno.readTextFile(configFile(dir)), before);
    assertEquals(await leftovers(dir), []);
  });
});

Deno.test("written_files_pass_deno_fmt_check", async () => {
  await withCliProject(async (dir) => {
    assertEquals((await runWriteCli(dir, ["rules", "set", "demo/max-params", "max=1"])).code, 0);
    assertEquals((await runWriteCli(dir, ["rules", "enable", "demo/no-boolean-assert"])).code, 0);
    const written = await Deno.readTextFile(configFile(dir));
    const parsed = JSON.parse(written) as { rules: Record<string, unknown> };
    assert("demo/max-params" in parsed.rules);
    assertEquals(parsed.rules["demo/no-boolean-assert"], "error");
    const format = await runDeno(["fmt", "--check", "examples/unslop.config.json"], dir);
    assertEquals(format.code, 0, format.stderr);
  });
});

Deno.test("two_cli_edits_reach_a_real_lint_run", async () => {
  await withCliProject(async (dir) => {
    assertEquals((await runWriteCli(dir, ["rules", "set", "demo/max-params", "max=1"])).code, 0);
    const disabled = await runWriteCli(dir, [
      "rules",
      "disable",
      "demo/no-chained-type-assertions",
      "--reason=The project records this check in review.",
    ]);
    assertEquals(disabled.code, 0, disabled.stderr);
    await Deno.writeTextFile(join(dir, "violation.ts"), VIOLATION);
    const lint = await runDeno(["lint", "--json", "violation.ts"], dir);
    const codes = ((JSON.parse(lint.stdout) as { diagnostics?: { code?: string }[] }).diagnostics ?? [])
      .map((diagnostic) => diagnostic.code);
    assert(codes.includes("demo/max-params"), lint.stdout);
    assertEquals(codes.includes("demo/no-chained-type-assertions"), false);
    assertEquals(codes.includes("demo/import-boundaries"), false);
  });
});

Deno.test("disable_without_reason_is_a_usage_error", async () => {
  await withCliProject(async (dir) => {
    const before = await Deno.readTextFile(configFile(dir));
    const result = await runWriteCli(dir, ["rules", "disable", "demo/no-chained-type-assertions"]);
    assertEquals(result.code, 2);
    assertEquals(await Deno.readTextFile(configFile(dir)), before);
    assertEquals(await leftovers(dir), []);
  });
});

Deno.test("a_prototype_option_name_is_refused", async () => {
  await withCliProject(async (dir) => {
    const before = await Deno.readTextFile(configFile(dir));
    const result = await runWriteCli(dir, ["rules", "set", "demo/max-params", '__proto__={"x":1}']);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "__proto__");
    assertEquals(await Deno.readTextFile(configFile(dir)), before);
  });
});
