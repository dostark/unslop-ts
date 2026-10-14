/**
 * @module TestAssertionRulesTest
 * @path packages/lint-rules/tests/test_assertion_rules_test.ts
 * @description Rule-level tests for the test-assertion quality rules (deslop / anti-slop, MIT).
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/test_assertion_rules.ts]
 */

import { assertEquals } from "@std/assert";
import { createLintPlugin, type JsonValue, parseCatalog, runPlugin } from "@exaix/lint-rules";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

const RULE_ID = "exaix/no-boolean-assert";
const PROD = "packages/x/src/a.ts";
const TEST = "packages/x/tests/a_test.ts";

function buildCatalog(overrides: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      "test-quality": { description: "Rules on test code.", requiresScope: ["test"] },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      [RULE_ID]: {
        engine: "plugin",
        severity: "error",
        scope: "test",
        tags: ["test-quality", "deslop"],
        ...overrides,
      },
    },
  };
}

function reports(source: string, filename = TEST, overrides: Record<string, JsonValue> = {}): boolean {
  const plugin = createLintPlugin("exaix", parseCatalog(buildCatalog(overrides)));
  return runPlugin(plugin, filename, source).length > 0;
}

Deno.test("no-boolean-assert reports assertEquals(x.includes(y), true)", () => {
  assertEquals(reports('assertEquals("abc".includes("b"), true);'), true);
});

Deno.test("no-boolean-assert reports even with a message argument", () => {
  assertEquals(reports('assertEquals("abc".includes("b"), true, "msg");'), true);
});

Deno.test("no-boolean-assert reports a bare assert(x.includes(y))", () => {
  assertEquals(reports('assert("abc".includes("b"));'), true);
});

Deno.test("no-boolean-assert reports startsWith and endsWith", () => {
  assertEquals(reports('assertEquals("abc".startsWith("a"), false);'), true);
  assertEquals(reports('assertEquals("abc".endsWith("c"), false);'), true);
});

Deno.test("no-boolean-assert accepts a non-boolean assertion", () => {
  assertEquals(reports('assertEquals("abc", actual);'), false);
});

Deno.test("no-boolean-assert is not checked in a production file", () => {
  assertEquals(reports('assertEquals("abc".includes("b"), true);', PROD), false);
});

Deno.test("no-boolean-assert methods option adds a method", () => {
  assertEquals(reports("assertEquals(set.has(x), true);"), false);
  assertEquals(reports("assertEquals(set.has(x), true);", TEST, { options: { methods: ["includes", "has"] } }), true);
});
