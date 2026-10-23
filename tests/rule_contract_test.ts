/**
 * @module RuleContractTest
 * @path tests/rule_contract_test.ts
 * @description Keeps the rule code typed against the structural host contract, not the Deno lint namespace.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/fs, @std/path]
 * @related-files [src/rules/types.ts, src/engine/type_environment.ts, src/engine/comments.ts]
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

interface ISourceFile {
  readonly path: string;
  readonly text: string;
}

const PACKAGE_ROOT = fromFileUrl(new URL("..", import.meta.url));
const RULE_PATHS = ["src/rules"];
const ENGINE_PATHS = ["src/engine/type_environment.ts", "src/engine/comments.ts"];
const SCANNED_EXTENSIONS = [".ts"];
const WHOLE_TREE_PREFIX = "src/rules/whole_tree/";
const DENO_TOKEN = /\bDeno\./;

/** Every scanned file that names the Deno namespace, so the message names the offender. */
function denoReferences(files: readonly ISourceFile[]): string[] {
  return files.filter((file) => DENO_TOKEN.test(file.text)).map((file) => file.path);
}

async function contractFiles(): Promise<ISourceFile[]> {
  const paths = ENGINE_PATHS.map((file) => `${PACKAGE_ROOT}${file}`);
  for (const dir of RULE_PATHS) {
    for await (const entry of walk(`${PACKAGE_ROOT}${dir}`, { exts: SCANNED_EXTENSIONS, includeDirs: false })) {
      const path = relative(PACKAGE_ROOT, entry.path);
      if (path.startsWith(WHOLE_TREE_PREFIX)) continue;
      paths.push(entry.path);
    }
  }
  return await Promise.all(
    paths.map(async (path) => ({ path: relative(PACKAGE_ROOT, path), text: await Deno.readTextFile(path) })),
  );
}

Deno.test("the rule code and the rule-facing engine helpers name no Deno namespace token", async () => {
  assertEquals(denoReferences(await contractFiles()), []);
});

Deno.test("the contract scan reports a seeded Deno.lint.Node in a rule file", () => {
  const seeded = ["export function createRule(node: ", "Deno.lint.Node", "): void {}"].join("");
  assertEquals(denoReferences([{ path: "src/rules/seeded.ts", text: seeded }]), ["src/rules/seeded.ts"]);
});
