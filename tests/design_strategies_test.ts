/**
 * @module DesignStrategiesTest
 * @path tests/design_strategies_test.ts
 * @description God Class, Data Class and Feature Envy over the class pass, each finding carrying the metric values that matched.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/report/design_strategies.ts, src/report/class_pass.ts, tests/helpers/god_class_fixture.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { IClassMetrics } from "../src/metrics/types.ts";
import type { IPassClass } from "../src/report/class_pass.ts";
import { designFindingsOf } from "../src/report/design_strategies.ts";
import { passOver } from "./helpers/class_pass_repo.ts";
import { GOD, godClassSource, godFindings } from "./helpers/god_class_fixture.ts";

const BASE: IClassMetrics = {
  name: "Subject",
  line: 1,
  nom: 4,
  wmc: 4,
  loc: 20,
  noa: 6,
  tcc: 0.5,
  lcom4: 1,
  atfd: 0,
  cbo: 0,
  rfc: 4,
  dit: 0,
  noc: 0,
  woc: 0.2,
  noap: 6,
  noam: 0,
  precision: "typed",
};

function passClass(overrides: Partial<IClassMetrics>): IPassClass {
  return {
    path: "packages/p/src/subject.ts",
    name: "Subject",
    nameOffset: 0,
    metrics: { ...BASE, ...overrides },
    methods: [],
  };
}

function strategiesOf(classes: readonly IPassClass[]): string[] {
  return designFindingsOf(classes).map((finding) => `${finding.strategy}:${finding.methodName ?? finding.className}`);
}

Deno.test("data-class: a class with WOC 0.2, six public fields and WMC 4 is a data class, and WOC 0.5 is not", () => {
  const found = designFindingsOf([passClass({})]);
  assertEquals(found.map((finding) => finding.strategy), ["data-class"]);
  assertEquals(found[0].metrics.woc, 0.2);
  assertEquals([found[0].metrics.noap, found[0].metrics.noam, found[0].metrics.wmc], [6, 0, 4]);
  assertEquals(strategiesOf([passClass({ woc: 0.5 })]), []);
});

Deno.test("data-class: the second branch needs more than eight members and a WMC below very high", () => {
  assertEquals(strategiesOf([passClass({ noap: 9, wmc: 40 })]), ["data-class:Subject"]);
  assertEquals(strategiesOf([passClass({ noap: 6, wmc: 40 })]), []);
  assertEquals(strategiesOf([passClass({ noap: 9, wmc: 47 })]), []);
  assertEquals(strategiesOf([passClass({ woc: null })]), []);
});

const FIELDS = ["a", "b", "c", "d", "e", "f"];
const OTHER = `export class Other {\n${FIELDS.map((name) => `  ${name} = 0;`).join("\n")}\n}\n`;
const ENVY = [
  'import { Other } from "./other.ts";',
  "export class Envy {",
  "  own = 0;",
  "  grab(o: Other): number {",
  `    return this.own + ${FIELDS.map((name) => `o.${name}`).join(" + ")};`,
  "  }",
  "  calm(): number {",
  "    return this.own;",
  "  }",
  "}",
  "",
].join("\n");

Deno.test("feature-envy: a method that reads six attributes of one other class and one of its own is envious", async () => {
  const result = await passOver({ "other.ts": OTHER, "envy.ts": ENVY });
  const envious = designFindingsOf(result.classes).filter((finding) => finding.strategy === "feature-envy");
  assertEquals(envious.map((finding) => [finding.className, finding.methodName]), [["Envy", "grab"]]);
  assertEquals([envious[0].metrics.atfd, envious[0].metrics.fdp], [6, 1]);
  assertEquals(envious[0].metrics.laa, 1 / 7);
});

Deno.test("feature-envy: a method that reads the data of six classes is not envious, because FDP exceeds the limit", async () => {
  const providers = FIELDS.map((name) => `export class P${name} {\n  v = 0;\n}\n`);
  const files: Record<string, string> = {};
  FIELDS.forEach((name, index) => files[`p${name}.ts`] = providers[index]);
  const imports = FIELDS.map((name) => `import { P${name} } from "./p${name}.ts";`);
  const parameters = FIELDS.map((name) => `${name}: P${name}`).join(", ");
  const reads = FIELDS.map((name) => `${name}.v`).join(" + ");
  files["spread.ts"] = `${
    imports.join("\n")
  }\nexport class Spread {\n  gather(${parameters}): number {\n    return ${reads};\n  }\n}\n`;
  const result = await passOver(files);
  assertEquals(designFindingsOf(result.classes).filter((finding) => finding.strategy === "feature-envy"), []);
});

Deno.test("god-class-typed: the typed God Class matches the rule on a fixture where both precisions agree", async () => {
  const hubFields = Array.from({ length: GOD.foreignReads }, (_, index) => `  field${index} = 0;`);
  const other = `export class Other {\n${hubFields.join("\n")}\n}\n`;
  const hub = `import { Other } from "./other.ts";\n${godClassSource(GOD).replace("class Hub", "export class Hub")}`;
  const result = await passOver({ "other.ts": other, "hub.ts": hub });
  const typed = designFindingsOf(result.classes).filter((finding) => finding.strategy === "god-class");
  assertEquals(typed.length, 1);
  assertEquals([typed[0].metrics.wmc, typed[0].metrics.tcc, typed[0].metrics.atfd], [50, 0.2, 6]);
  const rule = godFindings(godClassSource(GOD));
  assertEquals(rule.length, 1);
  assertStringIncludes(rule[0].message, "WMC 50 >= 47, TCC 0.20 < 0.33, ATFD 6 > 5");
});
