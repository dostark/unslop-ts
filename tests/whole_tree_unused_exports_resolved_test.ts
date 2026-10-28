/**
 * @module WholeTreeUnusedExportsResolvedTest
 * @path tests/whole_tree_unused_exports_resolved_test.ts
 * @description The parity mode of the unused-exports rule matches each import to the module that defines the export, follows barrels, and reports an export only when no import reaches that exact site.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/whole_tree/unused_exports_resolved.ts, src/rules/whole_tree/unused_exports.ts]
 */

import { assertEquals } from "@std/assert";
import { checkRepository } from "../src/rules/whole_tree/unused_exports.ts";
import type { IUnusedExportsSettings } from "../src/rules/whole_tree/options.ts";
import { PARITY_SETTINGS } from "./helpers/parity_settings.ts";
import { withRepo, write } from "./helpers/temp_repo.ts";

const SETTINGS = PARITY_SETTINGS;

/** The unwired `path:name` pairs of the parity report, in report order. */
async function unwired(root: string, overrides: Partial<IUnusedExportsSettings> = {}): Promise<string[]> {
  const report = await checkRepository(root, false, { ...SETTINGS, ...overrides }, true);
  return report.findings.map((finding) => `${finding.repoPath}:${finding.name}`);
}

Deno.test("a name that another module exports and imports does not hide an unused export", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/a/src/shared.ts", "export const shared = 1;\n");
    await write(root, "packages/b/src/shared.ts", "export const shared = 2;\n");
    await write(root, "packages/b/src/use.ts", 'import { shared } from "./shared.ts";\nconsole.log(shared);\n');
    assertEquals(await unwired(root), ["packages/a/src/shared.ts:shared"]);
  });
});

Deno.test("a barrel re-export that nobody imports through the barrel is reported, and the definition is not", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/x.ts", "export const x = 1;\n");
    await write(root, "packages/p/mod.ts", 'export { x } from "./src/x.ts";\n');
    await write(root, "packages/p/src/use.ts", 'import { x } from "./x.ts";\nconsole.log(x);\n');
    assertEquals(await unwired(root), ["packages/p/mod.ts:x"]);
  });
});

Deno.test("an import through a named barrel or a star barrel uses the whole chain", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/x.ts", "export const x = 1;\nexport const y = 2;\n");
    await write(root, "packages/p/src/named.ts", 'export { x } from "./x.ts";\n');
    await write(root, "packages/p/mod.ts", 'export * from "./src/named.ts";\nexport { y } from "./src/x.ts";\n');
    await write(root, "packages/q/use.ts", 'import { x, y } from "../p/mod.ts";\nconsole.log(x, y);\n');
    assertEquals(await unwired(root), []);
  });
});

Deno.test("an import map entry in deno.json resolves a bare specifier to its module", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", JSON.stringify({ imports: { "@lib/": "./packages/lib/src/" } }));
    await write(root, "packages/lib/src/used.ts", "export const used = 1;\nexport const unused = 2;\n");
    await write(root, "packages/app/use.ts", 'import { used } from "@lib/used.ts";\nconsole.log(used);\n');
    assertEquals(await unwired(root), ["packages/lib/src/used.ts:unused"]);
  });
});

Deno.test("a namespace import uses the members it reads and uses every export when the namespace escapes", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/a.ts", "export const one = 1;\nexport const two = 2;\n");
    await write(root, "packages/p/src/b.ts", "export const three = 3;\nexport const four = 4;\n");
    await write(
      root,
      "packages/p/use.ts",
      'import * as a from "./src/a.ts";\nimport * as b from "./src/b.ts";\nconsole.log(a.one, b);\n',
    );
    assertEquals(await unwired(root), ["packages/p/src/a.ts:two"]);
  });
});

Deno.test("a destructured dynamic import uses the names it binds", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/lazy.ts", "export const wanted = 1;\nexport const other = 2;\n");
    await write(
      root,
      "packages/p/use.ts",
      'const { wanted } = await import("./src/lazy.ts");\nconsole.log(wanted);\n',
    );
    assertEquals(await unwired(root), ["packages/p/src/lazy.ts:other"]);
  });
});

Deno.test("a default import uses the default export", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/one.ts", "export default function one() {}\n");
    await write(root, "packages/p/src/two.ts", "export default function two() {}\n");
    await write(root, "packages/p/use.ts", 'import one from "./src/one.ts";\nconsole.log(one);\n');
    assertEquals(await unwired(root), ["packages/p/src/two.ts:default"]);
  });
});

Deno.test("an import of a name in the same file that re-exports it is not a consumer of the re-export", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/x.ts", "export const x = 1;\n");
    await write(root, "packages/p/src/f.ts", 'import { x } from "./x.ts";\nconsole.log(x);\nexport { x };\n');
    assertEquals(await unwired(root), ["packages/p/src/f.ts:x"]);
  });
});

Deno.test("a barrel that imports a binding and exports it from a local list forwards to the definition", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/impl.ts", "export const impl = 1;\nexport const unused = 2;\n");
    await write(
      root,
      "packages/p/src/barrel.ts",
      'import { impl, unused } from "./impl.ts";\nconsole.log(unused);\nexport { impl, unused };\n',
    );
    await write(root, "packages/p/mod.ts", 'export * from "./src/barrel.ts";\n');
    await write(root, "packages/q/use.ts", 'import { impl } from "../p/mod.ts";\nconsole.log(impl);\n');
    assertEquals(await unwired(root), ["packages/p/src/barrel.ts:unused"]);
  });
});

