/**
 * @module ReadmeCliTest
 * @path tests/readme_cli_test.ts
 * @description The README names every implemented command, its exit and boundary contracts, and its examples execute through the CLI.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [README.md, src/cli/unslop.ts, tests/helpers/cli_project.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { runCli, withCliProject } from "./helpers/cli_project.ts";

const README_URL = new URL("../README.md", import.meta.url);

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

Deno.test("the_readme_lists_every_implemented_cli_command", async () => {
  const readme = await Deno.readTextFile(README_URL);
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

  await withCliProject(async (dir) => {
    const examples: readonly (readonly string[])[] = [
      ["rules", "show", "demo/max-params", "--format=json"],
      ["rules", "list", "--format=json", "--category=type-safety"],
      ["presets", "list", "--format=json"],
      ["config", "validate"],
      ["config", "print"],
      ["config", "schema"],
    ];
    for (const args of examples) {
      const result = await runCli(dir, args);
      assertEquals(result.code, 0, `${args.join(" ")}: ${result.stderr}`);
    }
  });
});

async function exists(url: URL): Promise<boolean> {
  try {
    return (await Deno.stat(url)).isFile;
  } catch {
    return false;
  }
}
