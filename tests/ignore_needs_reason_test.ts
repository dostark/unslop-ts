/**
 * @module IgnoreNeedsReasonTest
 * @path packages/lint-rules/tests/ignore_needs_reason_test.ts
 * @description Rule-level tests for exaix/ignore-needs-reason.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/ignore_needs_reason.ts]
 */

import { assertEquals } from "@std/assert";
import { createLintPlugin, type JsonValue, parseCatalog, runPlugin } from "@exaix/lint-rules";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

function buildCatalog(options: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      "type-safety": { description: "Rules that keep type evidence." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      "exaix/ignore-needs-reason": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["type-safety", "deslop"],
        options,
      },
    },
  };
}

const PROD = "packages/x/src/a.ts";

function reports(source: string, options: Record<string, JsonValue> = {}): boolean {
  const plugin = createLintPlugin("exaix", parseCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source).length > 0;
}

Deno.test("ignore-needs-reason reports an exaix ignore without a reason", () => {
  assertEquals(reports("// deno-lint-ignore exaix/no-boolean-assert\nexport const a = 1;\n"), true);
});

Deno.test("ignore-needs-reason accepts an exaix ignore with a reason", () => {
  assertEquals(
    reports("// deno-lint-ignore exaix/no-boolean-assert -- keeps the mock simple\nexport const a = 1;\n"),
    false,
  );
});

Deno.test("ignore-needs-reason ignores an ignore for a non-exaix rule", () => {
  assertEquals(reports("// deno-lint-ignore no-explicit-" + "any\nexport const a = 1;\n"), false);
});

Deno.test("ignore-needs-reason honors a custom separator", () => {
  assertEquals(
    reports("// deno-lint-ignore exaix/no-boolean-assert : keeps the mock simple\nexport const a = 1;\n", {
      separator: ":",
    }),
    false,
  );
});
