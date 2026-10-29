/**
 * @module RuleCeilingTest
 * @path tests/rule_ceiling_test.ts
 * @description Behaviour of the rule-ceiling ratchet evaluator: over, under, equal, unknown rule, and unknown package.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/cli/rule_ceiling.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { evaluateCeilings, parseCeilings, projectCeilings } from "../src/cli/rule_ceiling.ts";

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

Deno.test("rule-report-ceilings: at, above, below, missing measured packages and rule projection", () => {
  const knownRules = ["demo/no-runtime-typeof", "demo/no-explicit-unknown"];
  const knownPackages = ["packages/alpha", "packages/beta", "."];
  const ceilings = parseCeilings(
    JSON.stringify({ "demo/no-runtime-typeof": { "packages/alpha": 3 } }),
    knownRules,
    knownPackages,
  );
  const projected = projectCeilings(ceilings, "demo/no-runtime-typeof");

  assertEquals(
    evaluateCeilings(projected, { "demo/no-runtime-typeof": { "packages/alpha": 3 } }, knownRules, knownPackages).over,
    [],
  );
  const above = evaluateCeilings(
    projected,
    { "demo/no-runtime-typeof": { "packages/alpha": 5 } },
    knownRules,
    knownPackages,
  );
  assertEquals(above.over.length, 1);
  assertEquals(above.over[0].delta, 2);
  const below = evaluateCeilings(
    projected,
    { "demo/no-runtime-typeof": { "packages/alpha": 1 } },
    knownRules,
    knownPackages,
  );
  assertEquals(below.under.length, 1);

  const missing = evaluateCeilings(
    projected,
    { "demo/no-runtime-typeof": { "packages/beta": 2 } },
    knownRules,
    knownPackages,
  );
  assertEquals(missing.over.length, 1);
  assertEquals(missing.over[0].packageName, "packages/beta");
  assertEquals(missing.over[0].ceiling, 0);

  const unrelated = evaluateCeilings(
    { "demo/no-runtime-typeof": { "packages/alpha": 0 } },
    { "demo/no-explicit-unknown": { "packages/alpha": 9 } },
    knownRules,
    knownPackages,
  );
  assertEquals(unrelated.over, []);
  assertEquals(unrelated.under.length, 0);

  assertThrows(() => projectCeilings(ceilings, "demo/no-explicit-unknown"), Error, "no row");
  assertThrows(
    () => parseCeilings(JSON.stringify({ "demo/ghost": {} }), knownRules, knownPackages),
    Error,
    "unknown rule",
  );
  assertThrows(
    () =>
      parseCeilings(
        JSON.stringify({ "demo/no-runtime-typeof": { "packages/ghost": 1 } }),
        knownRules,
        knownPackages,
      ),
    Error,
    "unknown bucket",
  );
  assertThrows(
    () =>
      parseCeilings(JSON.stringify({ "demo/no-runtime-typeof": { "packages/alpha": -1 } }), knownRules, knownPackages),
    Error,
    "invalid",
  );
});
