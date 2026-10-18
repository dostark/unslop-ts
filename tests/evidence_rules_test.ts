/**
 * @module EvidenceRulesTest
 * @path packages/lint-rules/tests/evidence_rules_test.ts
 * @description Rule-level tests for the ratcheted evidence rules, ported from anti-slop (MIT).
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/evidence_rules.ts, packages/lint-rules/tests/require_safety_comment_test.ts]
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "@exaix/lint-rules";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

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
  label = "",
): void {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(overrides, ruleId)));
  const count = runPlugin(plugin, filename, source).length;
  assertEquals(
    count > 0,
    shouldReport,
    `${ruleId}${label ? ` [${label}]` : ""}: expected ${shouldReport ? "a report" : "no report"} for: ${source}`,
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

// Upstream cases below are ported from anti-slop (MIT) at commit
// 13909c9e07590f5a85d93c62712259fe14a883f7, with upstream case names kept.

Deno.test("no-runtime-typeof upstream valid cases report nothing", () => {
  const valid = [
    ["existence probe against document", 'const isServer = typeof document === "undefined";'],
    ["inequality existence probe", 'const hasStorage = typeof localStorage !== "undefined";'],
    [
      "guarded throw on a missing global",
      'if (typeof globalThis.crypto === "undefined") throw new Error("no crypto");',
    ],
    ["reversed existence probe", 'const missing = "undefined" === typeof process;'],
    ["no typeof at all", "const value = input;"],
  ] as const;
  for (const [name, source] of valid) {
    expectRule("exaix/no-runtime-typeof", source, false, {}, PROD, name);
  }
});

Deno.test("no-runtime-typeof upstream type-guard cases are valid with allowInTypeGuards", () => {
  const valid = [
    [
      "type-predicate function",
      'function isString(value: unknown): value is string { return typeof value === "string"; }',
    ],
    ["type-predicate arrow", 'const isString = (value: unknown): value is string => typeof value === "string";'],
    [
      "asserts type predicate",
      'function assertString(value: unknown): asserts value is string { if (typeof value !== "string") throw new Error(); }',
    ],
  ] as const;
  for (const [name, source] of valid) {
    expectRule(
      "exaix/no-runtime-typeof",
      source,
      false,
      {
        "exaix/no-runtime-typeof": { options: { allowInTypeGuards: true } },
      },
      PROD,
      name,
    );
  }
});

Deno.test("no-runtime-typeof upstream invalid cases report one diagnostic", () => {
  const invalid = [
    ["string comparison in a plain function", 'if (typeof input === "string") use(input);'],
    [
      "typeof comparison outside a type predicate",
      'function parse(value: unknown): string { if (typeof value !== "string") throw new Error(); return value; }',
    ],
    [
      "typeof inside a nested closure of a type predicate",
      'function isString(value: unknown): value is string { const check = () => typeof value === "string"; return check(); }',
    ],
  ] as const;
  for (const [name, source] of invalid) {
    expectRule(
      "exaix/no-runtime-typeof",
      source,
      true,
      {
        "exaix/no-runtime-typeof": { options: { allowInTypeGuards: true } },
      },
      PROD,
      name,
    );
  }
});

Deno.test("no-runtime-typeof upstream changed case: a type predicate without options is valid locally", () => {
  // Changed from upstream: upstream defaults allowInTypeGuards to false, which reports this case.
  // Exaix defaults it to true (Q4, 2026-10-14) so a type-predicate function may narrow JSON input.
  const source = 'function isString(value: unknown): value is string { return typeof value === "string"; }';
  expectRule("exaix/no-runtime-typeof", source, false, {}, PROD, "local default allowInTypeGuards");
});

Deno.test("no-runtime-typeof upstream changed case: typeof against the undefined identifier is not matched", () => {
  // Changed from upstream: upstream reports `typeof input === undefined`. The Exaix rule matches a
  // string literal on the other side, so a comparison against the `undefined` identifier is skipped.
  expectRule(
    "exaix/no-runtime-typeof",
    "if (typeof input === undefined) use(input);",
    false,
    {},
    PROD,
    "identifier probe",
  );
});

Deno.test("no-conditional-empty-object-spread upstream valid cases report nothing", () => {
  const valid = [
    ["no spread", "const result = { value };"],
    ["plain spread", "const result = { ...values };"],
    ["conditional outside a spread", "const result = condition ? { value } : {};"],
  ] as const;
  for (const [name, source] of valid) {
    expectRule("exaix/no-conditional-empty-object-spread", source, false, {}, PROD, name);
  }
});

Deno.test("no-conditional-empty-object-spread upstream invalid cases report one diagnostic", () => {
  const invalid = [
    ["empty alternate branch", "const result = { ...(value !== undefined ? { value } : {}) };"],
    ["empty consequent branch", "const result = { ...(condition ? {} : { value }) };"],
  ] as const;
  for (const [name, source] of invalid) {
    expectRule("exaix/no-conditional-empty-object-spread", source, true, {}, PROD, name);
  }
});
