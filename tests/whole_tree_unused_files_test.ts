/**
 * @module WholeTreeUnusedFilesTest
 * @path tests/whole_tree_unused_files_test.ts
 * @description The unused-files rule reports a production file that no entry point reaches, and it follows imports, re-exports, aliases, and configured roots.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/unused_files.ts, src/rules/whole_tree/options.ts]
 */

import { assertEquals } from "@std/assert";
import { checkRepository } from "../src/rules/whole_tree/unused_files.ts";
import type { IUnusedFilesSettings } from "../src/rules/whole_tree/options.ts";
import type { IUnusedFilesAlias } from "../src/rules/whole_tree/options.ts";
import { withRepo, write } from "./helpers/temp_repo.ts";

function settings(aliases: IUnusedFilesAlias[]): IUnusedFilesSettings {
  return {
    productionRoots: ["packages/"],
    testSegments: ["/tests/"],
    testSuffixes: ["_test.ts"],
    entrypointSuffixes: ["/mod.ts"],
    mainEntrypointSuffixes: ["/main.ts"],
    scriptRoot: "scripts",
    walkSkipPatterns: ["node_modules"],
    aliases,
    skipPrefixes: [],
    skipSegments: [],
  };
}

Deno.test("a production file that no entry point reaches is reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/mod.ts", 'export * from "./src/live.ts";\n');
    await write(root, "packages/p/src/live.ts", "export const live = 1;\n");
    await write(root, "packages/p/src/dead.ts", "export const dead = 1;\n");
    const report = await checkRepository(root, settings([]));
    assertEquals(report.findings.map((finding) => finding.repoPath), ["packages/p/src/dead.ts"]);
  });
});

Deno.test("a file imported through a configured alias is not reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/core/mod.ts", 'export * from "./src/value.ts";\n');
    await write(root, "packages/core/src/value.ts", "export const value = 1;\n");
    await write(root, "packages/app/main.ts", 'import { value } from "@core";\nconsole.log(value);\n');
    await write(root, "packages/app/src/orphan.ts", "export const orphan = 1;\n");
    const report = await checkRepository(root, settings([{ prefix: "@core", target: "packages/core/mod.ts" }]));
    assertEquals(report.findings.map((finding) => finding.repoPath), ["packages/app/src/orphan.ts"]);
  });
});

Deno.test("a test file and a script-root file are entry points", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/tests/helper.ts", "export const helper = 1;\n");
    await write(root, "packages/p/tests/p_test.ts", 'import { helper } from "./helper.ts";\nconsole.log(helper);\n');
    await write(root, "scripts/tool.ts", "export const tool = 1;\n");
    await write(root, "packages/p/src/dead.ts", "export const dead = 1;\n");
    const report = await checkRepository(root, settings([]));
    assertEquals(report.findings.map((finding) => finding.repoPath), ["packages/p/src/dead.ts"]);
  });
});

Deno.test("a configured skip segment is never reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/mod.ts", "export const entry = 1;\n");
    await write(root, "packages/p/src/generated/dead.ts", "export const dead = 1;\n");
    const report = await checkRepository(root, { ...settings([]), skipSegments: ["/generated/"] });
    assertEquals(report.findings, []);
  });
});

Deno.test("a file outside the production roots is never reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/mod.ts", "export const entry = 1;\n");
    await write(root, "tools/standalone.ts", "export const standalone = 1;\n");
    const report = await checkRepository(root, settings([]));
    assertEquals(report.findings, []);
  });
});
