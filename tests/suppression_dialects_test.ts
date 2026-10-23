/**
 * @module SuppressionDialectsTest
 * @path tests/suppression_dialects_test.ts
 * @description Runs the suppression-dialect table on the Deno host.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/cases/suppression_dialects.json, src/rules/deno/ignore_directive.ts]
 */

import { assertEquals } from "@std/assert";
import { findingsOf, plainRun } from "./helpers/rule_runner.ts";
import { TEST_PLUGIN_NAME } from "./helpers/registry.ts";
import table from "./cases/suppression_dialects.json" with { type: "json" };

interface IDialectCase {
  readonly dialect: string;
  readonly code: string;
  readonly needsReason: boolean;
  readonly forbidden: boolean;
}

const DENO_CASES = (table as readonly IDialectCase[]).filter((entry) => entry.dialect === "deno");

Deno.test("the Deno host reports a reasonless and a forbidden directive for its dialect", () => {
  for (const entry of DENO_CASES) {
    const code = entry.code.replaceAll("{{plugin}}", TEST_PLUGIN_NAME);
    const needsReason = findingsOf("ignore-needs-reason", plainRun(code)).length;
    const forbidden = findingsOf("no-forbidden-lint-ignore", plainRun(code)).length;
    assertEquals(needsReason, entry.needsReason ? 1 : 0, `ignore-needs-reason: ${entry.code}`);
    assertEquals(forbidden, entry.forbidden ? 1 : 0, `no-forbidden-lint-ignore: ${entry.code}`);
  }
});

Deno.test("the Deno host ignores an ESLint directive when only the Deno dialect is active", () => {
  const code = "// eslint-disable-next-line demo/no-explicit-unknown\nexport const value: unknown = 1;\n";
  assertEquals(findingsOf("ignore-needs-reason", plainRun(code)).length, 0);
});
