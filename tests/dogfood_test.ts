/**
 * @module DogfoodTest
 * @path tests/dogfood_test.ts
 * @description Proves the engine passes its own recommended preset and that a seeded violation fails.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [lint/unslop.config.json, lint/plugin.ts, deno.json]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { canWriteTo } from "./helpers/permissions.ts";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const TARGETS = ["mod.ts", "deno.ts", "eslint.ts", "src/"];
const SELF_RULES = /^self\//;

interface IDiagnostic {
  readonly code: string | null;
  readonly message: string;
}

async function lint(paths: readonly string[]): Promise<readonly IDiagnostic[]> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["lint", "--json", `--config=${join(ROOT, "deno.json")}`, ...paths],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const output = new TextDecoder().decode(result.stdout);
  return (JSON.parse(output) as { diagnostics: readonly IDiagnostic[] }).diagnostics;
}

Deno.test("the engine passes its own recommended preset", async () => {
  const diagnostics = await lint(TARGETS);
  assertEquals(diagnostics.filter((diagnostic) => SELF_RULES.test(diagnostic.code ?? "")), []);
});

Deno.test("a seeded recommended violation fails the check", { ignore: !canWriteTo(ROOT) }, async () => {
  const seeded = join(ROOT, "lint", "seeded_violation.ts");
  await Deno.writeTextFile(
    seeded,
    "/** @module Seeded */\nexport const value = input as unknown as string;\n",
  );
  try {
    const diagnostics = await lint(["lint/seeded_violation.ts"]);
    assert(diagnostics.some((diagnostic) => diagnostic.code === "self/no-chained-type-assertions"));
  } finally {
    await Deno.remove(seeded);
  }
});
