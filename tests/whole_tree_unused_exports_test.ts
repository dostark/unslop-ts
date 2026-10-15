/**
 * @module WholeTreeUnusedExportsTest
 * @path packages/lint-rules/tests/whole_tree_unused_exports_test.ts
 * @description The unused-exports rule honours its configured entry points.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/whole_tree/unused_exports.ts]
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { checkRepository } from "../src/rules/whole_tree/unused_exports.ts";
import type { IUnusedExportsSettings } from "../src/rules/whole_tree/options.ts";

function settings(entrypointSuffixes: readonly string[]): IUnusedExportsSettings {
  return {
    productionRoots: ["packages/"],
    testSegments: ["/tests/"],
    testSuffixes: ["_test.ts"],
    entrypointSuffixes: [...entrypointSuffixes],
    mainEntrypointSuffixes: ["/main.ts"],
    scriptRoot: "scripts",
    walkSkipPatterns: ["node_modules"],
    strictSkipPrefixes: [],
    strictSkipSegments: [],
  };
}

async function scenario(entrypointSuffixes: readonly string[]) {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "packages/p/src"), { recursive: true });
    await Deno.writeTextFile(join(root, "packages/p/src/a.ts"), "export function helper(): number { return 1; }\n");
    await Deno.writeTextFile(join(root, "packages/p/mod.ts"), 'export * from "./src/a.ts";\n');
    const report = await checkRepository(root, true, settings(entrypointSuffixes));
    return report.findings.some((finding) => finding.name === "helper");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("an export re-exported through a configured entry point is not reported", async () => {
  assert(!(await scenario(["/mod.ts"])));
});

Deno.test("changing entryPoints changes the result", async () => {
  assert(await scenario([]));
});
