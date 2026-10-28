/**
 * @module WholeTreeUnusedClassMembersTest
 * @path tests/whole_tree_unused_class_members_test.ts
 * @description The parity mode of the unused-exports rule lists a private class member that its class never reads and a public method whose name no code accesses, and it exempts members that an implemented interface, an extended base, or the runtime calls.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/whole_tree/unused_class_members.ts, src/rules/whole_tree/unused_exports.ts]
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

/** The unwired class members of the parity report as `path:Class.member`, in report order. */
async function unusedMembers(root: string, overrides: Partial<IUnusedExportsSettings> = {}): Promise<string[]> {
  const options = { ...SETTINGS, ...overrides };
  const report = await checkRepository(root, false, options, true, {
    enumMembers: false,
    classMembers: true,
    production: false,
  });
  return report.findings.filter((finding) => finding.kind === "class-member").map((finding) =>
    `${finding.repoPath}:${finding.name}`
  );
}

const USE = 'import { Box } from "./src/box.ts";\nconst box = new Box();\n';

Deno.test("a public method whose name no code accesses is reported, and an accessed one is not", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/box.ts", "export class Box {\n  open() {}\n  close() {}\n  seal() {}\n}\n");
    await write(root, "packages/p/use.ts", `${USE}box.open();\nbox["close"]();\n`);
    assertEquals(await unusedMembers(root), ["packages/p/src/box.ts:Box.seal"]);
  });
});

Deno.test("a destructured name, an indexed access type, and a call inside the class count as accesses", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/box.ts",
      "export class Box {\n  a() {}\n  b() {}\n  c() {}\n  d() {}\n  run() {\n    this.d();\n  }\n}\n",
    );
    await write(
      root,
      "packages/p/use.ts",
      `${USE}const { a } = box;\nexport type B = Box["b"];\nbox.run();\nconsole.log(a, box.c);\n`,
    );
    assertEquals(await unusedMembers(root), []);
  });
});

Deno.test("an unrelated member with the same name hides a dead one, which the name match cannot tell apart", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/box.ts", "export class Box {\n  open() {}\n}\n");
    await write(root, "packages/p/src/door.ts", "export class Door {\n  open() {}\n}\n");
    await write(root, "packages/p/use.ts", 'import { Door } from "./src/door.ts";\nnew Door().open();\n');
    assertEquals(await unusedMembers(root), []);
  });
});

Deno.test("a private member is checked inside its class, and a write-only private field is unused", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/box.ts",
      [
        "export class Box {",
        "  private used = 1;",
        "  private unused = 2;",
        "  private written = 0;",
        "  #hidden = 3;",
        "  #deadHash = 4;",
        "  constructor(private readonly seen: number, private readonly lost: number) {}",
        "  private helper() {}",
        "  private deadHelper() {}",
        "  run() {",
        "    this.written = 5;",
        "    return [this.used, this.#hidden, this.seen, this.helper()];",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    await write(root, "packages/p/use.ts", `${USE}box.run();\n`);
    assertEquals(await unusedMembers(root), [
      "packages/p/src/box.ts:Box.unused",
      "packages/p/src/box.ts:Box.written",
      "packages/p/src/box.ts:Box.#deadHash",
      "packages/p/src/box.ts:Box.lost",
      "packages/p/src/box.ts:Box.deadHelper",
    ]);
  });
});

Deno.test("a member that an implemented interface declares is a contract, resolved or external", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/contract.ts", "export interface IRunner {\n  run(): void;\n}\n");
    await write(
      root,
      "packages/p/src/box.ts",
      [
        'import type { IRunner } from "./contract.ts";',
        "export class Box implements IRunner {",
        "  run() {}",
        "  extra() {}",
        "}",
        "export class External implements Disposable {",
        "  [Symbol.dispose]() {}",
        "  anything() {}",
        "}",
        "",
      ].join("\n"),
    );
    await write(
      root,
      "packages/p/use.ts",
      'import { Box, External } from "./src/box.ts";\nconsole.log(Box, External);\n',
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/box.ts:Box.extra"]);
  });
});

Deno.test("a member that an extended base declares is an override, and an unresolved base exempts the class", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/base.ts",
      "export class Base {\n  hook() {}\n  other() {\n    this.hook();\n  }\n}\n",
    );
    await write(
      root,
      "packages/p/src/box.ts",
      [
        'import { Base } from "./base.ts";',
        'import { Vendor } from "npm:vendor";',
        "export class Box extends Base {",
        "  hook() {}",
        "  extra() {}",
        "}",
        "export class Wrapped extends Vendor {",
        "  anything() {}",
        "}",
        "",
      ].join("\n"),
    );
    await write(
      root,
      "packages/p/use.ts",
      'import { Base } from "./src/base.ts";\nimport { Box, Wrapped } from "./src/box.ts";\nnew Base().other();\nconsole.log(Box, Wrapped);\n',
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/box.ts:Box.extra"]);
  });
});

