/**
 * @module ClassStatisticsTest
 * @path tests/class_statistics_test.ts
 * @description The statistical bands that the health report derives for each class metric from the walked classes.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/class_statistics.ts, src/report/class_pass.ts]
 */

import { assertEquals } from "@std/assert";
import type { IClassMetrics } from "../src/metrics/types.ts";
import type { IPassClass } from "../src/report/class_pass.ts";
import { bandsOf, derivedThresholdsOf } from "../src/report/class_statistics.ts";

const KNOWN_WMC = [2, 4, 4, 4, 5, 5, 7, 9];

function passClass(name: string, wmc: number, nom: number): IPassClass {
  const metrics: IClassMetrics = {
    name,
    line: 1,
    nom,
    wmc,
    loc: 10,
    noa: 0,
    tcc: null,
    lcom4: 1,
    atfd: 0,
    cbo: 0,
    rfc: null,
    dit: null,
    noc: null,
    woc: null,
    noap: 0,
    noam: 0,
    precision: "typed",
  };
  return { path: "a.ts", name, nameOffset: 0, metrics, methods: [] };
}

Deno.test("health-derived-thresholds: known WMC values give the mean, standard deviation and the four bands", () => {
  const bands = bandsOf(KNOWN_WMC);
  assertEquals(bands, { mean: 5, sd: 2, low: 3, average: 5, high: 7, very_high: 10.5 });
});

Deno.test("health-derived-thresholds: the low band never goes below zero and an empty population has no bands", () => {
  assertEquals(bandsOf([0, 0, 10])?.low, 0);
  assertEquals(bandsOf([]), null);
});

Deno.test("health-derived-thresholds: only classes with at least one method take part", () => {
  const derived = derivedThresholdsOf([passClass("A", 2, 1), passClass("B", 4, 2), passClass("Empty", 99, 0)]);
  assertEquals(derived.population, 2);
  assertEquals(derived.metrics.wmc?.mean, 3);
});
