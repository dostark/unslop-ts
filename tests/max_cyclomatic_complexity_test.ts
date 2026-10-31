/**
 * @module MaxCyclomaticComplexityTest
 * @path tests/max_cyclomatic_complexity_test.ts
 * @description Golden-value parity for the ESTree cyclomatic-complexity rule and its metric core.
 * @architectural-layer Test
 * @related-files [src/rules/max_cyclomatic_complexity.ts, src/metrics/function_metrics.ts]
 */

import { assert, assertEquals } from "@std/assert";
import type { JsonValue } from "../mod.ts";
import { runPlugin } from "../deno.ts";
import { CLASSIC_OPTIONS, measureAll, positionOf } from "./helpers/measurement.ts";
import {
  createTestPlugin,
  loadTestCatalog,
  singleRuleCatalog,
  STANDARD_TEST_SCOPES as TEST_SCOPES,
} from "./helpers/registry.ts";

const PROD = "packages/x/src/a.ts";

function buildCatalog(options: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return singleRuleCatalog("max-cyclomatic-complexity", options, TEST_SCOPES, "complexity", "prod");
}

function messages(source: string, options: Record<string, JsonValue> = {}): string[] {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source).map((d) => d.message);
}

const ALPHA = "function alpha(x: number): number {\n" +
  "  if (x > 0) return x;\n" +
  "  for (let i = 0; i < x; i++) {\n" +
  "    if (i % 2 === 0) continue;\n" +
  "  }\n" +
  "  return x && 1 ? x : 0;\n" +
  "}";

const WIDE = "function wide(a: number | null, b: boolean): number {\n" +
  "  const first = a ?? 0;\n" +
  "  const second = a?.toString()?.length ?? 0;\n" +
  "  let acc = first;\n" +
  "  acc &&= second;\n" +
  "  acc ||= first;\n" +
  "  acc ??= second;\n" +
  "  return b && first > 0 ? acc : 0;\n" +
  "}";

const NESTED = "function outer(a: boolean): number {\n" +
  "  const inner = (b: boolean): number => {\n" +
  "    if (b) return 1;\n" +
  "    return 0;\n" +
  "  };\n" +
  "  if (a) return inner(true);\n" +
  "  return 0;\n" +
  "}";

const CONTRIBUTIONS = "function sample(a: boolean, b: number | null, c?: string): number {\n" +
  "  if (a) {\n" +
  "    return b ?? 0;\n" +
  "  } else if (c?.length) {\n" +
  "    return 1;\n" +
  "  }\n" +
  "  return a && b ? 2 : 3;\n" +
  "}";

Deno.test("cyclomatic-golden-classic: the golden alpha snippet keeps complexity 6 under classic", () => {
  const found = messages(ALPHA, { max: 1, variant: "classic" });
  assertEquals(found.length, 1);
  assert(found[0].includes("alpha"), found[0]);
  assert(found[0].includes("6"), found[0]);
  assertEquals(measureAll(ALPHA, CLASSIC_OPTIONS)[0].cyclomatic, 6);
});

Deno.test("cyclomatic-extended-constructs: every extended construct adds one and classic skips it", () => {
  assertEquals(measureAll(WIDE)[0].cyclomatic, 10);
  assertEquals(measureAll(WIDE, CLASSIC_OPTIONS)[0].cyclomatic, 3);
  const extended = messages(WIDE, { max: 1 });
  assertEquals(extended.length, 1);
  assert(extended[0].includes("wide"), extended[0]);
  assert(extended[0].includes("10"), extended[0]);
  assert(messages(WIDE, { max: 1, variant: "classic" })[0].includes("3"));
});

Deno.test("cyclomatic-extended-constructs: each extended-only construct is counted on its own", () => {
  const cases: readonly { readonly source: string; readonly extended: number }[] = [
    { source: "function f(a: number | null): number {\n  return a ?? 0;\n}", extended: 2 },
    { source: "function f(a?: string): number {\n  return a?.length ?? 0;\n}", extended: 3 },
    { source: "function f(a: number): number {\n  let b = a;\n  b ??= 1;\n  return b;\n}", extended: 2 },
    { source: "function f(a: number): number {\n  let b = a;\n  b &&= 1;\n  return b;\n}", extended: 2 },
    { source: "function f(a: number): number {\n  let b = a;\n  b ||= 1;\n  return b;\n}", extended: 2 },
  ];
  for (const entry of cases) {
    assertEquals(measureAll(entry.source, CLASSIC_OPTIONS)[0].cyclomatic, 1, entry.source);
    assertEquals(measureAll(entry.source)[0].cyclomatic, entry.extended, entry.source);
  }
});

