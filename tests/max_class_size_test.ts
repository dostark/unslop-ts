/**
 * @module MaxClassSizeTest
 * @path packages/lint-rules/tests/max_class_size_test.ts
 * @description Rule-level tests for exaix/max-class-size (ported from check_god_objects.ts).
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/max_class_size.ts]
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "@exaix/lint-rules";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

const RULE_ID = "exaix/max-class-size";
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
