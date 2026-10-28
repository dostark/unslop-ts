/**
 * @module ReadmeCliTest
 * @path tests/readme_cli_test.ts
 * @description The README names every command, and every documented `deno task` example runs under the permissions its task grants.
 * @architectural-layer Test
 * @dependencies [@std/fs, @std/path]
 * @related-files [README.md, deno.json, src/cli/unslop.ts, tests/helpers/cli_project.ts]
 */

import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { CLI_PATH, withCliProject } from "./helpers/cli_project.ts";
import { runDeno } from "./helpers/demo_project.ts";

const README_URL = new URL("../README.md", import.meta.url);
const DENO_JSON_URL = new URL("../deno.json", import.meta.url);

const COMMANDS = [
  "unslop rules list",
  "unslop rules show <id>",
  "unslop rules enable <id>",
  "unslop rules disable <id>",
  "unslop rules set <id>",
  "unslop rules unset <id>",
  "unslop presets list",
  "unslop presets show <name>",
  "unslop config validate",
  "unslop config print",
  "unslop config schema",
  "unslop migrate",
];

const ROUTES = [
  "rules list",
  "rules show",
  "rules enable",
  "rules disable",
  "rules set",
  "rules unset",
  "presets list",
  "presets show",
  "config validate",
  "config print",
  "config schema",
  "migrate",
];

const V1_CATALOG = {
  version: "1",
  scopes: { test: ["**/*_test.ts"], fixture: ["**/tests/fixtures/**"] },
  layout: { sourceRoots: ["src"] },
  tagVocabulary: { "type-safety": { description: "Rules that keep type evidence." } },
  rules: {
    "demo/no-chained-type-assertions": {
      engine: "plugin",
      severity: "error",
      scope: "all",
      tags: ["type-safety"],
    },
  },
};

interface IExample {
  readonly line: string;
  readonly task: string;
  readonly args: readonly string[];
}

async function readReadme(): Promise<string> {
  return await Deno.readTextFile(README_URL);
}

function exampleLines(readme: string): string[] {
  const section = readme.split("### Command examples")[1] ?? "";
  const block = section.split("```sh")[1]?.split("```")[0] ?? "";
  return block.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("deno task "));
}

function examplesOf(readme: string): IExample[] {
  return exampleLines(readme).map((line) => {
    const parts = line.split(/\s+/);
    return { line, task: parts[2] ?? "", args: parts.slice(3) };
  });
}

function routeOf(example: IExample): string {
  return example.args.join(" ");
}

function missingRoutes(examples: readonly IExample[]): string[] {
  return ROUTES.filter((route) => !examples.some((example) => routeOf(example).startsWith(route)));
}

async function taskFlags(task: string): Promise<string[]> {
  const config = JSON.parse(await Deno.readTextFile(DENO_JSON_URL)) as { tasks: Record<string, string> };
  const command = config.tasks[task];
  if (command === undefined) throw new Error(`missing task '${task}'`);
  return command.match(/--allow-[a-z-]+(?:=[^\s]+)?/g) ?? [];
}

async function copyProject(base: string): Promise<{ dir: string; cleanup: string }> {
  const cleanup = await Deno.makeTempDir({ prefix: "readme_example_" });
  const dir = join(cleanup, "project");
  await copy(base, dir);
  return { dir, cleanup };
}

Deno.test("the_readme_lists_every_cli_command", async () => {
  const readme = await readReadme();
  for (const command of COMMANDS) assertStringIncludes(readme, command);
  for (const concept of ["--dry-run", "--descriptor", "--plugin", "Exit codes", "JSONC", "no-clobber"]) {
    assertStringIncludes(readme, concept);
  }
  assertStringIncludes(readme, "trusted executable project code");
  assertStringIncludes(readme, "Phase 232");
  assertEquals(readme.includes("examples/catalog.json"), false);

  for (const file of ["unslop.config.json", "unslop.project.ts", "lint_plugin.ts"]) {
    assert(await exists(new URL(`../examples/${file}`, import.meta.url)), file);
  }
});

