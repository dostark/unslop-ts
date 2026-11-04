/**
 * @module ClassPassTest
 * @path tests/class_pass_test.ts
 * @description Typed ATFD and CBO of the class pass, and the join between the classes that the Babel tree measures and the classes that the TypeScript compiler tree types.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/class_pass.ts, src/rules/whole_tree/class_receivers.ts, tests/helpers/temp_repo.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { classPassOf, type IClassPassResult, joinClasses } from "../src/report/class_pass.ts";
import { moduleGraphOf } from "../src/report/exports.ts";
import { type IParsedHealthFile, parseHealthFile } from "../src/report/parse.ts";
import { CLASSIC_OPTIONS } from "./helpers/measurement.ts";
import { withRepo, write } from "./helpers/temp_repo.ts";

const SRC = "packages/p/src";

/** Writes the files into a temporary repository and runs the class pass over them. */
async function passOver(files: Readonly<Record<string, string>>): Promise<IClassPassResult> {
  let result: IClassPassResult | undefined;
  await withRepo(async (root) => {
    const parsed = new Map<string, IParsedHealthFile>();
    for (const [name, text] of Object.entries(files)) {
      const path = `${SRC}/${name}`;
      await write(root, path, text);
      parsed.set(path, await parseHealthFile(join(root, path), path));
    }
    const graph = await moduleGraphOf(parsed, { rootPath: root, publicEntries: [] });
    result = classPassOf({ files: parsed, graph, options: CLASSIC_OPTIONS });
  });
  return result!;
}

function classNamed(result: IClassPassResult, name: string) {
  const found = result.classes.find((entry) => entry.metrics.name === name);
  if (found === undefined) throw new Error(`The pass reports no class ${name}.`);
  return found.metrics;
}

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
      "export class Outer {}\nexport function make() {\n  return class Local {\n    m(): number {\n      return 1;\n    }\n  };\n}\n",
  });
  assertEquals(result.unjoined.map((entry) => [entry.name, entry.reportedBy]), [["Local", "babel"]]);
  assertEquals(classNamed(result, "Local").precision, "syntactic");
  assertEquals(classNamed(result, "Outer").precision, "typed");
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
  // A constructor parameter property is not a counted public attribute.
  assertEquals([pair.woc, pair.noap, pair.noam], [0, 0, 2]);
  assertEquals(classNamed(result, "Closed").woc, null);
});
