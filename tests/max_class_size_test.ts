/**
 * @module MaxClassSizeTest
 * @path tests/max_class_size_test.ts
 * @description Rule-level tests for demo/max-class-size (ported from check_god_objects.ts).
 * @architectural-layer Test
 * @related-files [src/rules/max_class_size.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { JsonValue } from "../mod.ts";
import { GOD, godClassSource, godFindings } from "./helpers/god_class_fixture.ts";

/** Runs the rule under the legacy score unless a test names another strategy. */
function findings(source: string, options: Record<string, JsonValue> = {}) {
  return godFindings(source, { strategy: "legacy-score", ...options });
}

function classSource(methodCount: number): string {
  const methods = Array.from({ length: methodCount }, (_, index) => `  m${index}(): number {\n    return 1;\n  }`);
  return `class Big {\n${methods.join("\n")}\n}\n`;
}

Deno.test("max-class-size does not report a class under minClassLines", () => {
  assertEquals(findings(classSource(5)).length, 0);
});

Deno.test("max-class-size reports a class above the score threshold", () => {
  const found = findings(classSource(5), { minClassLines: 1, threshold: 1 });
  assertEquals(found.length, 1);
});

Deno.test("max-class-size reports the score and the method count in the message", () => {
  const found = findings(classSource(5), { minClassLines: 1, threshold: 1 });
  assertStringIncludes(found[0].message, "score");
  assertStringIncludes(found[0].message, "5 methods");
});

Deno.test("max-class-size accepts a class below the score threshold", () => {
  assertEquals(findings(classSource(5), { minClassLines: 1, threshold: 1000 }).length, 0);
});

Deno.test("max-class-size raises the score as the method count grows", () => {
  const small = findings(classSource(4), { minClassLines: 1, threshold: 1 });
  const large = findings(classSource(12), { minClassLines: 1, threshold: 1 });
  const smallScore = Number(small[0].message.match(/score (\d+)/)?.[1]);
  const largeScore = Number(large[0].message.match(/score (\d+)/)?.[1]);
  assertEquals(largeScore > smallScore, true);
});

Deno.test("class-legacy-message: the legacy score is unchanged and the message carries WMC, TCC and LCOM4", () => {
  const found = findings(classSource(5), { minClassLines: 1, threshold: 1 });
  assertEquals(found.length, 1);
  assertEquals(
    /^Class Big score \d+ \(limit 1; 5 methods, \d+ lines; WMC 5, TCC 0\.00, LCOM4 5\)\.$/.test(found[0].message),
    true,
  );
  const single = findings("class One {\n  only(): number {\n    return 1;\n  }\n}\n", {
    minClassLines: 1,
    threshold: 0,
  });
  assertStringIncludes(single[0].message, "TCC n/a");
});

Deno.test("class-legacy-message: the wmcVariant option changes the WMC in the message", () => {
  const source =
    "class Reader {\n  read(box?: { value: number }): number | undefined {\n    return box?.value;\n  }\n}\n";
  const classic = findings(source, { minClassLines: 1, threshold: 0 });
  const extended = findings(source, { minClassLines: 1, threshold: 0, wmcVariant: "extended" });
  assertStringIncludes(classic[0].message, "WMC 1,");
  assertStringIncludes(extended[0].message, "WMC 2,");
});

Deno.test("god-class-all-three: a class with WMC 50, TCC 0.2 and ATFD 6 is reported with the three values", () => {
  const found = godFindings(godClassSource(GOD));
  assertEquals(found.length, 1);
  assertEquals(found[0].message, "Class Hub is a god class (WMC 50 >= 47, TCC 0.20 < 0.33, ATFD 6 > 5).");
});

Deno.test("god-class-one-missing: dropping any one condition stops the report", () => {
  const lowWmc = godClassSource({ ...GOD, branches: 3 });
  const highTcc = godClassSource({ ...GOD, cohesion: "shared" });
  const lowAtfd = godClassSource({ ...GOD, foreignReads: 5 });
  for (const source of [lowWmc, highTcc, lowAtfd]) assertEquals(godFindings(source).length, 0, source);
});

Deno.test("god-class-one-missing: the limit options move each boundary", () => {
  assertEquals(godFindings(godClassSource({ ...GOD, branches: 3 }), { wmcVeryHigh: 40 }).length, 1);
  assertEquals(godFindings(godClassSource({ ...GOD, cohesion: "shared" }), { tccLimit: 1 }).length, 0);
  assertEquals(godFindings(godClassSource({ ...GOD, foreignReads: 5 }), { atfdFew: 4 }).length, 1);
});

Deno.test("god-class-null-tcc: a class with one visible method is not reported", () => {
  const body = Array.from({ length: 50 }, (_, step) => `    if (n > ${step}) n++;`).join("\n");
  const reads = Array.from({ length: 6 }, (_, index) => `    n += other.field${index};`).join("\n");
  const source =
    `class Solo {\n  only(other: Other): number {\n    let n = 0;\n${body}\n${reads}\n    return n;\n  }\n}\n`;
  assertEquals(godFindings(source).length, 0);
});

Deno.test("god-class-all-three: the legacy minimum line count and threshold do not apply", () => {
  const found = godFindings(godClassSource(GOD), { minClassLines: 10_000, threshold: 100_000 });
  assertEquals(found.length, 1);
});

Deno.test("legacy-score-unchanged: the legacy strategy reports a small class that the god-class strategy ignores", () => {
  const found = godFindings(classSource(5), { strategy: "legacy-score", minClassLines: 1, threshold: 1 });
  assertEquals(found.length, 1);
  assertEquals(godFindings(classSource(5), { strategy: "god-class" }).length, 0);
});

Deno.test("god-class-named-expression: declarations and named expressions produce the same diagnostic", () => {
  const declaration = godClassSource(GOD);
  const expression = `const makeHub = ${declaration};`;
  assertEquals(godFindings(declaration).map((finding) => finding.message), [
    "Class Hub is a god class (WMC 50 >= 47, TCC 0.20 < 0.33, ATFD 6 > 5).",
  ]);
  assertEquals(
    godFindings(expression).map((finding) => finding.message),
    godFindings(declaration).map((finding) => finding.message),
  );
  assertEquals(findings(expression, { minClassLines: 1, threshold: 1 }), []);
});

Deno.test("god-class-expression-negative: a named expression missing each condition passes", () => {
  for (const spec of [{ ...GOD, branches: 3 }, { ...GOD, cohesion: "shared" as const }, { ...GOD, foreignReads: 5 }]) {
    assertEquals(godFindings(`const makeHub = ${godClassSource(spec)};`), []);
  }
});
