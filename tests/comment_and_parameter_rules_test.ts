/**
 * @module CommentAndParameterRulesTest
 * @path tests/comment_and_parameter_rules_test.ts
 * @description Positive, negative, and option cases for the comment, parameter-count, and inline-fixture rules.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/comment_rules.ts, src/rules/max_params.ts, src/rules/test_fixture_rules.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { findingsOf, linesOf, plainRun, runAt } from "./helpers/rule_runner.ts";

const HEADER = "/**\n * @module M\n */\n";
const CODE = "export const a = 1;\n";
const LONG_LINES = ["// one", "// two", "// three", "// four"];

function inModule(...comment: string[]): string {
  return `${HEADER}${CODE}${comment.join("\n")}\nexport const b = 2;\n`;
}

Deno.test("long-comment reports an in-module run above the limit at its first line", () => {
  assertEquals(linesOf("long-comment", plainRun(inModule(...LONG_LINES))), [5]);
  assertEquals(linesOf("long-comment", plainRun(inModule(...LONG_LINES.slice(0, 3)))), []);
});

Deno.test("long-comment exempts the header comment and a comment before the first statement", () => {
  const source = `${LONG_LINES.join("\n")}\nexport const a = 1;\n`;
  assertEquals(linesOf("long-comment", plainRun(source)), []);
});

Deno.test("long-comment measures a block comment by its lines", () => {
  const block = "/**\n * one\n * two\n * three\n */";
  assertEquals(linesOf("long-comment", plainRun(inModule(block))), [5]);
});

Deno.test("long-comment splits runs at a blank line and ignores a trailing comment", () => {
  const split = inModule("// one", "// two", "// three", "", "// four", "// five", "// six");
  assertEquals(linesOf("long-comment", plainRun(split)), []);
  const trailing = `${HEADER}export const a = 1; // one\n// two\n// three\n// four\nexport const b = 2;\n`;
  assertEquals(linesOf("long-comment", plainRun(trailing)), []);
});

Deno.test("long-comment ignores comment text inside a string or a template", () => {
  const source = `${HEADER}export const text = \`\n// one\n// two\n// three\n// four\n\`;\n`;
  assertEquals(linesOf("long-comment", plainRun(source)), []);
});

Deno.test("long-comment takes the limit from maxLines", () => {
  const source = inModule(...LONG_LINES.slice(0, 2));
  assertEquals(linesOf("long-comment", runAt(source, "packages/x/src/a.ts", { maxLines: 1 })), [5]);
  assertEquals(linesOf("long-comment", runAt(inModule(...LONG_LINES), "packages/x/src/a.ts", { maxLines: 4 })), []);
});

Deno.test("long-comment names the line count and the limit", () => {
  const finding = findingsOf("long-comment", plainRun(inModule(...LONG_LINES)))[0];
  assertStringIncludes(finding.message, "Comment spans 4 lines, more than the 3-line limit");
});

Deno.test("ephemeral-comment reports a calendar date in any comment, including the header and a trailing one", () => {
  const dates = ["2026-10-20", "10/20/2026", "October 20, 2026", "Q3 2026"];
  for (const date of dates) {
    assertEquals(linesOf("ephemeral-comment", plainRun(`// done on ${date}\nexport const a = 1;\n`)), [1], date);
    assertEquals(linesOf("ephemeral-comment", plainRun(`${HEADER}export const a = 1; // ${date}\n`)), [4], date);
  }
  assertEquals(linesOf("ephemeral-comment", plainRun(inModule("// a plain note"))), []);
});

Deno.test("ephemeral-comment reports a configured phrase in an in-module comment and not in the header", () => {
  const options = { phrases: [{ pattern: "\\bphase\\s+\\d+\\b", flags: "i", hint: "a phase number" }] };
  const source = inModule("// added in phase 12");
  assertEquals(linesOf("ephemeral-comment", runAt(source, "packages/x/src/a.ts", options)), [5]);
  assertEquals(linesOf("ephemeral-comment", runAt("// added in phase 12\nexport const a = 1;\n", "a.ts", options)), []);
  const finding = findingsOf("ephemeral-comment", runAt(source, "packages/x/src/a.ts", options))[0];
  assertStringIncludes(finding.message, "references a phase number");
});

