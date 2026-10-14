/**
 * @module EvidenceRulesTest
 * @path packages/lint-rules/tests/evidence_rules_test.ts
 * @description Rule-level tests for the ratcheted evidence rules, ported from anti-slop (MIT).
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/evidence_rules.ts, packages/lint-rules/tests/require_safety_comment_test.ts]
 */

import { assertEquals } from "@std/assert";
import { createLintPlugin, type JsonValue, parseCatalog, runPlugin } from "@exaix/lint-rules";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

const RULE_IDS = [
  "exaix/no-runtime-typeof",
  "exaix/no-conditional-empty-object-spread",
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
      scope: "prod",
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
  overrides: Record<string, Record<string, JsonValue>> = {},
  filename = PROD,
): void {
  const plugin = createLintPlugin("exaix", parseCatalog(buildCatalog(overrides, ruleId)));
  const count = runPlugin(plugin, filename, source).length;
  assertEquals(
    count > 0,
    shouldReport,
    `${ruleId}: expected ${shouldReport ? "a report" : "no report"} for: ${source}`,
  );
}

Deno.test("no-runtime-typeof reports a string typeof comparison", () => {
  expectRule(
    "exaix/no-runtime-typeof",
    "export function f(x: string | number): boolean {\n  return typeof x === 'string';\n}",
    true,
  );
});

Deno.test("no-runtime-typeof accepts an undefined existence probe", () => {
  expectRule(
    "exaix/no-runtime-typeof",
    "export function f(x: string | undefined): boolean {\n  return typeof x === 'undefined';\n}",
    false,
  );
});

Deno.test("no-runtime-typeof respects allowInTypeGuards", () => {
  const source = "export function isText(x: string | number): x is string {\n  return typeof x === 'string';\n}";
  expectRule("exaix/no-runtime-typeof", source, false);
  expectRule("exaix/no-runtime-typeof", source, true, {
    "exaix/no-runtime-typeof": { options: { allowInTypeGuards: false } },
  });
});

Deno.test("no-conditional-empty-object-spread reports an empty object branch", () => {
  expectRule("exaix/no-conditional-empty-object-spread", "export const r = { ...(a ? { a: 1 } : {}) };", true);
});

Deno.test("no-conditional-empty-object-spread accepts non-empty branches", () => {
  expectRule("exaix/no-conditional-empty-object-spread", "export const r = { ...(a ? { a: 1 } : { b: 2 }) };", false);
});
