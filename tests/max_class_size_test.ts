/**
 * @module MaxClassSizeTest
 * @path tests/max_class_size_test.ts
 * @description Rule-level tests for demo/max-class-size (ported from check_god_objects.ts).
 * @architectural-layer Test
 * @related-files [src/rules/max_class_size.ts]
 */

import { assertEquals } from "@std/assert";
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

function findings(source: string, options: Record<string, JsonValue> = {}) {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source);
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
  assertEquals(found[0].message.includes("score"), true);
  assertEquals(found[0].message.includes("5 methods"), true);
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
  assertEquals(single[0].message.includes("TCC n/a"), true);
});

Deno.test("class-legacy-message: the wmcVariant option changes the WMC in the message", () => {
  const source =
    "class Reader {\n  read(box?: { value: number }): number | undefined {\n    return box?.value;\n  }\n}\n";
  const classic = findings(source, { minClassLines: 1, threshold: 0 });
  const extended = findings(source, { minClassLines: 1, threshold: 0, wmcVariant: "extended" });
  assertEquals(classic[0].message.includes("WMC 1,"), true);
  assertEquals(extended[0].message.includes("WMC 2,"), true);
});
