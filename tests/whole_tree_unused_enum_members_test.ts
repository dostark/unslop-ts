/**
 * @module WholeTreeUnusedEnumMembersTest
 * @path tests/whole_tree_unused_enum_members_test.ts
 * @description The parity mode of the unused-exports rule lists an enum member that no `Enum.Member` reference reaches, and it treats an enum used as a whole value as using every member.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/whole_tree/unused_enum_members.ts, src/rules/whole_tree/unused_exports.ts]
 */

import { assertEquals } from "@std/assert";
import { checkRepository } from "../src/rules/whole_tree/unused_exports.ts";
import type { IUnusedExportsSettings } from "../src/rules/whole_tree/options.ts";
import { withRepo, write } from "./helpers/temp_repo.ts";

const SETTINGS: IUnusedExportsSettings = {
  productionRoots: ["packages/"],
  testSegments: ["/tests/"],
  testSuffixes: ["_test.ts"],
  entrypointSuffixes: ["/mod.ts"],
  mainEntrypointSuffixes: ["/main.ts"],
  scriptRoot: "scripts",
  walkSkipPatterns: ["node_modules"],
  strictSkipPrefixes: [],
  strictSkipSegments: [],
};

const ENUM_SOURCE = "export enum Mode {\n  Fast = 'fast',\n  Slow = 'slow',\n  Idle = 'idle',\n}\n";

/** The unwired enum members of the parity report as `path:Enum.Member`. */
async function unusedMembers(root: string, overrides: Partial<IUnusedExportsSettings> = {}): Promise<string[]> {
  const report = await checkRepository(root, false, { ...SETTINGS, ...overrides }, true, {
    enumMembers: true,
    classMembers: false,
    production: false,
  });
  return report.findings.filter((finding) => finding.kind === "enum-member").map((finding) =>
    `${finding.repoPath}:${finding.name}`
  );
}

Deno.test("an enum member that no reference reaches is reported, and a referenced one is not", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(
      root,
      "packages/p/use.ts",
      'import { Mode } from "./src/mode.ts";\nconsole.log(Mode.Fast, Mode["Slow"]);\n',
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/mode.ts:Mode.Idle"]);
  });
});

Deno.test("an enum that is used as a whole value uses every member", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(root, "packages/p/src/other.ts", "export enum Other {\n  A = 'a',\n  B = 'b',\n}\n");
    await write(
      root,
      "packages/p/use.ts",
      [
        'import { Mode } from "./src/mode.ts";',
        'import { Other } from "./src/other.ts";',
        "console.log(Object.values(Mode));",
        "export type Keys = keyof typeof Other;",
        "",
      ].join("\n"),
    );
    assertEquals(await unusedMembers(root), []);
  });
});

Deno.test("an enum used as a type only does not use its members, and a member used as a type does", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(
      root,
      "packages/p/use.ts",
      'import { Mode } from "./src/mode.ts";\nexport function run(mode: Mode): Mode.Fast | null {\n  return mode === Mode.Slow ? null : null;\n}\n',
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/mode.ts:Mode.Idle"]);
  });
});

Deno.test("a reference through an alias import, a named barrel, and a star barrel reaches the enum", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(root, "packages/p/src/named.ts", 'export { Mode } from "./mode.ts";\n');
    await write(root, "packages/p/mod.ts", 'export * from "./src/named.ts";\n');
    await write(
      root,
      "packages/q/use.ts",
      'import { Mode as M } from "../p/mod.ts";\nconsole.log(M.Fast, M.Slow);\n',
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/mode.ts:Mode.Idle"]);
  });
});

Deno.test("a member read through a namespace import is used, and an escaping namespace uses every enum", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(root, "packages/p/src/size.ts", "export enum Size {\n  S = 's',\n  L = 'l',\n}\n");
    await write(
      root,
      "packages/q/use.ts",
      'import * as modes from "../p/src/mode.ts";\nimport * as sizes from "../p/src/size.ts";\nconsole.log(modes.Mode.Fast, sizes);\n',
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/mode.ts:Mode.Slow", "packages/p/src/mode.ts:Mode.Idle"]);
  });
});

