/**
 * @module WholeTreeUnusedProductionTest
 * @path tests/whole_tree_unused_production_test.ts
 * @description The production mode of the parity report ignores test files as sources of uses and labels each finding as unused or as used only by tests. The ordinary parity report is unchanged.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/whole_tree/unused_exports.ts, src/rules/whole_tree/unused_exports_resolved.ts]
 */

import { assertEquals } from "@std/assert";
import { checkRepository } from "../src/rules/whole_tree/unused_exports.ts";
import type { IUnusedExportsSettings } from "../src/rules/whole_tree/options.ts";
import { withRepo, write } from "./helpers/temp_repo.ts";

const SETTINGS: IUnusedExportsSettings = {
  productionRoots: ["packages/"],
  testSegments: ["/tests/", "/testing/"],
  testSuffixes: ["_test.ts"],
  entrypointSuffixes: ["/mod.ts"],
  mainEntrypointSuffixes: ["/main.ts"],
  scriptRoot: "scripts",
  walkSkipPatterns: ["node_modules"],
  strictSkipPrefixes: [],
  strictSkipSegments: [],
};

/** The findings of a parity run as `name (usedBy)`, in report order. */
async function findings(
  root: string,
  production: boolean,
  overrides: Partial<IUnusedExportsSettings> = {},
): Promise<string[]> {
  const options = { enumMembers: true, classMembers: true, production };
  const report = await checkRepository(root, false, { ...SETTINGS, ...overrides }, true, options);
  return report.findings.map((finding) => `${finding.name} (${finding.usedBy})`);
}

Deno.test("an export that only a test uses is test-only, one that nothing uses is unused, and a production use clears it", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/api.ts",
      "export const live = 1;\nexport const testOnly = 2;\nexport const dead = 3;\n",
    );
    await write(root, "packages/p/use.ts", 'import { live } from "./src/api.ts";\nconsole.log(live);\n');
    await write(
      root,
      "packages/p/tests/api_test.ts",
      'import { live, testOnly } from "../src/api.ts";\nconsole.log(live, testOnly);\n',
    );
    assertEquals(await findings(root, true), ["testOnly (tests)", "dead (nothing)"]);
    assertEquals(await findings(root, false), ["dead (nothing)"]);
  });
});

Deno.test("an export that a test file defines is test code and is never listed in production mode", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/tests/helpers.ts", "export const helper = 1;\n");
    await write(root, "packages/p/src/api.ts", "export const real = 1;\n");
    await write(root, "packages/p/use.ts", 'import { real } from "./src/api.ts";\nconsole.log(real);\n');
    assertEquals(await findings(root, true), []);
    assertEquals(await findings(root, false), ["helper (nothing)"]);
  });
});

Deno.test("a use through a barrel counts by the file that imports through the barrel", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/x.ts", "export const x = 1;\nexport const y = 2;\n");
    await write(root, "packages/p/mod.ts", 'export { x, y } from "./src/x.ts";\n');
    await write(root, "packages/q/use.ts", 'import { x } from "../p/mod.ts";\nconsole.log(x);\n');
    await write(root, "packages/q/tests/use_test.ts", 'import { y } from "../../p/mod.ts";\nconsole.log(y);\n');
    assertEquals(await findings(root, true), ["y (tests)", "y (tests)"]);
  });
});

Deno.test("an enum member and a class member that only tests reach are test-only", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", "export enum Mode {\n  Fast,\n  Slow,\n  Idle,\n}\n");
    await write(root, "packages/p/src/box.ts", "export class Box {\n  open() {}\n  peek() {}\n  idle() {}\n}\n");
    await write(
      root,
      "packages/p/use.ts",
      'import { Mode } from "./src/mode.ts";\nimport { Box } from "./src/box.ts";\nconsole.log(Mode.Fast, new Box().open());\n',
    );
    await write(
      root,
      "packages/p/tests/all_test.ts",
      'import { Mode } from "../src/mode.ts";\nimport { Box } from "../src/box.ts";\nconsole.log(Mode.Slow, new Box().peek());\n',
    );
    assertEquals(await findings(root, true), [
      "Box.peek (tests)",
      "Box.idle (nothing)",
      "Mode.Slow (tests)",
      "Mode.Idle (nothing)",
    ]);
    assertEquals(await findings(root, false), ["Box.idle (nothing)", "Mode.Idle (nothing)"]);
  });
});

Deno.test("a test access to a name no longer hides a dead production member of that name", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/box.ts", "export class Box {\n  open() {}\n}\n");
    await write(root, "packages/p/src/door.ts", "export class Door {\n  open() {}\n}\n");
    await write(root, "packages/p/use.ts", 'import { Box } from "./src/box.ts";\nconsole.log(Box);\n');
    await write(
      root,
      "packages/p/tests/door_test.ts",
      'import { Door } from "../src/door.ts";\nconsole.log(Door);\nconst loose = JSON.parse("{}") as { open(): void };\nloose.open();\n',
    );
    assertEquals(await findings(root, true), ["Box.open (tests)", "Door (tests)", "Door.open (tests)"]);
    assertEquals(await findings(root, false), []);
  });
});

Deno.test("a public entry file and a pragma still exempt a declaration in production mode", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/api.ts", "export const api = 1;\n");
    await write(root, "packages/p/src/mark.ts", "// unslop-ignore-next-line unused-export\nexport const marked = 1;\n");
    await write(
      root,
      "packages/p/tests/api_test.ts",
      'import { api } from "../src/api.ts";\nimport { marked } from "../src/mark.ts";\nconsole.log(api, marked);\n',
    );
    assertEquals(await findings(root, true, { publicEntries: ["packages/p/src/api.ts"] }), []);
  });
});

Deno.test("the ordinary parity report labels every finding as unused", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/api.ts", "export const dead = 1;\n");
    const report = await checkRepository(root, false, SETTINGS, true);
    assertEquals(report.findings.map((finding) => finding.usedBy), ["nothing"]);
  });
});

Deno.test("a test directory at the repository root is test code when the segment is written with slashes", async () => {
  await withRepo(async (root) => {
    await write(root, "src/api.ts", "export const real = 1;\n");
    await write(root, "src/use.ts", 'import { real } from "./api.ts";\nconsole.log(real);\n');
    await write(root, "tests/helpers.ts", "export const helper = 1;\n");
    const rootSettings = { ...SETTINGS, productionRoots: ["src/", "tests/"] };
    const options = { enumMembers: false, classMembers: false, production: true };
    const report = await checkRepository(root, false, rootSettings, true, options);
    assertEquals(report.findings.map((finding) => finding.name), []);
  });
});
