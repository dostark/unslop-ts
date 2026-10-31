/**
 * @module RequireOptionalWrapperTest
 * @path tests/require_optional_wrapper_test.ts
 * @description Rule-level tests for demo/require-optional-wrapper.
 * @architectural-layer Test
 * @related-files [src/rules/require_optional_wrapper.ts]
 */

import { assertEquals } from "@std/assert";
import type { JsonValue } from "../mod.ts";
import { findingsOf, runAt } from "./helpers/rule_runner.ts";

function reports(source: string, options: Record<string, JsonValue> = {}): boolean {
  return findingsOf("require-optional-wrapper", runAt(source, "packages/x/src/a.ts", options)).length > 0;
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
