/**
 * @module RequireOptionalWrapperTest
 * @path packages/lint-rules/tests/require_optional_wrapper_test.ts
 * @description Rule-level tests for exaix/require-optional-wrapper.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/require_optional_wrapper.ts]
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "@exaix/lint-rules";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

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
      "exaix/require-optional-wrapper": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["type-safety", "deslop"],
        options,
      },
    },
  };
}

function reports(source: string, options: Record<string, JsonValue> = {}): boolean {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source).length > 0;
}

Deno.test("require-optional-wrapper reports a bare ? parameter", () => {
  assertEquals(reports("export function f(a?: string): void {}"), true);
});

Deno.test("require-optional-wrapper reports a bare `| undefined` parameter", () => {
  assertEquals(reports("export function f(a: string | undefined): void {}"), true);
});

Deno.test("require-optional-wrapper accepts the configured wrapper", () => {
  assertEquals(reports("export function f(a?: Opt<string, Reason.OptionalInput>): void {}"), false);
  assertEquals(reports("export function f(a: Opt<string, Reason.OptionalInput> | undefined): void {}"), false);
});

Deno.test("require-optional-wrapper reports an Opt-wrapped parameter under another wrapperType", () => {
  assertEquals(
    reports("export function f(a?: Opt<string, Reason.OptionalInput>): void {}", { wrapperType: "Maybe" }),
    true,
  );
});

Deno.test("require-optional-wrapper accepts a required parameter", () => {
  assertEquals(reports("export function f(a: string): void {}"), false);
});