Deno.test("an import from a test file or a type-only import counts as a use", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/t.ts", "export const fromTest = 1;\nexport interface IShape { a: number }\n");
    await write(
      root,
      "packages/p/tests/t_test.ts",
      'import { fromTest, type IShape } from "../src/t.ts";\nconsole.log(fromTest, {} as IShape);\n',
    );
    assertEquals(await unwired(root), []);
  });
});

Deno.test("a pragma and a test hook exempt an export", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/e.ts",
      "// unslop-ignore-next-line unused-export\nexport const marked = 1;\nexport const __test_hook = 2;\nexport const bare = 3;\n",
    );
    assertEquals(await unwired(root), ["packages/p/src/e.ts:bare"]);
  });
});

Deno.test("the files that a package manifest exports are public API, with everything they forward", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/deno.json", JSON.stringify({ exports: { ".": "./mod.ts" } }));
    await write(root, "packages/p/mod.ts", 'export * from "./src/star.ts";\nexport { named } from "./src/named.ts";\n');
    await write(root, "packages/p/src/star.ts", "export const fromStar = 1;\n");
    await write(root, "packages/p/src/named.ts", "export const named = 1;\n");
    await write(root, "packages/p/src/internal.ts", "export const internal = 1;\n");
    await write(root, "packages/q/package.json", JSON.stringify({ main: "./index.ts" }));
    await write(root, "packages/q/index.ts", "export const fromNode = 1;\n");
    assertEquals(await unwired(root), ["packages/p/src/internal.ts:internal"]);
  });
});

Deno.test("an exported type that another exported declaration names is part of its API, and a value is not", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/api.ts",
      [
        "export interface IOptions { a: number }",
        "export type TMode = IOptions | null;",
        "export interface IAlone { b: number }",
        "export const LIMIT = 3;",
        "export function run(options: IOptions): number { return options.a + LIMIT; }",
        "export class Runner { mode: TMode = null; }",
        "",
      ].join("\n"),
    );
    await write(root, "packages/p/use.ts", 'import { run, Runner } from "./src/api.ts";\nconsole.log(run, Runner);\n');
    assertEquals(await unwired(root), ["packages/p/src/api.ts:IAlone", "packages/p/src/api.ts:LIMIT"]);
  });
});

Deno.test("a lint plugin file and a configured public entry file are public API", async () => {
  await withRepo(async (root) => {
    await write(root, "deno.json", JSON.stringify({ lint: { plugins: ["./packages/p/plugin.ts"] } }));
    await write(root, "packages/p/plugin.ts", "export default { name: 'p' };\nexport const helper = 1;\n");
    await write(root, "packages/p/bundle.ts", "export const bundled = 1;\n");
    await write(root, "packages/p/other.ts", "export const other = 1;\n");
    const reported = await unwired(root, { publicEntries: ["packages/p/bundle.ts"] });
    assertEquals(reported, ["packages/p/other.ts:other"]);
  });
});

Deno.test("findings come out in path and line order", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/z/z.ts", "export const z = 1;\n");
    await write(root, "packages/a/a.ts", "export const second = 1;\nexport const first = 2;\n");
    assertEquals(await unwired(root), ["packages/a/a.ts:second", "packages/a/a.ts:first", "packages/z/z.ts:z"]);
  });
});

Deno.test("an import whose binding nothing reads is not a use of the export", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/api.ts",
      "export const live = 1;\nexport const silenced = 2;\nexport const typed = 3;\nexport const forwarded = 4;\n",
    );
    await write(root, "packages/p/src/def.ts", "export default 5;\n");
    await write(
      root,
      "packages/p/use.ts",
      [
        'import { forwarded, live, type silenced as _silenced, typed } from "./src/api.ts";',
        'import unusedDefault from "./src/def.ts";',
        "const value: typeof typed = 3;",
        "export { forwarded };",
        "console.log(live, value);",
        "",
      ].join("\n"),
    );
    // `forwarded` is read by its own export list, so only the re-export of it in use.ts is unwired.
    assertEquals(await unwired(root), [
      "packages/p/src/api.ts:silenced",
      "packages/p/src/def.ts:default",
      "packages/p/use.ts:forwarded",
    ]);
  });
});

Deno.test("a default export that no import takes is reported, and a star re-export does not carry it", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/deno.json", JSON.stringify({ exports: { ".": "./mod.ts" } }));
    await write(root, "packages/p/mod.ts", 'export * from "./src/starred.ts";\n');
    await write(root, "packages/p/src/starred.ts", "export const named = 1;\nexport default { named };\n");
    await write(root, "packages/p/src/dead.ts", "export const a = 1;\nexport default { a };\n");
    await write(root, "packages/p/src/live.ts", "const b = 1;\nexport default { b };\nexport const kept = 2;\n");
    await write(
      root,
      "packages/p/use.ts",
      'import live, { kept } from "./src/live.ts";\nimport { a } from "./src/dead.ts";\nconsole.log(live, kept, a);\n',
    );
    assertEquals(await unwired(root), ["packages/p/src/dead.ts:default", "packages/p/src/starred.ts:default"]);
  });
});
