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
import { PARITY_SETTINGS } from "./helpers/parity_settings.ts";
import { withRepo, write } from "./helpers/temp_repo.ts";

const SETTINGS = PARITY_SETTINGS;

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

Deno.test("a member whose name another class accesses through a known receiver is still reported", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/box.ts", "export class Box {\n  open() {}\n}\n");
    await write(root, "packages/p/src/door.ts", "export class Door {\n  open() {}\n}\n");
    await write(
      root,
      "packages/p/use.ts",
      [
        'import { Door } from "./src/door.ts";',
        'import { Box } from "./src/box.ts";',
        "const door: Door = new Door();",
        "door.open();",
        "console.log(Box);",
        "",
      ].join("\n"),
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/box.ts:Box.open"]);
  });
});

const TARGET = "export class Target {\n  a() {}\n  b() {}\n  c() {}\n  d() {}\n  e() {}\n  f() {}\n  g() {}\n}\n";
const OTHER = TARGET.replace("class Target", "class Other");

Deno.test("an access through a typed parameter, variable, field, return type, cast, or pattern is tied to its class", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/target.ts", TARGET.replace("  g() {}\n", "  g() {}\n  static make() {}\n"));
    await write(root, "packages/p/src/other.ts", OTHER.replace("  g() {}\n", "  g() {}\n  static make() {}\n"));
    await write(
      root,
      "packages/p/use.ts",
      [
        'import { Target } from "./src/target.ts";',
        'import { Other } from "./src/other.ts";',
        "class Holder {",
        "  constructor(private readonly target: Target) {}",
        "  getTarget(): Target { return this.target; }",
        "  run(): void { this.target.d(); }",
        "}",
        "function viaParam(t: Target): void { t.b(); }",
        "const local = new Target();",
        "local.c();",
        "new Target().a();",
        "new Holder(local).run();",
        "new Holder(local).getTarget().e();",
        "viaParam(local);",
        '(JSON.parse("1") as Target).f();',
        "const { g } = new Target();",
        "Target.make();",
        "console.log(g, Other);",
        "",
      ].join("\n"),
    );
    assertEquals(
      await unusedMembers(root),
      ["a", "b", "c", "d", "e", "f", "g", "make"].map((name) => `packages/p/src/other.ts:Other.${name}`),
    );
  });
});

Deno.test("an access through an unknown receiver, or through an interface, is not tied to one class", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/target.ts", TARGET);
    await write(root, "packages/p/src/other.ts", OTHER);
    await write(
      root,
      "packages/p/src/shape.ts",
      [
        "export interface IShape {",
        "  area(): number;",
        "}",
        "export class Circle {",
        "  area() { return 1; }",
        "}",
        "export class Square {",
        "  area() { return 2; }",
        "}",
        "",
      ].join("\n"),
    );
    await write(
      root,
      "packages/p/use.ts",
      [
        'import { Target } from "./src/target.ts";',
        'import { Other } from "./src/other.ts";',
        'import { Circle, Square, type IShape } from "./src/shape.ts";',
        "[1].forEach((item) => (item as never as { a(): void }).a());",
        "function measure(shape: IShape): number { return shape.area(); }",
        "console.log(Target, Other, Circle, Square, measure);",
        "",
      ].join("\n"),
    );
    // Only `a` is accessed, through a receiver of unknown type, and `area` through an interface.
    const rest = ["b", "c", "d", "e", "f", "g"];
    assertEquals(await unusedMembers(root), [
      ...rest.map((name) => `packages/p/src/other.ts:Other.${name}`),
      ...rest.map((name) => `packages/p/src/target.ts:Target.${name}`),
    ]);
  });
});

Deno.test("a class in a test file is matched by name, because a test double is cast to the class it replaces", async () => {
  await withRepo(async (root) => {
    await write(root, "packages/p/src/registry.ts", "export class Registry {\n  put() {}\n  take() {}\n}\n");
    await write(
      root,
      "packages/p/tests/registry_test.ts",
      [
        'import { Registry } from "../src/registry.ts";',
        "class Spy {",
        "  put() {}",
        "  unused() {}",
        "}",
        "const registry = new Spy() as unknown as Registry;",
        "registry.put();",
        "console.log(Registry);",
        "",
      ].join("\n"),
    );
    assertEquals(await unusedMembers(root), [
      "packages/p/src/registry.ts:Registry.take",
      "packages/p/tests/registry_test.ts:Spy.unused",
    ]);
  });
});

Deno.test("a this access reaches the class and its relatives, and an instanceof narrowing keeps a subclass member", async () => {
  await withRepo(async (root) => {
    await write(
      root,
      "packages/p/src/tree.ts",
      [
        "export class Base {",
        "  run() { this.step(); }",
        "  step() {}",
        "}",
        "export class Sub extends Base {",
        "  extra() {}",
        "}",
        "export class Lone {",
        "  step() {}",
        "}",
        "",
      ].join("\n"),
    );
    await write(
      root,
      "packages/p/use.ts",
      [
        'import { Base, Lone, Sub } from "./src/tree.ts";',
        "function use(b: Base): void {",
        "  b.run();",
        "  if (b instanceof Sub) b.extra();",
        "}",
        "console.log(use, Lone);",
        "",
      ].join("\n"),
    );
    assertEquals(await unusedMembers(root), ["packages/p/src/tree.ts:Lone.step"]);
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
