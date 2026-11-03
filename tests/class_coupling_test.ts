/**
 * @module ClassCouplingTest
 * @path tests/class_coupling_test.ts
 * @description Per-file ATFD and CBO of the class metric core: counted reads, exclusions and named dependencies.
 * @architectural-layer Test
 * @related-files [src/metrics/class_coupling.ts, src/metrics/class_metrics.ts, tests/helpers/class_measurement.ts]
 */

import { assertEquals } from "@std/assert";
import { measureClasses } from "./helpers/class_measurement.ts";

const FOREIGN_READS = "class Subject {\n" +
  "  first(other: Other): number { return other.value; }\n" +
  "  second(other: Other): number { return other.items.length + other.value; }\n" +
  "  held(): number { return this.link.size; }\n" +
  "  private link = new Link();\n" +
  "}";

const EXCLUSIONS = 'import * as ns from "./helpers.ts";\n' +
  "enum Mode { Fast, Slow }\n" +
  "class Subject {\n" +
  "  private own = 1;\n" +
  "  speak(): number { return 1; }\n" +
  "  run(other: Other): number {\n" +
  "    other.run();\n" +
  "    const helper = ns.helper;\n" +
  "    const mode = Mode.Fast;\n" +
  "    const mine = this.own;\n" +
  "    const reference = other.speak;\n" +
  "    other.value = 2;\n" +
  "    return helper + mode + mine + reference();\n" +
  "  }\n" +
  "}";

const COUPLED = 'import { Alpha, Beta, Delta, Epsilon, Gamma } from "./types.ts";\n' +
  "class Subject extends Delta {\n" +
  "  field: Alpha;\n" +
  "  cache: Map<string, Alpha> = new Map();\n" +
  "  make(): Beta { return new Beta(); }\n" +
  "  tick(): number { return Gamma.MAX; }\n" +
  "  again(): Subject { return this; }\n" +
  "}";

const QUALIFIED = 'import * as ns from "./types.ts";\n' +
  "class Subject {\n" +
  "  first: ns.Thing;\n" +
  "  second: ns.Thing;\n" +
  "  third: ns.Other;\n" +
  "}";

Deno.test("atfd-counts-foreign-reads: distinct reads of other objects count once each", () => {
  const [metrics] = measureClasses(FOREIGN_READS);
  assertEquals(metrics.atfd, 3);
});

Deno.test("atfd-exclusions: this, a call, a namespace, an enum, a declared method and a write add nothing", () => {
  const [metrics] = measureClasses(EXCLUSIONS);
  assertEquals(metrics.atfd, 0);
});

Deno.test("cbo-names: a type, a new, a static access and an extends of four classes give 4", () => {
  const [metrics] = measureClasses(COUPLED);
  assertEquals(metrics.cbo, 4);
});

Deno.test("cbo-names: a namespace-qualified type counts by its full name", () => {
  assertEquals(measureClasses(QUALIFIED)[0].cbo, 2);
});