Deno.test("an Error subclass keeps the built-in names and loses an unused custom method", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/failure.ts",
      'export class Failure extends Error {\n  override name = "Failure";\n  toString() { return "f"; }\n  explain() {}\n}\n',
    );
    await write(root, "packages/p/use.ts", 'import { Failure } from "./src/failure.ts";\nconsole.log(Failure);\n');
    assertEquals(await unusedMembers(root), ["packages/p/src/failure.ts:Failure.explain"]);
  });
});

Deno.test("runtime names, symbol keys, override, abstract, and decorated members are never reported", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/box.ts",
      [
        "export abstract class Box {",
        "  abstract make(): void;",
        "  toJSON() { return {}; }",
        "  then() {}",
        "  [Symbol.iterator]() { return [][Symbol.iterator](); }",
        "  override valueOf() { return 1; }",
        "  @tracked() tracked() {}",
        "  dead() {}",
        "}",
        "declare function tracked(): MethodDecorator;",
        "",
      ].join("\n"),
    );
    await write(root, "packages/p/use.ts", 'import { Box } from "./src/box.ts";\nconsole.log(Box);\n');
    assertEquals(await unusedMembers(root), ["packages/p/src/box.ts:Box.dead"]);
  });
});

Deno.test("static members, accessors, and a use from a test file follow the same rule", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/box.ts",
      [
        "export class Box {",
        "  static create() { return new Box(); }",
        "  static unusedStatic() {}",
        "  get size() { return 1; }",
        "  get lost() { return 2; }",
        "  fromTest() {}",
        "}",
        "",
      ].join("\n"),
    );
    await write(
      root,
      "packages/p/tests/box_test.ts",
      'import { Box } from "../src/box.ts";\nconsole.log(Box.create().size, Box.create().fromTest());\n',
    );
    assertEquals(await unusedMembers(root), [
      "packages/p/src/box.ts:Box.unusedStatic",
      "packages/p/src/box.ts:Box.lost",
    ]);
  });
});

Deno.test("public fields are not reported, and keyof on the class uses every member", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/box.ts", "export class Box {\n  label = 'x';\n  open() {}\n}\n");
    await write(root, "packages/p/src/keyed.ts", "export class Keyed {\n  go() {}\n}\n");
    await write(
      root,
      "packages/p/use.ts",
      'import { Box } from "./src/box.ts";\nimport { Keyed } from "./src/keyed.ts";\nexport type K = keyof Keyed;\nconsole.log(Box);\n',
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/box.ts:Box.open"]);
  });
});

Deno.test("a pragma exempts one member or the whole class, and only publicEntries makes a class public API", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/deno.json", JSON.stringify({ exports: { ".": "./mod.ts" } }));
    await write(root, "packages/p/mod.ts", 'export { Marked, Whole, Api, Plain } from "./src/box.ts";\n');
    await write(
      root,
      "packages/p/src/box.ts",
      [
        "export class Marked {",
        "  // unslop-ignore-next-line unused-class-member",
        "  kept() {}",
        "  dropped() {}",
        "}",
        "// unslop-ignore-next-line unused-class-member",
        "export class Whole {",
        "  one() {}",
        "}",
        "export class Api {",
        "  call() {}",
        "}",
        "export class Plain {",
        "  idle() {}",
        "}",
        "",
      ].join("\n"),
    );
    assertEquals(await unusedMembers(root, { publicEntries: ["packages/p/src/api_only.ts"] }), [
      "packages/p/src/box.ts:Marked.dropped",
      "packages/p/src/box.ts:Api.call",
      "packages/p/src/box.ts:Plain.idle",
    ]);
    assertEquals(await unusedMembers(root, { publicEntries: ["packages/p/src/box.ts"] }), []);
  });
});

Deno.test("class members are listed only when they are requested", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/box.ts", "export class Box {\n  idle() {}\n}\n");
    await write(root, "packages/p/use.ts", 'import { Box } from "./src/box.ts";\nconsole.log(Box);\n');
    const plain = await checkRepository(root, false, SETTINGS, true);
    assertEquals(plain.findings.filter((finding) => finding.kind === "class-member"), []);
    assertEquals((await unusedMembers(root)).length, 1);
  });
});
