/**
 * @module MaxCognitiveComplexityTest
 * @path tests/max_cognitive_complexity_test.ts
 * @description Golden values for the cognitive-complexity core and its rule on the Deno host.
 * @architectural-layer Test
 * @related-files [src/rules/max_cognitive_complexity.ts, src/metrics/cognitive.ts]
 */

import { assert, assertEquals } from "@std/assert";
import type { JsonValue } from "../mod.ts";
import { runPlugin } from "../deno.ts";
import type { IMetricOptions } from "../src/metrics/types.ts";
import { measureAll } from "./helpers/measurement.ts";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*.test.ts"],
  fixture: ["**/tests/fixtures/**"],
};
const PROD = "packages/x/src/a.ts";
const COUNTING: IMetricOptions = { variant: "extended", countNullish: true };
const NO_NULLISH: IMetricOptions = { variant: "extended", countNullish: false };

function buildCatalog(options: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      complexity: { description: "Function size limits." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      "demo/max-cognitive-complexity": {
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
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source).map((d) => d.message);
}

/** The cognitive value of the only function unit in the source. */
function cognitiveOf(source: string, options: IMetricOptions = COUNTING): number {
  return measureAll(source, options)[0].cognitive;
}

const PAPER_NESTING = "function nesting(a, b, c, d) {\n" +
  "  if (a) {\n" +
  "    if (b) {\n" +
  "    }\n" +
  "  } else if (c) {\n" +
  "    if (d) {\n" +
  "    }\n" +
  "  }\n" +
  "}";

const FIVE_CASES = "function classify(n) {\n" +
  "  switch (n) {\n" +
  "    case 1: return 1;\n" +
  "    case 2: return 2;\n" +
  "    case 3: return 3;\n" +
  "    case 4: return 4;\n" +
  "    default: return 0;\n" +
  "  }\n" +
  "}";

const DEEP_NESTING = "function deep(a, b, c) {\n" +
  "  if (a) {\n" +
  "    if (b) {\n" +
  "      if (c) {\n" +
  "      }\n" +
  "    }\n" +
  "  }\n" +
  "}";

Deno.test("cognitive-paper-examples: paper totals hold, with the nullish extension as a named deviation", () => {
  assertEquals(cognitiveOf(PAPER_NESTING), 6);
  assertEquals(cognitiveOf(FIVE_CASES), 1);
  assertEquals(cognitiveOf("function f(a) { return a ?? 0; }"), 1);
  assertEquals(cognitiveOf("function f(a) { return a ?? 0; }", NO_NULLISH), 0);
  assertEquals(cognitiveOf("function f(a, b, c) { return a && b && c; }"), 1);
  assertEquals(cognitiveOf("function f(a, b, c) { return a || b && c; }"), 2);
  assertEquals(cognitiveOf("function f(a, b, c, d) { return a && b || c && d; }"), 3);
});

Deno.test("cognitive-nesting: depths zero to two add one, two and three", () => {
  const metrics = measureAll(DEEP_NESTING)[0];
  assertEquals(metrics.cognitive, 6);
  const structural = metrics.contributions.filter((entry) => entry.metric === "cognitive");
  assertEquals(structural.map((entry) => entry.kind), ["if", "if", "if"]);
  assertEquals(structural.map((entry) => entry.weight), [1, 2, 3]);
  assertEquals(structural.map((entry) => entry.nesting), [0, 1, 2]);
});

Deno.test("cognitive-switch-once: five cases cause one switch increment", () => {
  const metrics = measureAll(FIVE_CASES)[0];
  assertEquals(metrics.cognitive, 1);
  assertEquals(metrics.contributions.filter((entry) => entry.kind === "switch").length, 1);
  assertEquals(
    metrics.contributions.some((entry) => entry.metric === "cognitive" && entry.kind === "case"),
    false,
  );
});

Deno.test("cognitive-logical-sequences: like and mixed runs keep their boundaries", () => {
  const single = "function f(a, b, c) { return a && b && c; }";
  assertEquals(
    measureAll(single)[0].contributions.filter((entry) => entry.metric === "cognitive").length,
    1,
  );
  const mixed = "function f(a, b, c, d) { return a && b || c && d; }";
  assertEquals(
    measureAll(mixed)[0].contributions.filter((entry) => entry.metric === "cognitive").map((entry) => entry.kind),
    ["logical-and", "logical-or", "logical-and"],
  );
  const parenthesized = "function f(a, b, c) { return (a && b) && c; }";
  assertEquals(cognitiveOf(parenthesized), 1);
  const nullish = "function f(a, b) { return (a && b) ?? (a && b); }";
  assertEquals(
    measureAll(nullish, COUNTING)[0].contributions.filter((entry) => entry.metric === "cognitive").length,
    3,
  );
  assertEquals(
    measureAll(nullish, NO_NULLISH)[0].contributions.filter((entry) => entry.metric === "cognitive").length,
    2,
  );
});

Deno.test("cognitive-jumps-and-recursion: labeled jump, single recursion, and excluded calls", () => {
  const labeled = "function f(items) {\n" +
    "  let total = 0;\n" +
    "  outer: for (const item of items) {\n" +
    "    if (item < 0) continue outer;\n" +
    "    total += item;\n" +
    "  }\n" +
    "  return total;\n" +
    "}";
  assertEquals(cognitiveOf(labeled), 4);
  const jumps = measureAll(labeled)[0].contributions.filter((entry) => entry.kind === "labeled-jump");
  assertEquals(jumps.length, 1);
  assertEquals(jumps[0].weight, 1);
  assertEquals(cognitiveOf("function f(items) { for (const item of items) { break; } }"), 1);
  assertEquals(cognitiveOf("function f(n) { f(); f(); return n; }"), 1);
  assertEquals(cognitiveOf("function f(obj) { return obj.f(); }"), 0);
  assertEquals(cognitiveOf("function f(f) { return f(); }"), 0);
  assertEquals(cognitiveOf("const fib = (n) => n < 2 ? n : fib(n - 1) + fib(n - 2);"), 2);
});

Deno.test("cognitive-shadowed-declaration: nested declarations and catch bindings are not self-recursion", () => {
  assertEquals(cognitiveOf("function f() {\n  function f() {}\n  return f();\n}"), 0);
  assertEquals(cognitiveOf("function f() {\n  class f {}\n  return f;\n}"), 0);
  assertEquals(cognitiveOf("function f() {\n  try {\n    throw 1;\n  } catch (f) {\n    f();\n  }\n}"), 1);
  assertEquals(cognitiveOf("function f() {\n  try {\n    throw 1;\n  } catch ({ f }) {\n    f();\n  }\n}"), 1);
  assertEquals(cognitiveOf("const g = () => {\n  function g() {}\n  return g();\n};"), 0);
  assertEquals(cognitiveOf("function f() {\n  const g = function f() {};\n  return f();\n}"), 1);
  assertEquals(cognitiveOf("function f() {\n  return f();\n}"), 1);
});

Deno.test("cognitive-nested-function: callbacks score alone and the parent excludes them", () => {
  const source = "function outer(a) {\n" +
    "  const top = (x) => { if (x) { return 1; } return 0; };\n" +
    "  if (a) {\n" +
    "    const inner = (x) => { if (x) { return 1; } return 0; };\n" +
    "    if (a) { return 1; }\n" +
    "    return inner(true) + top(true);\n" +
    "  }\n" +
    "  return 0;\n" +
    "}";
  const metrics = measureAll(source);
  assertEquals(metrics.map((entry) => entry.name), ["outer", "top", "inner"]);
  assertEquals(metrics.map((entry) => entry.cognitive), [3, 1, 1]);
});

Deno.test("cognitive-rule-message: the reported value matches the core and the ranking grammar", () => {
  const nested = "function run(a) { if (a) { if (a) { return 1; } } return 0; }";
  assertEquals(cognitiveOf(nested), 3);
  const found = messages(nested, { max: 2 });
  assertEquals(found, ["Function run has cognitive complexity 3 (limit 2)."]);

  const nullish = "function run(a) { if (a) { return a ?? 0; } return 0; }";
  assertEquals(cognitiveOf(nullish), 2);
  assertEquals(messages(nullish, { max: 1 }).length, 1);
  assertEquals(messages(nullish, { max: 1, countNullish: false }), []);
  assert(messages(nested, { max: 2 })[0].includes("Function run has cognitive complexity 3 (limit 2)."));
});