Deno.test("every_readme_example_runs_with_its_documented_task", async () => {
  const examples = examplesOf(await readReadme());
  assertNotEquals(examples.length, 0, "the README holds runnable examples");
  await withCliProject(async (base) => {
    await Deno.writeTextFile(join(base, "catalog.json"), JSON.stringify(V1_CATALOG, null, 2));
    await Deno.mkdir(join(base, "src"), { recursive: true });
    await Deno.writeTextFile(join(base, "src", "clean.ts"), "export const value = 1;\n");
    for (const example of examples) {
      const flags = await taskFlags(example.task);
      const { dir, cleanup } = await copyProject(base);
      try {
        const result = await runDeno(["run", ...flags, CLI_PATH, ...example.args], dir);
        assertEquals(result.code, 0, `${example.line}\n${result.stderr}`);
      } finally {
        await Deno.remove(cleanup, { recursive: true });
      }
    }
  });
});

Deno.test("a_write_route_fails_under_the_read_only_task", async () => {
  const flags = await taskFlags("cli");
  await withCliProject(async (base) => {
    const { dir, cleanup } = await copyProject(base);
    try {
      const result = await runDeno(
        ["run", ...flags, CLI_PATH, "rules", "set", "demo/max-params", "max=9"],
        dir,
      );
      assertEquals(result.code, 2, result.stderr);
      assertStringIncludes(result.stderr, "write access");
    } finally {
      await Deno.remove(cleanup, { recursive: true });
    }
  });
});

Deno.test("removing_an_example_from_the_readme_fails_the_test", async () => {
  const examples = examplesOf(await readReadme());
  assertEquals(missingRoutes(examples), []);
  assertEquals(missingRoutes(examples.slice(1)).length > 0, true);
  for (const route of ROUTES) {
    assertEquals(
      missingRoutes(examples.filter((example) => !routeOf(example).startsWith(route))).includes(route),
      true,
    );
  }
});

async function exists(url: URL): Promise<boolean> {
  try {
    return (await Deno.stat(url)).isFile;
  } catch {
    return false;
  }
}

Deno.test("the_readme_names_the_bridge_and_the_two_tasks", async () => {
  const readme = await readReadFile();
  for (
    const text of [
      "deno task cli:write",
      "unslop config print",
      "--catalog",
      "whole-tree",
      "Phase 232 Step 5",
      "exclusionCodes",
      "optIn",
      "profile token is validated",
    ]
  ) {
    assertStringIncludes(readme, text);
  }
});

async function readReadFile(): Promise<string> {
  return await Deno.readTextFile(README_URL);
}

Deno.test("report_runs_with_documented_task_permissions", async () => {
  const flags = await taskFlags("cli:report");
  await withCliProject(async (base) => {
    await Deno.mkdir(join(base, "src"), { recursive: true });
    await Deno.writeTextFile(join(base, "src", "clean.ts"), "export const value = 1;\n");
    const result = await runDeno(["run", ...flags, CLI_PATH, "report", "--format=json", "src"], base);
    assertEquals(result.code, 0, result.stderr);
    assertEquals((JSON.parse(result.stdout) as { completion: string }).completion, "complete");
  });
});

Deno.test("report_out_requires_the_documented_write_invocation", async () => {
  const readFlags = await taskFlags("cli:report");
  const writeFlags = await taskFlags("cli:report:write");
  await withCliProject(async (base) => {
    await Deno.mkdir(join(base, "src"), { recursive: true });
    await Deno.writeTextFile(join(base, "src", "clean.ts"), "export const value = 1;\n");
    const refused = await runDeno(
      ["run", ...readFlags, CLI_PATH, "report", "--format=json", "--out=report.json", "src"],
      base,
    );
    assertEquals(refused.code, 2, refused.stderr);
    assertEquals(await exists(new URL(`file://${join(base, "report.json")}`)), false);
    const written = await runDeno(
      ["run", ...writeFlags, CLI_PATH, "report", "--format=json", "--out=report.json", "src"],
      base,
    );
    assertEquals(written.code, 0, written.stderr);
    assert(await exists(new URL(`file://${join(base, "report.json")}`)));
  });
});
