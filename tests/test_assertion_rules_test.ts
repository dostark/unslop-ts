/**
 * @module TestAssertionRulesTest
 * @path packages/lint-rules/tests/test_assertion_rules_test.ts
 * @description Rule-level tests for the test-assertion quality rules (deslop / anti-slop, MIT).
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/test_assertion_rules.ts]
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "@exaix/lint-rules";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

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
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(overrides)));
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

const REPEATED_RULE = "exaix/no-repeated-assert-call";
const SUBSTRING_RULE = "exaix/no-constant-substring-assert";

function buildRuleCatalog(id: string, overrides: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      "test-quality": { description: "Rules on test code.", requiresScope: ["test"] },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      [id]: {
        engine: "plugin",
        severity: "error",
        scope: "test",
        tags: ["test-quality", "deslop"],
        ...overrides,
      },
    },
  };
}

function reportsWith(
  id: string,
  source: string,
  filename = TEST,
  overrides: Record<string, JsonValue> = {},
): boolean {
  const plugin = createTestPlugin(loadTestCatalog(buildRuleCatalog(id, overrides)));
  return runPlugin(plugin, filename, source).length > 0;
}

function inBlock(body: string): string {
  return `Deno.test("t", () => {\n${body}\n});\n`;
}

Deno.test("no-repeated-assert-call reports two adjacent assertions on the same call", () => {
  const source = inBlock("assertEquals(f(x), 1);\nassertEquals(f(x), 2);");
  assertEquals(reportsWith(REPEATED_RULE, source), true);
});

Deno.test("no-repeated-assert-call accepts a different first argument", () => {
  const source = inBlock("assertEquals(f(x), 1);\nassertEquals(f(y), 2);");
  assertEquals(reportsWith(REPEATED_RULE, source), false);
});

Deno.test("no-repeated-assert-call accepts the same call when not adjacent", () => {
  const source = inBlock("assertEquals(f(x), 1);\nconst y = 1;\nassertEquals(f(x), 2);");
  assertEquals(reportsWith(REPEATED_RULE, source), false);
});

Deno.test("no-repeated-assert-call compares the call text after normalizing whitespace", () => {
  const source = inBlock("assertEquals(f(x), 1);\nassertEquals(f( x ), 2);");
  assertEquals(reportsWith(REPEATED_RULE, source), true);
});

Deno.test("no-repeated-assert-call accepts the same call in two separate tests", () => {
  const source = `Deno.test("a", () => {\n  assertEquals(f(x), 1);\n});\n` +
    `Deno.test("b", () => {\n  assertEquals(f(x), 1);\n});\n`;
  assertEquals(reportsWith(REPEATED_RULE, source), false);
});

Deno.test("no-repeated-assert-call assertPrefix option accepts a custom prefix", () => {
  const source = inBlock("checkThing(f(x), 1);\ncheckThing(f(x), 2);");
  assertEquals(reportsWith(REPEATED_RULE, source), false);
  assertEquals(reportsWith(REPEATED_RULE, source, TEST, { options: { assertPrefix: "check" } }), true);
});

Deno.test("no-repeated-assert-call is not checked in a production file", () => {
  const source = inBlock("assertEquals(f(x), 1);\nassertEquals(f(x), 2);");
  assertEquals(reportsWith(REPEATED_RULE, source, PROD), false);
});

Deno.test("no-constant-substring-assert reports a substring assertion on an imported constant", () => {
  const source = `import { THINGS } from "./t.ts";\n${inBlock('assert(THINGS.includes("X"));')}`;
  assertEquals(reportsWith(SUBSTRING_RULE, source), true);
});

Deno.test("no-constant-substring-assert accepts a name that is not imported", () => {
  const source = inBlock('assert(THINGS.includes("X"));');
  assertEquals(reportsWith(SUBSTRING_RULE, source), false);
});

Deno.test("no-constant-substring-assert accepts an imported name that is not a constant", () => {
  const source = `import { things } from "./t.ts";\n${inBlock('assert(things.includes("X"));')}`;
  assertEquals(reportsWith(SUBSTRING_RULE, source), false);
});

Deno.test("no-constant-substring-assert reports assertStringIncludes on an imported constant", () => {
  const source = `import { THINGS } from "./t.ts";\n${inBlock('assertStringIncludes(THINGS, "X");')}`;
  assertEquals(reportsWith(SUBSTRING_RULE, source), true);
});

Deno.test("no-constant-substring-assert accepts a non-substring assertion on an imported constant", () => {
  const source = `import { THINGS } from "./t.ts";\n${inBlock("assertEquals(THINGS, []);")}`;
  assertEquals(reportsWith(SUBSTRING_RULE, source), false);
});

Deno.test("no-constant-substring-assert constantPattern option accepts a custom pattern", () => {
  const source = `import { things } from "./t.ts";\n${inBlock('assert(things.includes("X"));')}`;
  assertEquals(reportsWith(SUBSTRING_RULE, source), false);
  assertEquals(reportsWith(SUBSTRING_RULE, source, TEST, { options: { constantPattern: "^things$" } }), true);
});
