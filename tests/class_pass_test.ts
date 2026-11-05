/**
 * @module ClassPassTest
 * @path tests/class_pass_test.ts
 * @description Typed ATFD and CBO of the class pass, and the join between the classes that the Babel tree measures and the classes that the TypeScript compiler tree types.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/class_pass.ts, src/rules/whole_tree/class_receivers.ts, tests/helpers/temp_repo.ts]
 */

import { assertEquals } from "@std/assert";
import { joinClasses } from "../src/report/class_pass.ts";
import { classNamed, passOver } from "./helpers/class_pass_repo.ts";

const OTHER =
  "export class Other {\n  x = 1;\n  y = 2;\n  get z(): number {\n    return 3;\n  }\n  act(): void {}\n}\n";
const SHAPE = "export interface IShape {\n  w: number;\n}\n";
const ATFD_SUBJECT = [
  'import { Other } from "./other.ts";',
  'import type { IShape } from "./shape.ts";',
  "export class Subject {",
  "  run(a: Other, s: IShape, u: Mystery): number {",
  "    a.x = 5;",
  "    a.act();",
  "    return a.x + a.y + a.z + s.w + u.q;",
  "  }",
  "}",
  "",
].join("\n");

Deno.test("typed-atfd: a read through a parameter typed to another class counts, and an interface receiver does not", async () => {
  const result = await passOver({ "other.ts": OTHER, "shape.ts": SHAPE, "subject.ts": ATFD_SUBJECT });
  const subject = classNamed(result, "Subject");
  assertEquals(subject.atfd, 3);
  assertEquals(subject.precision, "typed");
});

const CBO_FILES: Readonly<Record<string, string>> = {
  "base.ts": "export class Base {}\n",
  "param.ts": "export class Param {}\n",
  "made.ts": "export class Made {}\n",
  "stat.ts": "export class Stat {\n  static make(): void {}\n}\n",
  "subject.ts": [
    'import { Base } from "./base.ts";',
    'import { Param } from "./param.ts";',
    'import { Made } from "./made.ts";',
    'import { Stat } from "./stat.ts";',
    "export class Subject extends Base {",
    "  run(p: Param): Promise<void> {",
    "    new Made();",
    "    Stat.make();",
    "    return Promise.resolve();",
    "  }",
    "  again(): Subject {",
    "    return this;",
    "  }",
    "}",
    "",
  ].join("\n"),
};

Deno.test("typed-cbo: a parameter type, a new, a static access and an extends give 4, and the class itself is not counted", async () => {
  const subject = classNamed(await passOver(CBO_FILES), "Subject");
  assertEquals(subject.cbo, 4);
  assertEquals(subject.precision, "typed");
});

Deno.test("class-join: a file whose two trees report the same classes joins every class", async () => {
  const result = await passOver({
    "pair.ts": "export class First {\n  a(): number {\n    return 1;\n  }\n}\nexport class Second {}\n",
  });
  assertEquals(result.classes.map((entry) => entry.metrics.name), ["First", "Second"]);
  assertEquals(result.unjoined, []);
  assertEquals(result.classes.every((entry) => entry.metrics.precision === "typed"), true);
});

Deno.test("class-join: a class that only the Babel tree reports is listed and keeps its syntactic metrics", async () => {
  const result = await passOver({
    "local.ts":
      "export class Outer {}\nexport function make() {\n  return class {\n    m(): number {\n      return 1;\n    }\n  };\n}\n",
  });
  assertEquals(result.unjoined.map((entry) => [entry.name, entry.reportedBy]), [["(anonymous)", "babel"]]);
  assertEquals(classNamed(result, "(anonymous)").precision, "syntactic");
  assertEquals(classNamed(result, "Outer").precision, "typed");
});

Deno.test("typed-shadowed-class-sites: same-name local classes retain separate receivers and hierarchy", async () => {
  const scope = (fields: string[]) =>
    `class Base {} class Remote { ${fields.map((name) => `${name} = 0;`).join(" ")} go() {} }
    class Local extends Base { run(remote: Remote) { remote.go(); return ${
      fields.map((name) => `remote.${name}`).join(" + ")
    }; } } return Local;`;
  const result = await passOver({
    "local.ts": `export function first() { ${scope(["x"])} } export function second() { ${scope(["y", "z"])} }`,
  });
  const locals = result.classes.filter((entry) => entry.name === "Local");
  assertEquals(
    locals.map((
      entry,
    ) => [
      entry.metrics.precision,
      entry.metrics.atfd,
      entry.metrics.cbo,
      entry.metrics.rfc,
      entry.metrics.dit,
      entry.metrics.noc,
    ]),
    [
      ["typed", 1, 2, 2, 1, 0],
      ["typed", 2, 2, 2, 1, 0],
    ],
  );
  assertEquals(result.classes.filter((entry) => entry.name === "Base").map((entry) => entry.metrics.noc), [1, 1]);
  assertEquals(new Set(locals.map((entry) => entry.nameOffset)).size, 2);
  assertEquals(result.unjoined, []);
});

