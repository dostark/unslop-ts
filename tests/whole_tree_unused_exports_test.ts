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

Deno.test("an exported type alias is reported with the type-alias kind", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/kind.ts", 'export type Kind = "a" | "b";\n');
    const report = await checkRepository(root, true, settings([]));
    const finding = report.findings.find((entry) => entry.name === "Kind");
    assert(finding?.severity === "warning");
    assert(finding?.kind === "type-alias");
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

Deno.test("a member reached through a namespace import counts as usage", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/a.ts", "export function nsUsed(): number {\n  return 1;\n}\n");
    await write(root, "packages/p/src/b.ts", 'import * as M from "./a.ts";\n\nexport const value = M.nsUsed();\n');
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "nsUsed"));
  });
});

Deno.test("a configurable registration is exempt from the unused export report", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/config.ts",
      'export const DEFAULT_ALPHA = configurable({ key: "alpha.key", default: 1 });\n' +
        "export const UNUSED_PLAIN = 1;\n",
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "DEFAULT_ALPHA"));
    assert(report.findings.some((entry) => entry.name === "UNUSED_PLAIN"));
  });
});

Deno.test("a name destructured from a dynamic import counts as usage", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/a.ts", "export const dynUsed = 1;\n");
    await write(
      root,
      "packages/p/src/b.ts",
      'const { dynUsed } = await import("./a.ts");\n\nexport const value = dynUsed;\n',
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "dynUsed"));
  });
});

Deno.test("a test hook export is exempt in the broad report", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/hook.ts", "export function __test_probe(): number {\n  return 1;\n}\n");
    const report = await checkRepository(root, false, settings([]));
    assert(!report.findings.some((entry) => entry.name === "__test_probe"));
  });
});

Deno.test("a name destructured from a nested dynamic import counts as usage", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/a.ts", "export const nestedDynUsed = 1;\n");
    await write(
      root,
      "packages/p/src/b.ts",
      'const load = async () => {\n  const { nestedDynUsed } = await import("./a.ts");\n  return nestedDynUsed;\n};\n\nexport const value = load;\n',
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "nestedDynUsed"));
  });
});

Deno.test("a name destructured from a module variable imported dynamically counts as usage", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/a.ts", "export const moduleVarUsed = 1;\n");
    await write(
      root,
      "packages/p/src/b.ts",
      'const moduleExports = await import("./a.ts");\n\nconst { moduleVarUsed } = moduleExports;\n\nexport const value = moduleVarUsed;\n',
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "moduleVarUsed"));
  });
});

Deno.test("a name destructured from a stored import promise counts as usage", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/a.ts", "export const promiseUsed = 1;\n");
    await write(
      root,
      "packages/p/src/b.ts",
      'const modulePromise = import("./a.ts");\n\nconst { promiseUsed } = await modulePromise;\n\nexport const value = promiseUsed;\n',
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "promiseUsed"));
  });
});

Deno.test("an exported type alias that no file imports is reported as a warning", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/kind.ts", 'export type UnusedAlias = "a" | "b";\n');
    const report = await checkRepository(root, true, settings([]));
    const finding = report.findings.find((entry) => entry.name === "UnusedAlias");
    assert(finding?.severity === "warning");
  });
});

Deno.test("an imported type alias is not reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/kind.ts", 'export type UsedAlias = "a" | "b";\n');
    await write(
      root,
      "packages/p/src/use.ts",
      'import type { UsedAlias } from "./kind.ts";\nexport const value: UsedAlias = "a";\n',
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "UsedAlias"));
  });
});

Deno.test("the unused-type pragma exempts a type alias and an interface", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/kept.ts",
      "// unslop-ignore-next-line unused-type\nexport type KeptAlias = string;\n" +
        "// unslop-ignore-next-line unused-type\nexport interface IKept {\n  a: string;\n}\n",
    );
    const report = await checkRepository(root, true, settings([]));
    assert(!report.findings.some((entry) => entry.name === "KeptAlias" || entry.name === "IKept"));
  });
});

Deno.test("the parity report flags a named re-export that no consumer imports", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/a.ts", "export const barrelOnly = 1;\n");
    await write(root, "packages/p/mod.ts", 'export { barrelOnly } from "./src/a.ts";\n');
    const report = await checkRepository(root, false, settings([]), true);
    assert(report.findings.some((entry) => entry.name === "barrelOnly"));
  });
});

Deno.test("the parity report flags an entry-point declaration", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/mod.ts", "export const entryValue = 1;\n");
    const report = await checkRepository(root, false, settings([]), true);
    assert(report.findings.some((entry) => entry.name === "entryValue"));
  });
});

Deno.test("the parity report flags a test helper and ignores test imports", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/tests/helper.ts", "export const helperValue = 1;\n");
    await write(root, "packages/p/src/used.ts", "export const prodUsedByTest = 1;\n");
    await write(
      root,
      "packages/p/tests/use_test.ts",
      'import { prodUsedByTest } from "../src/used.ts";\n\nexport const value = prodUsedByTest;\n',
    );
    const report = await checkRepository(root, false, settings([]), true);
    assert(report.findings.some((entry) => entry.name === "helperValue"));
    assert(report.findings.some((entry) => entry.name === "prodUsedByTest"));
  });
});

Deno.test("the parity report includes scripts", async () => {
  await withRepo(async (root) => {
    await write(root, "scripts/tool.ts", "export const scriptValue = 1;\n");
    const report = await checkRepository(root, false, settings([]), true);
    assert(report.findings.some((entry) => entry.name === "scriptValue"));
  });
});

Deno.test("the parity report flags an unused interface as an error", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/types.ts", "export interface IUnusedParity {\n  a: string;\n}\n");
    const report = await checkRepository(root, false, settings([]), true);
    const finding = report.findings.find((entry) => entry.name === "IUnusedParity");
    assert(finding?.severity === "error");
  });
});

Deno.test("the parity report flags a default export and a namespace", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/default.ts", "export default 1;\n");
    await write(root, "packages/p/src/space.ts", "export namespace NsParity {\n  export const a = 1;\n}\n");
    const report = await checkRepository(root, false, settings([]), true);
    assert(report.findings.some((entry) => entry.name === "default"));
    assert(report.findings.some((entry) => entry.name === "NsParity"));
  });
});

Deno.test("the parity report honours the unused-export pragma", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/kept.ts",
      "// unslop-ignore-next-line unused-export\nexport const keptValue = 1;\n",
    );
    const report = await checkRepository(root, false, settings([]), true);
    assert(!report.findings.some((entry) => entry.name === "keptValue"));
  });
});

Deno.test("the parity report keeps a configurable registration exempt", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/config.ts",
      'export const DEFAULT_BETA = configurable({ key: "beta.key", default: 1 });\n',
    );
    const report = await checkRepository(root, false, settings([]), true);
    assert(!report.findings.some((entry) => entry.name === "DEFAULT_BETA"));
  });
});
