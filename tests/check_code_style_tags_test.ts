/**
 * @module CheckCodeStyleTagsTest
 * @path packages/lint-rules/tests/check_code_style_tags_test.ts
 * @description Tests `--tags` selection in the style checker and the `lint:tags` task contract.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/exaix/check_code_style.ts, packages/lint-rules/tests/check_code_style_catalog_parity_test.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
const CHECKER = "packages/lint-rules/src/exaix/check_code_style.ts";

const BOTH_TAGS_FIXTURE = `/**
 * @module TagFixture
 * @path packages/example/src/tag_fixture.ts
 * @description Temporary fixture for the tag-selection test.
 */

export const value: Promise<Response> = fetch('x');
// ==========
`;

async function runChecker(extraArgs: string[], filePath: string): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--config=deno.json", "-A", CHECKER, ...extraArgs, filePath],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const decoder = new TextDecoder();
  return { code: result.code, output: decoder.decode(result.stdout) + decoder.decode(result.stderr) };
}

Deno.test("--tags type-safety reports type-safety rules and hides others", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "tag_fixture.ts");
  await Deno.writeTextFile(file, BOTH_TAGS_FIXTURE);

  const result = await runChecker(["--tags=type-safety"], file);

  assertStringIncludes(result.output, "[promise-response-return]");
  assert(!result.output.includes("[decorative-comment]"), "decorative-comment must be hidden under --tags=type-safety");
});

Deno.test("--tags comments reports comment rules and hides type-safety rules", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "tag_fixture.ts");
  await Deno.writeTextFile(file, BOTH_TAGS_FIXTURE);

  const result = await runChecker(["--tags=comments"], file);

  assertStringIncludes(result.output, "[decorative-comment]");
  assert(
    !result.output.includes("[promise-response-return]"),
    "promise-response-return must be hidden under --tags=comments",
  );
});

Deno.test("--tags prints a per-tag count in the summary", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "tag_fixture.ts");
  await Deno.writeTextFile(file, BOTH_TAGS_FIXTURE);

  const result = await runChecker(["--tags=type-safety"], file);

  assertStringIncludes(result.output, "type-safety");
});

Deno.test("--tags with an unknown tag exits 2 and names the tag", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "tag_fixture.ts");
  await Deno.writeTextFile(file, BOTH_TAGS_FIXTURE);

  const result = await runChecker(["--tags=not-a-real-tag"], file);

  assertEquals(result.code, 2);
  assertStringIncludes(result.output, "not-a-real-tag");
});

Deno.test("lint:tags maps its arguments to tag: tokens for the plugin selection", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as {
    tasks: Record<string, string>;
  };
  const task = denoJson.tasks["lint:tags"];
  assert(task, "lint:tags task is defined");
  assertStringIncludes(task, "EXAIX_LINT_RULES");
  assertStringIncludes(task, "tag:");
  assertStringIncludes(task, "--rules-tags=");
});