Deno.test("typed-class-expression-alias: imported variable bindings resolve the named class without leaking its inner name", async () => {
  const result = await passOver({
    "made.ts":
      "export const Alias = class Inner { x = 0; go() {} }; export class Ghost { run() { return new Inner().x; } }",
    "user.ts":
      'import { Alias } from "./made.ts"; export class User { run() { const made = new Alias(); made.go(); return made.x; } }',
  });
  const user = classNamed(result, "User");
  assertEquals([user.atfd, user.cbo, user.rfc], [1, 1, 2]);
  const ghost = classNamed(result, "Ghost");
  assertEquals([ghost.atfd, ghost.cbo, ghost.rfc], [0, 0, 1]);
  assertEquals(result.unjoined, []);
});

Deno.test("class-join: a class that only the compiler tree reports fails the join and is listed", () => {
  const shared = { path: "a.ts", name: "Shared", nameOffset: 6 };
  const extra = { path: "a.ts", name: "Extra", nameOffset: 40 };
  const joined = joinClasses([shared], [shared, extra]);
  assertEquals(joined.pairs.length, 1);
  assertEquals(joined.unjoined.map((entry) => [entry.name, entry.reportedBy]), [["Extra", "typescript"]]);
});

Deno.test("class-join: the same name at another offset is another class", () => {
  const joined = joinClasses(
    [{ path: "a.ts", name: "Twin", nameOffset: 6 }],
    [{ path: "a.ts", name: "Twin", nameOffset: 60 }],
  );
  assertEquals(joined.pairs.length, 0);
  assertEquals(joined.unjoined.map((entry) => entry.reportedBy).sort(), ["babel", "typescript"]);
});

const RFC_FILES: Readonly<Record<string, string>> = {
  "other.ts": "export class Other {\n  a(): void {}\n  b(): void {}\n  c(): void {}\n}\n",
  "caller.ts": [
    'import { Other } from "./other.ts";',
    "export class Caller {",
    "  first(o: Other): void {",
    "    o.a();",
    "    o.b();",
    "  }",
    "  second(o: Other): void {",
    "    o.a();",
    "  }",
    "  third(): number {",
    "    return 1;",
    "  }",
    "}",
    "",
  ].join("\n"),
};

Deno.test("rfc: a class with three methods that calls two distinct methods of another class has RFC 5", async () => {
  const result = await passOver(RFC_FILES);
  assertEquals(classNamed(result, "Caller").rfc, 5);
  assertEquals(classNamed(result, "Other").rfc, 3);
});

const CHAIN_FILES: Readonly<Record<string, string>> = {
  "chain.ts": [
    "export class A {}",
    "export class B extends A {}",
    "export class C extends B {}",
    "export class D extends Missing {}",
    "",
  ].join("\n"),
};

Deno.test("dit-noc: a chain A <- B <- C gives DIT 0, 1, 2 and NOC 1, 1, 0, and an unresolved base gives DIT 1", async () => {
  const result = await passOver(CHAIN_FILES);
  const shape = ["A", "B", "C", "D"].map((name) => [name, classNamed(result, name).dit, classNamed(result, name).noc]);
  assertEquals(shape, [["A", 0, 1], ["B", 1, 1], ["C", 2, 0], ["D", 1, 0]]);
});

const SURFACE_SOURCE = [
  "export class Surface {",
  "  public field = 1;",
  "  private hidden = 2;",
  "  #secret = 3;",
  "  get value(): number {",
  "    return this.field;",
  "  }",
  "  run(): number {",
  "    return this.hidden;",
  "  }",
  "  stop(): number {",
  "    return this.#secret;",
  "  }",
  "  private quiet(): void {}",
  "}",
  "export class Pair {",
  "  constructor(public left: number, private right: number) {}",
  "  get sum(): number {",
  "    return this.left + this.right;",
  "  }",
  "  set sum(value: number) {",
  "    this.left = value;",
  "  }",
  "}",
  "export class Closed {",
  "  private only(): void {}",
  "}",
  "",
].join("\n");

Deno.test("woc-noap-noam: two public functional methods, one getter and one public field give WOC 2/4", async () => {
  const result = await passOver({ "surface.ts": SURFACE_SOURCE });
  const surface = classNamed(result, "Surface");
  assertEquals([surface.woc, surface.noap, surface.noam], [0.5, 1, 1]);
  const pair = classNamed(result, "Pair");
  // The public constructor property contributes to NOAP alongside the two accessors.
  assertEquals([pair.woc, pair.noap, pair.noam], [0, 1, 2]);
  assertEquals(classNamed(result, "Closed").woc, null);
});

Deno.test("class-parameter-visibility-pass: typed reporting retains the public constructor surface", async () => {
  const metrics = classNamed(
    await passOver({
      "dto.ts":
        "export class Dto { constructor(public x = 0, private y = 0, protected z = 0, readonly label = '') {} run() {} }",
    }),
    "Dto",
  );
  assertEquals([metrics.noa, metrics.noap, metrics.woc, metrics.precision], [4, 2, 1 / 3, "typed"]);
});