Deno.test("ephemeral-comment reports once for a run that matches two phrases", () => {
  const options = {
    phrases: [
      { pattern: "\\bphase\\s+\\d+\\b", flags: "i", hint: "a phase number" },
      { pattern: "\\bstep\\s+\\d+\\b", flags: "i", hint: "a step number" },
    ],
  };
  const source = inModule("// phase 1", "// step 2");
  assertEquals(linesOf("ephemeral-comment", runAt(source, "packages/x/src/a.ts", options)), [5]);
});

Deno.test("ephemeral-comment uses a generic phrase list by default", () => {
  assertEquals(linesOf("ephemeral-comment", plainRun(inModule("// we tried a loop first"))), [5]);
  assertEquals(linesOf("ephemeral-comment", plainRun(inModule("// it did not work with a map"))), [5]);
  assertEquals(linesOf("ephemeral-comment", plainRun(inModule("// added in phase 12"))), []);
});

Deno.test("ephemeral-comment can turn the date check off", () => {
  const source = "// done on 2026-10-20\nexport const a = 1;\n";
  assertEquals(linesOf("ephemeral-comment", runAt(source, "a.ts", { checkDates: false })), []);
});

Deno.test("decorative-comment reports a separator line in an in-module comment", () => {
  for (const line of ["// ==========", "// ----------", "// ──────────", "// -- text ----"]) {
    assertEquals(linesOf("decorative-comment", plainRun(inModule(line))), [5], line);
  }
  assertEquals(linesOf("decorative-comment", plainRun(inModule("// a plain note"))), []);
  assertEquals(linesOf("decorative-comment", plainRun(inModule("// a === b is true"))), []);
});

Deno.test("decorative-comment reports the line of the separator inside a block comment and exempts the header", () => {
  const block = "/*\n * note\n * ======\n */";
  assertEquals(linesOf("decorative-comment", plainRun(inModule(block))), [7]);
  assertEquals(linesOf("decorative-comment", plainRun("// ==========\nexport const a = 1;\n")), []);
});

const EIGHT = "a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number";

Deno.test("max-params reports a function above the limit at its first line", () => {
  const source = `export function f(\n  ${EIGHT.replaceAll(", ", ",\n  ")},\n): void {}\n`;
  assertEquals(linesOf("max-params", plainRun(source)), [1]);
  assertEquals(
    linesOf("max-params", plainRun(`export function f(${EIGHT.slice(0, EIGHT.lastIndexOf(","))}): void {}\n`)),
    [],
  );
});

Deno.test("max-params covers arrows, function expressions, methods, and constructors", () => {
  const source = [
    `export const arrow = (${EIGHT}): void => {};`,
    `export const expression = function (${EIGHT}): void {};`,
    `export class C {`,
    `  constructor(${EIGHT}) {}`,
    `  method(${EIGHT}): void {}`,
    `}`,
    "",
  ].join("\n");
  assertEquals(linesOf("max-params", plainRun(source)), [1, 2, 4, 5]);
});

Deno.test("max-params counts a rest parameter and a parameter property as one each, and ignores this", () => {
  const rest =
    `export function f(this: Window, a: number, b: number, c: number, d: number, e: number, f: number, ...g: number[]): void {}\n`;
  assertEquals(linesOf("max-params", plainRun(rest)), []);
  const property =
    `export class C {\n  constructor(private a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) {}\n}\n`;
  assertEquals(linesOf("max-params", plainRun(property)), [2]);
});

Deno.test("max-params ignores a function type and an interface method signature", () => {
  const source = `export type F = (${EIGHT}) => void;\nexport interface I {\n  m(${EIGHT}): void;\n}\n`;
  assertEquals(linesOf("max-params", plainRun(source)), []);
});

Deno.test("max-params takes the limit from max and names the count", () => {
  const source = "export function f(a: number, b: number, c: number): void {}\n";
  assertEquals(linesOf("max-params", runAt(source, "packages/x/src/a.ts", { max: 2 })), [1]);
  const finding = findingsOf("max-params", runAt(source, "packages/x/src/a.ts", { max: 2 }))[0];
  assertStringIncludes(finding.message, "must not exceed 2 parameters (found 3)");
});

