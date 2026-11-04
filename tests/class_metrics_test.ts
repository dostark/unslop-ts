/**
 * @module ClassMetricsTest
 * @path tests/class_metrics_test.ts
 * @description Class-unit metrics of the class metric core: NOM, NOA, WMC, TCC and LCOM4 on the Deno host AST.
 * @architectural-layer Test
 * @related-files [src/metrics/class_metrics.ts, tests/helpers/class_measurement.ts, tests/helpers/measurement.ts]
 */

import { assertEquals } from "@std/assert";
import { CLASSIC_OPTIONS, EXTENDED_OPTIONS } from "./helpers/measurement.ts";
import { measureClasses, measureClassesOnBabel } from "./helpers/class_measurement.ts";

const MEMBERS_SOURCE = "class Account {\n" +
  "  readonly id = 1;\n" +
  "  private count = 0;\n" +
  "  constructor(public name: string, private readonly size: number) {}\n" +
  "  get label(): string { return this.name; }\n" +
  "  set label(value: string) { this.name = value; }\n" +
  "  run(): void {}\n" +
  "}";

const WMC_SOURCE = "class Counter {\n" +
  "  constructor(public step: number) {}\n" +
  "  pick(flag: boolean): number {\n" +
  "    if (flag) return 1;\n" +
  "    return 0;\n" +
  "  }\n" +
  "  one(): number { return 1; }\n" +
  "}";

const NESTED_SOURCE = "class Outer {\n" +
  "  run(): number {\n" +
  "    const inner = (value: number): number => {\n" +
  "      if (value) return 1;\n" +
  "      return 0;\n" +
  "    };\n" +
  "    return inner(1);\n" +
  "  }\n" +
  "}";

const OPTIONAL_SOURCE =
  "class Reader {\n  read(box?: { value: number }): number | undefined {\n    return box?.value;\n  }\n}";

const TCC_SOURCE = "class Pairs {\n" +
  "  private x = 0;\n" +
  "  private y = 0;\n" +
  "  a(): number { return this.x; }\n" +
  "  b(): void { this.x = 1; }\n" +
  "  c(): number { return this.y; }\n" +
  "  d(): void { this.y = 2; }\n" +
  "}";

const ONE_VISIBLE_SOURCE = "class Single {\n" +
  "  private x = 0;\n" +
  "  open(): number { return this.x; }\n" +
  "  private hidden(): number { return this.x; }\n" +
  "  #secret(): number { return this.x; }\n" +
  "}";

const TWO_GROUPS_SOURCE = "class Groups {\n" +
  "  private a = 0;\n" +
  "  private b = 0;\n" +
  "  first(): number { return this.a; }\n" +
  "  second(): number { return this.b; }\n" +
  "}";

const JOINED_SOURCE = "class Groups {\n" +
  "  private a = 0;\n" +
  "  private b = 0;\n" +
  "  first(): number { return this.a + this.second(); }\n" +
  "  second(): number { return this.b; }\n" +
  "}";

Deno.test("class-nom-and-noa: accessors count as methods, the constructor does not, parameter properties are attributes", () => {
  const [metrics] = measureClasses(MEMBERS_SOURCE);
  assertEquals(metrics.name, "Account");
  assertEquals(metrics.nom, 3);
  assertEquals(metrics.noa, 4);
});

Deno.test("class-wmc: WMC equals the sum of the Phase 236 cyclomatic values of the constructor and the methods", () => {
  const [metrics] = measureClasses(WMC_SOURCE);
  assertEquals(metrics.wmc, 4);
});

Deno.test("class-wmc-nested: a nested function adds its decisions and not its base path", () => {
  const [metrics] = measureClasses(NESTED_SOURCE);
  assertEquals(metrics.wmc, 2);
});

Deno.test("class-wmc-variant: the classic and extended variants differ on an optional chain", () => {
  assertEquals(measureClasses(OPTIONAL_SOURCE, CLASSIC_OPTIONS)[0].wmc, 1);
  assertEquals(measureClasses(OPTIONAL_SOURCE, EXTENDED_OPTIONS)[0].wmc, 2);
});

Deno.test("class-tcc: four methods with two connected pairs give 2/6 and one visible method gives null", () => {
  const [pairs] = measureClasses(TCC_SOURCE);
  assertEquals(pairs.tcc, 2 / 6);
  const [single] = measureClasses(ONE_VISIBLE_SOURCE);
  assertEquals(single.tcc, null);
});

Deno.test("class-lcom4: two method groups give 2 and one call through this joins them into 1", () => {
  assertEquals(measureClasses(TWO_GROUPS_SOURCE)[0].lcom4, 2);
  assertEquals(measureClasses(JOINED_SOURCE)[0].lcom4, 1);
});

Deno.test("class-metrics: the class name, its line and its token lines are reported", () => {
  const [metrics] = measureClasses(`\n${TWO_GROUPS_SOURCE}`);
  assertEquals(metrics.name, "Groups");
  assertEquals(metrics.line, 2);
  assertEquals(metrics.loc, 6);
  assertEquals(metrics.precision, "syntactic");
});

Deno.test("class-metrics-cross-parser: the fixture classes measure the same on the Deno host and on the Babel AST", () => {
  const corpus = [MEMBERS_SOURCE, WMC_SOURCE, NESTED_SOURCE, OPTIONAL_SOURCE, TCC_SOURCE];
  for (const source of corpus) {
    for (const options of [CLASSIC_OPTIONS, EXTENDED_OPTIONS]) {
      assertEquals(measureClassesOnBabel(source, options), measureClasses(source, options), source);
    }
  }
});
