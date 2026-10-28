/**
 * @module RuleCeilingTest
 * @path tests/rule_ceiling_test.ts
 * @description Behaviour of the rule-ceiling ratchet evaluator: over, under, equal, unknown rule, and unknown package.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/cli/rule_ceiling.ts]
 */

import { assertEquals } from "@std/assert";
import { evaluateCeilings } from "../src/cli/rule_ceiling.ts";

const KNOWN_RULES = ["demo/no-runtime-typeof", "demo/no-explicit-unknown"];
const KNOWN_PACKAGES = ["packages/alpha", "packages/beta"];

Deno.test("a count above the ceiling is reported with its delta", () => {
  const result = evaluateCeilings(
    { "demo/no-runtime-typeof": { "packages/alpha": 3 } },
    { "demo/no-runtime-typeof": { "packages/alpha": 5 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.over.length, 1);
  assertEquals(result.over[0].delta, 2);
  assertEquals(result.under.length, 0);
});

Deno.test("a count below the ceiling is reported as under, not as over", () => {
  const result = evaluateCeilings(
    { "demo/no-runtime-typeof": { "packages/alpha": 5 } },
    { "demo/no-runtime-typeof": { "packages/alpha": 3 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.under.length, 1);
  assertEquals(result.under[0].count, 3);
  assertEquals(result.over.length, 0);
});

Deno.test("a count equal to the ceiling is clean", () => {
  const result = evaluateCeilings(
    { "demo/no-runtime-typeof": { "packages/alpha": 5 } },
    { "demo/no-runtime-typeof": { "packages/alpha": 5 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.over, []);
  assertEquals(result.under, []);
});

Deno.test("an unknown rule id is rejected", () => {
  const result = evaluateCeilings(
    { "demo/not-a-rule": { "packages/alpha": 1 } },
    {},
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.unknownRules, ["demo/not-a-rule"]);
});

Deno.test("an unknown package key is rejected", () => {
  const result = evaluateCeilings(
    { "demo/no-runtime-typeof": { "packages/ghost": 1 } },
    {},
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.unknownPackages, ["packages/ghost"]);
});
