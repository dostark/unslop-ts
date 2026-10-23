/**
 * @module DenoHostRunner
 * @path tests/hosts/deno.ts
 * @description Runs one rule case on the Deno host and returns its diagnostics in the shared shape.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/helpers/rule_runner.ts, tests_node/hosts/eslint.mjs]
 */

import type { JsonValue } from "../../mod.ts";
import { findingsOf } from "../helpers/rule_runner.ts";
import { TEST_PLUGIN_NAME } from "../helpers/registry.ts";

/** One rule case a host runner can execute. */
export interface IHostCase {
  readonly rule: string;
  readonly code: string;
  readonly filename?: string;
  readonly options?: Record<string, JsonValue>;
}

/** One host diagnostic in the normalized runner shape. */
export interface IHostDiagnostic {
  readonly rule: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

/** Runs a case through the in-process Deno plugin, the API `deno lint` uses. */
export function runDenoHost(testCase: IHostCase): readonly IHostDiagnostic[] {
  return findingsOf(testCase.rule, {
    source: testCase.code,
    filename: testCase.filename ?? "packages/x/src/a.ts",
    options: testCase.options ?? {},
  }).map((finding) => ({
    rule: `${TEST_PLUGIN_NAME}/${testCase.rule}`,
    line: finding.line,
    column: 1,
    message: finding.message,
  }));
}
