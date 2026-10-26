/**
 * @module WholeTreeUnusedExportsTest
 * @path tests/whole_tree_unused_exports_test.ts
 * @description The unused-exports rule honours its configured entry points.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/unused_exports.ts]
 */

import { assert } from "@std/assert";
import { dirname, join } from "@std/path";
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

async function withRepo(body: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await body(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function write(root: string, repoPath: string, text: string): Promise<void> {
  const full = join(root, repoPath);
  await Deno.mkdir(dirname(full), { recursive: true });
  await Deno.writeTextFile(full, text);
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

Deno.test("the default report applies the exemption list and the broad report widens it", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "packages/p/src"), { recursive: true });
    await Deno.writeTextFile(join(root, "packages/p/mod.ts"), 'export * from "./src/a.ts";\n');
    await Deno.writeTextFile(join(root, "packages/p/src/a.ts"), "export function helper(): number { return 1; }\n");
    const trusted = await checkRepository(root, true, settings(["/mod.ts"]));
    const broad = await checkRepository(root, false, settings(["/mod.ts"]));
    assert(!trusted.findings.some((finding) => finding.name === "helper"));
    assert(broad.findings.some((finding) => finding.name === "helper"));
    assert(trusted.topDirectories.length === 0);
    assert(broad.topDirectories.length > 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("an exported interface that no file imports is reported as a warning", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/i_thing.ts", "export interface IUnusedThing {\n  a: string;\n}\n");
    const report = await checkRepository(root, true, settings([]));
    const finding = report.findings.find((entry) => entry.name === "IUnusedThing");
    assert(finding?.severity === "warning");
  });
});

Deno.test("an imported interface is not reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/types.ts", "export interface IUsedThing {\n  a: string;\n}\n");
    await write(
      root,
      "packages/p/src/use.ts",
      'import type { IUsedThing } from "./types.ts";\nexport const read = (value: IUsedThing): string => value.a;\n',
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "IUsedThing"));
  });
});

Deno.test("the unused-interface pragma exempts a declared interface", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/i_deliberate.ts",
      "// unslop-ignore-next-line unused-interface\nexport interface IDeliberate {\n  a: string;\n}\n",
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "IDeliberate"));
  });
});

Deno.test("an exported type alias stays out of the interface warning", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/kind.ts", 'export type Kind = "a" | "b";\n');
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "Kind"));
  });
});

Deno.test("an interface imported with an inline type modifier is not reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/types.ts", "export interface IInlineUsed {\n  a: string;\n}\n");
    await write(
      root,
      "packages/p/src/use.ts",
      'import { type IInlineUsed } from "./types.ts";\nexport const read = (value: IInlineUsed): string => value.a;\n',
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "IInlineUsed"));
  });
});

Deno.test("an interface re-exported by name is not reported at its declaration", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/types.ts", "export interface IReExported {\n  a: string;\n}\n");
    await write(root, "packages/p/src/barrel.ts", 'export type { IReExported } from "./types.ts";\n');
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "IReExported"));
  });
});

Deno.test("a star re-export alone does not hide an unused interface", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/types.ts", "export interface IStarOnly {\n  a: string;\n}\n");
    await write(root, "packages/p/src/barrel.ts", 'export * from "./types.ts";\n');
    const report = await checkRepository(root, true, settings([]));
    assert(report.findings.some((entry) => entry.name === "IStarOnly"));
  });
});

Deno.test("an interface imported only by a test file is not reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/types.ts", "export interface ITestOnly {\n  a: string;\n}\n");
    await write(
      root,
      "packages/p/tests/usage_test.ts",
      'import type { ITestOnly } from "../src/types.ts";\nexport const sample: ITestOnly = { a: "x" };\n',
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "ITestOnly"));
  });
});