const NINE_LINES = ["a: 1", "b: 2", "c: 3", "d: 4", "e: 5", "f: 6", "g: 7", "h: 8"].join("\n");

function fixture(name: string, body: string, tag = ""): string {
  return `const ${name} = ${tag}\`${body}\`;\n`;
}

Deno.test("test-inline-multiline-fixture reports a named multi-line template at or above minLines", () => {
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("yaml", `\n${NINE_LINES}\n`))), [1]);
  const six = ["a: 1", "b: 2", "c: 3", "d: 4", "e: 5", "f: 6"].join("\n");
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("yaml", `\n${six}\n`))), []);
});

Deno.test("test-inline-multiline-fixture reports a tagged template of a named variable", () => {
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("json", `\n${NINE_LINES}\n`, "dedent"))), [1]);
});

Deno.test("test-inline-multiline-fixture skips a template with an interpolation and an unnamed plain text", () => {
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("yaml", `\n${NINE_LINES}\n\${x}\n`))), []);
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("other", `\n${NINE_LINES}\n`))), []);
});

Deno.test("test-inline-multiline-fixture reports a document fixture of any size under any name", () => {
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("anything", "\n[section]\nkey = 1\n"))), [1]);
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("anything", "\nschema_version: 1\n"))), [1]);
});

Deno.test("test-inline-multiline-fixture reports a front-matter or comment opening at minLines under any name", () => {
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("doc", `\n---\n${NINE_LINES}\n`))), [1]);
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("doc", `\n# title\n${NINE_LINES}\n`))), [1]);
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun(fixture("doc", "\n---\nshort\n"))), []);
});

Deno.test("test-inline-multiline-fixture ignores a single-line template", () => {
  assertEquals(linesOf("test-inline-multiline-fixture", plainRun("const yaml = `a: 1`;\n")), []);
});

Deno.test("test-inline-multiline-fixture takes minLines, variableNames, and the fixtures directory from options", () => {
  const body = `\n${NINE_LINES}\n`;
  const lowered = runAt(fixture("yaml", "\na: 1\nb: 2\n"), "a_test.ts", { minLines: 2 });
  assertEquals(linesOf("test-inline-multiline-fixture", lowered), [1]);
  const named = runAt(fixture("sample", body), "a_test.ts", { variableNames: ["sample"] });
  assertEquals(linesOf("test-inline-multiline-fixture", named), [1]);
  const directory = runAt(fixture("yaml", body), "a_test.ts", { fixturesDirectory: "spec/data/" });
  assertStringIncludes(findingsOf("test-inline-multiline-fixture", directory)[0].message, "under spec/data/");
  assertStringIncludes(findingsOf("test-inline-multiline-fixture", named)[0].message, "into a fixture file");
});

const TWO_RUNS = "export const a = 1;\n\n// phase one\nexport const b = 2;\n// phase two\nexport const c = 3;\n";

Deno.test("global_and_sticky_phrases_report_all_runs", () => {
  for (const flags of ["g", "y", "gi", "iy"]) {
    const options = { phrases: [{ pattern: "// phase", flags, hint: "a phase" }] };
    assertEquals(linesOf("ephemeral-comment", runAt(TWO_RUNS, "packages/x/src/a.ts", options)), [3, 5], flags);
  }
});

Deno.test("phrase_results_are_stable_across_runs_and_invocations", () => {
  const options = { phrases: [{ pattern: "// phase", flags: "g", hint: "a phase" }] };
  const mixed = [
    "export const a = 1;",
    "",
    "// phase one",
    "export const b = 2;",
    "// a plain note",
    "export const c = 3;",
    "// phase three",
    "export const d = 4;",
    "",
  ].join("\n");
  const run = runAt(mixed, "packages/x/src/a.ts", options);
  const first = linesOf("ephemeral-comment", run);
  assertEquals(first, [3, 7]);
  assertEquals(linesOf("ephemeral-comment", run), first);
  assertEquals(linesOf("ephemeral-comment", runAt(TWO_RUNS, "packages/x/src/a.ts", options)), [3, 5]);
});
