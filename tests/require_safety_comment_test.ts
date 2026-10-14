/**
 * @module RequireSafetyCommentTest
 * @path packages/lint-rules/tests/require_safety_comment_test.ts
 * @description Marker-comment placement rules for exaix/require-safety-comment (anti-slop, MIT).
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/evidence_rules.ts]
 */

import { assertEquals } from "@std/assert";
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
      "type-safety": { description: "Rules that keep type evidence." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      "exaix/require-safety-comment": {
        engine: "plugin",
        severity: "error",
        scope: "prod",
        tags: ["type-safety", "deslop"],
        options,
      },
    },
  };
}

function reports(source: string, overrides: Record<string, JsonValue> = {}): boolean {
  const plugin = createLintPlugin("exaix", parseCatalog(buildCatalog(overrides)));
  return runPlugin(plugin, PROD, source).length > 0;
}

Deno.test("require-safety-comment accepts a marker before the statement", () => {
  assertEquals(reports("// SAFETY: upstream payload is untrusted here\nexport const v = input as User;\n"), false);
});

Deno.test("require-safety-comment accepts a marker on the line above the assertion", () => {
  assertEquals(
    reports("export const v =\n  // SAFETY: parsed at the boundary\n  input as User;\n"),
    false,
  );
});

Deno.test("require-safety-comment accepts a custom marker", () => {
  const source = "// INVARIANT: reviewed by hand\nexport const v = input as User;\n";
  assertEquals(reports(source, { markers: ["INVARIANT"] }), false);
  assertEquals(reports(source, { markers: ["SAFETY"] }), true);
});

Deno.test("require-safety-comment reports a missing marker", () => {
  assertEquals(reports("export const v = input as User;\n"), true);
});

Deno.test("require-safety-comment reports a marker with no text", () => {
  assertEquals(reports("// SAFETY:\nexport const v = input as User;\n"), true);
});

Deno.test("require-safety-comment ignores a marker after the assertion", () => {
  assertEquals(reports("export const v = input as User;\n// SAFETY: too late\n"), true);
});

Deno.test("require-safety-comment ignores a marker above an earlier statement", () => {
  assertEquals(
    reports("// SAFETY: belongs to the line below\nexport const a = 1;\nexport const v = input as User;\n"),
    true,
  );
});
