/**
 * @module IgnoreNeedsReasonTest
 * @path packages/lint-rules/tests/ignore_needs_reason_test.ts
 * @description Rule-level tests for exaix/ignore-needs-reason.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/deno/ignore_needs_reason.ts]
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "@exaix/lint-rules";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

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
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(options)));
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

/** The 1-based line of the start of each diagnostic. */
function linesOf(source: string): number[] {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog()));
  return runPlugin(plugin, PROD, source).map((diagnostic) => source.slice(0, diagnostic.range[0]).split("\n").length);
}

Deno.test("ignore-needs-reason reports at the comment's line, not line 1", () => {
  const source =
    "export const a = 1;\nexport const b = 2;\n// deno-lint-ignore exaix/no-boolean-assert\nexport const c = 3;\n";
  assertEquals(linesOf(source), [3]);
});

Deno.test("ignore-needs-reason reports each reasonless ignore on its own line", () => {
  const source = "// deno-lint-ignore exaix/a\nexport const a = 1;\n// deno-lint-ignore exaix/b\nexport const b = 2;\n";
  assertEquals(linesOf(source), [1, 3]);
});
