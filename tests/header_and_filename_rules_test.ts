/**
 * @module HeaderAndFilenameRulesTest
 * @path tests/header_and_filename_rules_test.ts
 * @description Positive, negative, and option cases for the module-header, script-usage, and ephemeral-filename rules.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/header_rules.ts, src/rules/deno/require_script_usage.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { findingsOf, linesOf, plainRun, runAt } from "./helpers/rule_runner.ts";

const CODE = "export const a = 1;\n";
const SCRIPT_PATH = "scripts/tool.ts";

Deno.test("require-module-header accepts a line comment or a block comment at the top", () => {
  assertEquals(linesOf("require-module-header", plainRun(`// A module note\n${CODE}`)), []);
  assertEquals(linesOf("require-module-header", plainRun(`/**\n * @module M\n */\n${CODE}`)), []);
});

Deno.test("require-module-header accepts a header below a shebang and blank lines", () => {
  assertEquals(linesOf("require-module-header", plainRun(`#!/usr/bin/env -S deno run\n\n/** header */\n${CODE}`)), []);
});

Deno.test("require-module-header reports a file with no comment, an empty file, and a comment after code", () => {
  assertEquals(linesOf("require-module-header", plainRun(CODE)), [1]);
  assertEquals(linesOf("require-module-header", plainRun("")), [1]);
  assertEquals(linesOf("require-module-header", plainRun(`${CODE}// late note\n`)), [1]);
});

Deno.test("require-module-header reports a comment that starts after the allowed line", () => {
  const late = `\n\n\n\n\n\n// header on line seven\n${CODE}`;
  assertEquals(linesOf("require-module-header", plainRun(late)), [1]);
  assertEquals(linesOf("require-module-header", runAt(late, "packages/x/src/a.ts", { maxStartLine: 8 })), []);
});

Deno.test("require-script-usage accepts a header with a Usage section", () => {
  const source = `/**\n * @module S\n *\n * Usage:\n *   deno run -A scripts/tool.ts\n */\n${CODE}`;
  assertEquals(linesOf("require-script-usage", runAt(source, SCRIPT_PATH, {})), []);
});

Deno.test("require-script-usage reports a header without a Usage section", () => {
  const source = `/**\n * @module S\n * @description Does a thing.\n */\n${CODE}`;
  assertEquals(linesOf("require-script-usage", runAt(source, SCRIPT_PATH, {})), [1]);
  assertStringIncludes(
    findingsOf("require-script-usage", runAt(source, SCRIPT_PATH, {}))[0].message,
    "'Usage:' section",
  );
});

Deno.test("require-script-usage leaves a file with no header to the module-header rule", () => {
  assertEquals(linesOf("require-script-usage", runAt(CODE, SCRIPT_PATH, {})), []);
});

Deno.test("require-script-usage reads only the configured number of header lines and the configured marker", () => {
  const filler = Array.from({ length: 16 }, () => " *").join("\n");
  const late = `/**\n${filler}\n * Usage:\n */\n${CODE}`;
  assertEquals(linesOf("require-script-usage", runAt(late, SCRIPT_PATH, {})), [1]);
  assertEquals(linesOf("require-script-usage", runAt(late, SCRIPT_PATH, { maxHeaderLines: 30 })), []);
  const marked = `/**\n * Run with: deno run a.ts\n */\n${CODE}`;
  assertEquals(linesOf("require-script-usage", runAt(marked, SCRIPT_PATH, { marker: "Run with:" })), []);
});

Deno.test("require-script-usage runs only on the files that the include globs name", () => {
  const source = `/**\n * @module S\n */\n${CODE}`;
  const gated = { ...runAt(source, "packages/x/src/a.ts", {}), include: ["scripts/**"] };
  assertEquals(linesOf("require-script-usage", gated), []);
  assertEquals(linesOf("require-script-usage", { ...gated, filename: SCRIPT_PATH }), [1]);
});

Deno.test("ephemeral-filename reports a numbered phase in a test file name", () => {
  for (const name of ["phase12_flow_test.ts", "flow_phase_3_test.ts", "flow.phase-7.test.ts"]) {
    assertEquals(linesOf("ephemeral-filename", runAt(CODE, `packages/x/tests/${name}`, {})), [1], name);
  }
});

Deno.test("ephemeral-filename ignores a plain phase word, a step number, and a source file", () => {
  assertEquals(linesOf("ephemeral-filename", runAt(CODE, "packages/x/tests/phase_test.ts", {})), []);
  assertEquals(linesOf("ephemeral-filename", runAt(CODE, "packages/x/tests/step3_test.ts", {})), []);
  assertEquals(linesOf("ephemeral-filename", runAt(CODE, "packages/x/src/phase12.ts", {})), []);
});

Deno.test("ephemeral-filename takes the pattern from options and names the number", () => {
  const custom = runAt(CODE, "packages/x/tests/sprint9_test.ts", { pattern: "(?:^|[_.-])sprint(\\d+)(?:[_.-]|$)" });
  assertEquals(linesOf("ephemeral-filename", custom), [1]);
  const finding = findingsOf("ephemeral-filename", runAt(CODE, "packages/x/tests/phase12_flow_test.ts", {}))[0];
  assertStringIncludes(finding.message, '("phase12")');
});
