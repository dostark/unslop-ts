/**
 * @module CliUsageTest
 * @path tests/cli_usage_test.ts
 * @description The CLI usage names the unslop task vocabulary, not the engine checkout aliases.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/cli/unslop.ts, tests/helpers/cli_project.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { CLI_PATH } from "./helpers/cli_project.ts";
import { runDeno } from "./helpers/demo_project.ts";

Deno.test("cli_usage_uses_the_unslop_task_names", async () => {
  const result = await runDeno(["run", "--allow-read", "--allow-env", CLI_PATH], Deno.cwd());
  assertEquals(result.code, 2, result.stderr);
  assertStringIncludes(result.stderr, "unslop <command>");
  assertStringIncludes(result.stderr, "unslop:write <command>");
  assertEquals(result.stderr.includes("deno task cli"), false);
});