Deno.test("an enum that is not exported is checked against references in its own file", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/local.ts",
      "enum Local {\n  Used,\n  Unused,\n  Derived = Used,\n}\nexport const value = Local.Derived;\n",
    );
    await write(root, "packages/p/use.ts", 'import { value } from "./src/local.ts";\nconsole.log(value);\n');
    assertEquals(await unusedMembers(root), ["packages/p/src/local.ts:Local.Unused"]);
  });
});

Deno.test("a reference from a test file counts as a use", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(
      root,
      "packages/p/tests/mode_test.ts",
      'import { Mode } from "../src/mode.ts";\nconsole.log(Mode.Fast, Mode.Slow, Mode.Idle);\n',
    );
    assertEquals(await unusedMembers(root), []);
  });
});

Deno.test("a computed access, a value use, and an export under another name use every member", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/a.ts", "export enum A {\n  One,\n  Two,\n}\n");
    await write(root, "packages/p/src/b.ts", "export enum B {\n  One,\n  Two,\n}\n");
    await write(root, "packages/p/src/c.ts", "enum C {\n  One,\n  Two,\n}\nexport { C as Renamed };\n");
    await write(
      root,
      "packages/p/use.ts",
      [
        'import { A } from "./src/a.ts";',
        'import { B } from "./src/b.ts";',
        'import { Renamed } from "./src/c.ts";',
        "export function pick(key: string) {",
        "  return [A[key as keyof typeof A], Renamed, B];",
        "}",
        "",
      ].join("\n"),
    );
    assertEquals(await unusedMembers(root), []);
  });
});

Deno.test("a manifest export does not exempt an enum, a publicEntries file does, and a pragma exempts one member", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/deno.json", JSON.stringify({ exports: { ".": "./mod.ts" } }));
    await write(
      root,
      "packages/p/mod.ts",
      'export { Mode } from "./src/mode.ts";\nexport { Api } from "./src/api.ts";\n',
    );
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(root, "packages/p/src/api.ts", "export enum Api {\n  Get,\n  Put,\n}\n");
    await write(
      root,
      "packages/p/src/internal.ts",
      "export enum Internal {\n  // unslop-ignore-next-line unused-enum-member\n  Kept,\n  Dropped,\n}\n",
    );
    await write(
      root,
      "packages/p/use.ts",
      'import { Internal } from "./src/internal.ts";\nconsole.log(Internal.Kept, Internal.Dropped);\n',
    );
    assertEquals(await unusedMembers(root, { publicEntries: ["packages/p/src/api.ts"] }), [
      "packages/p/src/mode.ts:Mode.Fast",
      "packages/p/src/mode.ts:Mode.Slow",
      "packages/p/src/mode.ts:Mode.Idle",
    ]);
  });
});

Deno.test("an enum member finding carries its line and the dotted name", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(root, "packages/p/use.ts", 'import { Mode } from "./src/mode.ts";\nconsole.log(Mode.Fast);\n');
    const report = await checkRepository(root, false, SETTINGS, true, {
      enumMembers: true,
      classMembers: false,
      production: false,
    });
    const member = report.findings.find((finding) => finding.name === "Mode.Slow");
    assertEquals([member?.kind, member?.line], ["enum-member", 3]);
  });
});

Deno.test("the parity report lists enum members only when they are requested", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/mode.ts", ENUM_SOURCE);
    await write(root, "packages/p/use.ts", 'import { Mode } from "./src/mode.ts";\nconsole.log(Mode.Fast);\n');
    const plain = await checkRepository(root, false, SETTINGS, true);
    assertEquals(plain.findings.filter((finding) => finding.kind === "enum-member"), []);
    assertEquals((await unusedMembers(root)).length, 2);
  });
});

Deno.test("a pragma above an enum declaration exempts every member of the enum", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/closed.ts",
      "// unslop-ignore-next-line unused-enum-member\nexport enum Closed {\n  A,\n  B,\n}\nexport enum Open {\n  C,\n  D,\n}\n",
    );
    await write(
      root,
      "packages/p/use.ts",
      'import { Closed, Open } from "./src/closed.ts";\nconsole.log(Closed.A, Open.C);\n',
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/closed.ts:Open.D"]);
  });
});
