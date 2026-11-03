/**
 * @module MaxClassSizeTest
 * @path tests/max_class_size_test.ts
 * @description Rule-level tests for demo/max-class-size (ported from check_god_objects.ts).
 * @architectural-layer Test
 * @related-files [src/rules/max_class_size.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { JsonValue } from "../mod.ts";
import { runPlugin } from "../deno.ts";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

const RULE_ID = "demo/max-class-size";
const PROD = "packages/x/src/a.ts";

function buildCatalog(options: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: {
      test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
      fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
    },
    tagVocabulary: {
      complexity: { description: "Rules on code complexity." },
      "module-structure": { description: "Rules on module and type structure." },
    },
    rules: {
      [RULE_ID]: {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["complexity", "module-structure"],
        options,
      },
    },
  };
}

/** Runs the rule with the options as given, so the default strategy applies. */
function godFindings(source: string, options: Record<string, JsonValue> = {}) {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source);
}

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

interface IGodSpec {
  readonly methods: number;
  readonly branches: number;
  readonly foreignReads: number;
  readonly cohesion: "grouped" | "shared";
}

/** A class whose WMC, TCC and ATFD follow the spec: grouped gives TCC 0.2 for ten methods, shared gives 1. */
function godClassSource(spec: IGodSpec): string {
  const attributeOf = (index: number): string => {
    if (spec.cohesion === "shared") return "shared";
    if (index < 4) return "groupA";
    return index < 7 ? "groupB" : `solo${index}`;
  };
  const names = new Set(Array.from({ length: spec.methods }, (_, index) => attributeOf(index)));
  const lines = ["class Hub {", ...[...names].map((name) => `  private ${name} = 0;`)];
  for (let index = 0; index < spec.methods; index++) {
    const branches = Array.from({ length: spec.branches }, (_, step) => `    if (n > ${step}) n++;`);
    const foreign = index < spec.foreignReads ? [`    n += other.field${index};`] : [];
    lines.push(
      `  run${index}(other: Other): number {`,
      `    let n = this.${attributeOf(index)};`,
      ...branches,
      ...foreign,
    );
    lines.push("    return n;", "  }");
  }
  return `${lines.join("\n")}\n}\n`;
}

const GOD: IGodSpec = { methods: 10, branches: 4, foreignReads: 6, cohesion: "grouped" };

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
