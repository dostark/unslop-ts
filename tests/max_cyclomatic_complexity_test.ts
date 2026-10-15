/**
 * @module MaxCyclomaticComplexityTest
 * @path packages/lint-rules/tests/max_cyclomatic_complexity_test.ts
 * @description Golden-value parity for the ESTree cyclomatic-complexity rule.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/max_cyclomatic_complexity.ts, tests/scripts/rule_ceiling_ratchet_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { createLintPlugin, type JsonValue, parseCatalog, runPlugin } from "@exaix/lint-rules";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

const PROD = "packages/x/src/a.ts";

function buildCatalog(options: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      complexity: { description: "Function size limits." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      "exaix/max-cyclomatic-complexity": {
        engine: "plugin",
        severity: "error",
        scope: "prod",
        tags: ["complexity", "deslop"],
        options,
      },
    },
  };
}

function messages(source: string, options: Record<string, JsonValue> = {}): string[] {
  const plugin = createLintPlugin("exaix", parseCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source).map((d) => d.message);
}

const ALPHA = "function alpha(x: number): number {\n" +
  "  if (x > 0) return x;\n" +
  "  for (let i = 0; i < x; i++) {\n" +
  "    if (i % 2 === 0) continue;\n" +
  "  }\n" +
  "  return x && 1 ? x : 0;\n" +
  "}";

Deno.test("the golden alpha snippet reports complexity 6", () => {
  const found = messages(ALPHA, { max: 1 });
  assertEquals(found.length, 1);
  assert(found[0].includes("alpha"), found[0]);
  assert(found[0].includes("6"), found[0]);
});

Deno.test("a simple function is not reported under the default max", () => {
  assertEquals(messages("function f(): number {\n  return 1;\n}"), []);
});

Deno.test("a logical expression and a ternary each add one", () => {
  assertEquals(messages("function f(a: boolean): number {\n  return a && true ? 1 : 2;\n}", { max: 1 }).length, 1);
});

Deno.test("a default switch case adds no decision, matching the old gate", () => {
  const source = "function f(a: number): number {\n  switch (a) {\n    default:\n      return 0;\n  }\n}";
  assertEquals(messages(source, { max: 1 }), []);
});

Deno.test("a nullish-coalescing expression adds no decision, matching the old gate", () => {
  assertEquals(messages("function f(a: number | null): number {\n  return a ?? 0;\n}", { max: 1 }), []);
});

Deno.test("a nested arrow body does not add to the outer function, matching the old gate", () => {
  const source = "function component(items: string[]): string[] {\n  return items.map((i) => i);\n}";
  assertEquals(messages(source, { max: 1 }), []);
});

Deno.test("a class method body counts its own decisions (golden run() value 2)", () => {
  const source = "class Service {\n  ready = false;\n  run(): void {\n    if (this.ready) return;\n  }\n}";
  const found = messages(source, { max: 1 });
  assertEquals(found.length, 1);
  assert(found[0].includes("2"), found[0]);
});