Deno.test("cyclomatic-nested-units: descendant decisions are excluded and independently measured", () => {
  const cores = measureAll(NESTED);
  assertEquals(cores.map((entry) => entry.name), ["outer", "inner"]);
  assertEquals(cores.map((entry) => entry.cyclomatic), [2, 2]);
  const found = messages(NESTED, { max: 1 });
  assertEquals(found.length, 2);
  assert(found.some((message) => message.includes("outer") && message.includes("2")), found.join(" | "));
  assert(found.some((message) => message.includes("inner") && message.includes("2")), found.join(" | "));
});

Deno.test("metric-parameter-optional-ownership: optional links in parameter defaults add no decision", () => {
  const cases: readonly { readonly source: string; readonly extended: number }[] = [
    { source: "function f(x = value?.field) {\n  return x;\n}", extended: 1 },
    { source: "const f = ({ a = b?.c }) => a;", extended: 1 },
    { source: "class A {\n  run(x = value?.field) {\n    return x?.y;\n  }\n}", extended: 2 },
    { source: "function f(x = value?.field) {\n  return x?.y ?? 0;\n}", extended: 3 },
  ];
  for (const entry of cases) {
    assertEquals(measureAll(entry.source)[0].cyclomatic, entry.extended, entry.source);
    assertEquals(measureAll(entry.source, CLASSIC_OPTIONS)[0].cyclomatic, 1, entry.source);
  }
  const found = messages("export function f(x = value?.field) { return x; }", { max: 1 });
  assertEquals(found, []);
});

Deno.test("cyclomatic-contributions: exact kind, weight and UTF-16 position keep the sum invariant", () => {
  const metrics = measureAll(CONTRIBUTIONS)[0];
  assertEquals(metrics.cyclomatic, 7);
  const counted = metrics.contributions.filter((entry) => entry.metric === "cyclomatic");
  assertEquals(counted.length, 6);
  const conditional = CONTRIBUTIONS.indexOf("a && b");
  const expected: readonly (readonly [string, number])[] = [
    ["if", CONTRIBUTIONS.indexOf("if (a)")],
    ["nullish-coalescing", CONTRIBUTIONS.indexOf("b ?? 0")],
    ["else-if", CONTRIBUTIONS.indexOf("if (c?")],
    ["optional-chain", CONTRIBUTIONS.indexOf("?.length")],
    ["ternary", conditional],
    ["logical-and", conditional],
  ];
  for (const [kind, offset] of expected) {
    const contribution = counted.find((entry) => entry.kind === kind);
    assert(contribution !== undefined, `${kind} is missing`);
    assertEquals(contribution.metric, "cyclomatic");
    assertEquals(contribution.weight, 1);
    assertEquals(contribution.nesting, 0);
    assertEquals({ line: contribution.line, column: contribution.column }, positionOf(CONTRIBUTIONS, offset));
  }
  const weights = metrics.contributions.filter((entry) => entry.metric === "cyclomatic").reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );
  assertEquals(metrics.cyclomatic, 1 + weights);
  const classic = measureAll(CONTRIBUTIONS, CLASSIC_OPTIONS)[0];
  assertEquals(
    classic.contributions.filter((entry) => entry.metric === "cyclomatic").map((entry) => entry.kind),
    ["if", "else-if", "ternary", "logical-and"],
  );
});

Deno.test("rule-reads-core: both rule variants report the core value through the real Deno plugin", () => {
  for (const variant of ["classic", "extended"] as const) {
    const core = measureAll(WIDE, { variant, countNullish: true })[0];
    const found = messages(WIDE, { max: 1, variant });
    assertEquals(found.length, 1, variant);
    assert(found[0].includes(`complexity ${core.cyclomatic} (limit 1)`), `${variant}: ${found[0]}`);
  }
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

Deno.test("a nullish-coalescing expression adds no decision under the classic variant", () => {
  assertEquals(
    messages("function f(a: number | null): number {\n  return a ?? 0;\n}", { max: 1, variant: "classic" }),
    [],
  );
});

Deno.test("a nested arrow body does not add to the outer function", () => {
  const source = "function component(items: string[]): string[] {\n  return items.map((i) => i);\n}";
  assertEquals(messages(source, { max: 1 }), []);
});

Deno.test("a class method body counts its own decisions (golden run() value 2)", () => {
  const source = "class Service {\n  ready = false;\n  run(): void {\n    if (this.ready) return;\n  }\n}";
  const found = messages(source, { max: 1 });
  assertEquals(found.length, 1);
  assert(found[0].includes("2"), found[0]);
});
