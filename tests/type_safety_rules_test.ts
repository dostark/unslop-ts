/**
 * @module TypeSafetyRulesTest
 * @path packages/lint-rules/tests/type_safety_rules_test.ts
 * @description Rule-level tests for the AST-matched type-safety plugin rules, including
 *   evasion forms found in the Phase 213 review. Rule ideas from deslop / anti-slop (MIT).
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "@exaix/lint-rules";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

const RULE_IDS = [
  "exaix/no-explicit-unknown",
  "exaix/no-unsafe-dictionary",
  "exaix/no-typeof-escape",
  "exaix/no-pass-through-type-alias",
  "exaix/no-object-parameters",
] as const;

function buildCatalog(
  overrides: Record<string, Record<string, JsonValue>> = {},
  only?: string,
): Record<string, JsonValue> {
  const rules: Record<string, JsonValue> = {};
  for (const id of RULE_IDS) {
    const off = only !== undefined && id !== only;
    rules[id] = {
      engine: "plugin",
      severity: off ? "off" : "error",
      scope: "all",
      ...(off ? { reason: "Not under test in this case." } : {}),
      tags: ["type-safety", "deslop"],
      ...(overrides[id] ?? {}),
    };
  }
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      "type-safety": { description: "Rules that keep type evidence." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules,
  };
}

const PROD = "packages/x/src/a.ts";

function expectRule(
  ruleId: string,
  source: string,
  shouldReport: boolean,
  filename = PROD,
  overrides: Record<string, Record<string, JsonValue>> = {},
): void {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(overrides, ruleId)));
  const count = runPlugin(plugin, filename, source).length;
  assertEquals(
    count > 0,
    shouldReport,
    `${ruleId}: expected ${shouldReport ? "a report" : "no report"} for: ${source}`,
  );
}

Deno.test("no-explicit-unknown reports direct, array, union, and aliased unknown", () => {
  const invalid = [
    "function f(x: unknown): void {}",
    "let x: unknown;",
    "type A = unknown;",
    "let x: unknown[] = [];",
    "function f(): Promise<unknown> { return fetch('x'); }",
    "function f(x: Error | string | unknown): void {}",
    "type P = unknown;\nfunction f(): Promise<P> { return fetch('x'); }",
  ];
  for (const source of invalid) expectRule("exaix/no-explicit-unknown", source, true);
});

Deno.test("no-explicit-unknown accepts a catch binding and a typed value", () => {
  const valid = [
    "try {\n  doWork();\n} catch (e: unknown) {\n  log(e);\n}",
    "let x: string;",
    "function f(x: Error | string): void {}",
  ];
  for (const source of valid) expectRule("exaix/no-explicit-unknown", source, false);
});

Deno.test("no-explicit-unknown with allowCatchBinding false reports the catch binding", () => {
  const source = "try {\n  doWork();\n} catch (e: unknown) {\n  log(e);\n}";
  expectRule("exaix/no-explicit-unknown", source, false);
  expectRule("exaix/no-explicit-unknown", source, true, PROD, {
    "exaix/no-explicit-unknown": { options: { allowCatchBinding: false } },
  });
});

Deno.test("no-unsafe-dictionary reports Record, index signatures, and Map with a weak value", () => {
  const invalid = [
    "let x: Record<string, unknown>;",
    "let x: Record<string, any>;",
    "let x: { [k: string]: unknown };",
    "let x: Map<string, unknown>;",
    "let x: Record<string, {}>;",
  ];
  for (const source of invalid) expectRule("exaix/no-unsafe-dictionary", source, true);
});

Deno.test("no-unsafe-dictionary accepts strong value types", () => {
  const valid = [
    "let x: Record<string, string>;",
    "let x: Map<string, string>;",
    "let x: { [k: string]: string };",
  ];
  for (const source of valid) expectRule("exaix/no-unsafe-dictionary", source, false);
});

Deno.test("no-typeof-escape reports as typeof, in both cast forms", () => {
  for (const source of ["let x = y as typeof z;", "let x = <typeof z> y;"]) {
    expectRule("exaix/no-typeof-escape", source, true);
  }
});

Deno.test("no-typeof-escape leaves any to the built-in no-explicit-any", () => {
  for (const source of ["let x = y as any;", "let x: any[] = [];", "let x = <any> y;"]) {
    expectRule("exaix/no-typeof-escape", source, false);
  }
});

Deno.test("no-typeof-escape accepts a precise cast", () => {
  expectRule("exaix/no-typeof-escape", "let x = y as string;", false);
});

Deno.test("no-pass-through-type-alias reports an alias that only renames another alias", () => {
  expectRule("exaix/no-pass-through-type-alias", "type B = string;\ntype A = B;", true);
  expectRule("exaix/no-pass-through-type-alias", "type A = string;", false);
});

Deno.test("no-unsafe-dictionary forbiddenValueTypes narrows the value set", () => {
  const source = "let x: Record<string, object>;";
  expectRule("exaix/no-unsafe-dictionary", source, true);
  expectRule("exaix/no-unsafe-dictionary", source, false, PROD, {
    "exaix/no-unsafe-dictionary": { options: { forbiddenValueTypes: ["unknown"] } },
  });
});

Deno.test("no-object-parameters reports a parameter typed object", () => {
  expectRule("exaix/no-object-parameters", "function f(o: object): void {}", true);
  expectRule("exaix/no-object-parameters", "function f(o: { a: string }): void {}", false);
});
