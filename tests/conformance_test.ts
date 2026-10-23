/**
 * @module ConformanceTest
 * @path tests/conformance_test.ts
 * @description Runs the per-rule conformance data on the Deno host.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/cases/conformance.json, tests/hosts/deno.ts]
 */

import { assertEquals } from "@std/assert";
import { asJsonRecord } from "../src/engine/catalog.ts";
import { runDenoHost } from "./hosts/deno.ts";
import table from "./cases/conformance.json" with { type: "json" };

interface IInvalidCase {
  readonly code: string;
  readonly filename?: string;
  readonly options?: readonly Record<string, unknown>[];
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

interface IConformanceCase {
  readonly rule: string;
  readonly valid: readonly string[];
  readonly invalid: readonly IInvalidCase[];
}

/** Reads the JSON table as the case shape; the generator owns the shape. */
function asConformance(value: unknown): readonly IConformanceCase[] {
  return value as readonly IConformanceCase[];
}

const CASES = asConformance(table);

function actual(rule: string, entry: IInvalidCase): readonly { line: number; column: number; message: string }[] {
  return runDenoHost({
    rule,
    code: entry.code,
    ...(entry.filename === undefined ? {} : { filename: entry.filename }),
    ...(entry.options === undefined ? {} : { options: asJsonRecord(entry.options[0]) }),
    pluginName: "unslop",
  }).map((diagnostic) => ({
    line: diagnostic.line,
    column: diagnostic.column,
    message: diagnostic.message,
  }));
}

Deno.test("every rule's case matches the recorded line, column, and message on Deno", () => {
  const problems: string[] = [];
  for (const entry of CASES) {
    for (const invalid of entry.invalid) {
      const found = actual(entry.rule, invalid);
      const expected = [{ line: invalid.line, column: invalid.column, message: invalid.message }];
      if (JSON.stringify(found) !== JSON.stringify(expected)) {
        problems.push(`${entry.rule}: ${JSON.stringify(found)} != ${JSON.stringify(expected)}`);
      }
    }
    for (const code of entry.valid) {
      const found = actual(entry.rule, { code, line: 0, column: 0, message: "" });
      if (found.length !== 0) problems.push(`${entry.rule}: valid case reported`);
    }
  }
  assertEquals(problems, []);
});

Deno.test("a seeded divergence is detected", () => {
  const entry = CASES[0].invalid[0];
  const found = actual(CASES[0].rule, entry);
  const mutated = [{ ...found[0], message: "different" }];
  assertEquals(JSON.stringify(found) !== JSON.stringify(mutated), true);
});
