/**
 * @module MagicLiteralDetectorTest
 * @path tests/magic_literal_detector_test.ts
 * @description Counting, skip lists, thresholds, scoring order, and options of the magic-literal detector.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/whole_tree/magic_literals.ts, src/rules/whole_tree/options.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  detectMagicLiterals,
  formatMagicViolation,
  type IMagicLiteralFile,
  MagicLiteralOptionsSchema,
} from "../src/rules/whole_tree/mod.ts";

const REPEATED = '"shared literal text"';
const FIVE_DIGIT = "12345";

function file(path: string, text: string, isTest = false): IMagicLiteralFile {
  return { path, text, isTest };
}

function repeat(literal: string, times: number, wrap: (value: string, index: number) => string): string {
  return Array.from({ length: times }, (_, index) => wrap(literal, index)).join("\n");
}

function uses(literal: string, times: number): string {
  return repeat(literal, times, (value, index) => `export const v${index} = [${value}];`);
}

Deno.test("a string above the local threshold in one file is a module violation", () => {
  const found = detectMagicLiterals([file("a.ts", uses(REPEATED, 4))], {});
  assertEquals(found.length, 1);
  assertEquals(found[0].scope, "local");
  assertEquals(found[0].totalOccurrences, 4);
  assertEquals(found[0].kind, "string");
  assertEquals(detectMagicLiterals([file("a.ts", uses(REPEATED, 3))], {}), []);
});

Deno.test("a string above the global threshold across files is one global violation", () => {
  const files = ["a.ts", "b.ts", "c.ts"].map((path) => file(path, uses(REPEATED, 2)));
  const found = detectMagicLiterals(files, {});
  assertEquals(found.length, 1);
  assertEquals(found[0].scope, "global");
  assertEquals(found[0].distinctFiles, 3);
  assertEquals(found[0].totalOccurrences, 6);
  assertEquals(found[0].files.map((entry) => entry.file), ["a.ts", "b.ts", "c.ts"]);
});

Deno.test("a number counts above its own thresholds and checkNumbers false turns numbers off", () => {
  const source = uses(FIVE_DIGIT, 5);
  assertEquals(detectMagicLiterals([file("a.ts", source)], {}).map((entry) => entry.kind), ["number"]);
  assertEquals(detectMagicLiterals([file("a.ts", uses(FIVE_DIGIT, 4))], {}), []);
  assertEquals(detectMagicLiterals([file("a.ts", source)], { checkNumbers: false }), []);
});

Deno.test("small, round, and status-code numbers are structural", () => {
  for (const structural of ["0", "1", "99", "404", "500", "1000"]) {
    assertEquals(detectMagicLiterals([file("a.ts", uses(structural, 9))], {}), [], structural);
  }
  assertEquals(detectMagicLiterals([file("a.ts", uses("1500", 5))], {}).length, 1);
});

Deno.test("structural strings never count", () => {
  const structural = [
    "123e4567-e89b-12d3-a456-426614174000",
    "1.2.3",
    "src/some/path.ts",
    "--some-flag",
    "application/json",
    "a@example.com",
    "model-42",
    "SOME_CONSTANT",
    "abc",
    "string",
    "",
  ];
  for (const value of structural) {
    assertEquals(detectMagicLiterals([file("a.ts", uses(JSON.stringify(value), 9))], {}), [], value);
  }
});

Deno.test("literals in key, import, type, and metadata positions never count", () => {
  const positions = [
    (value: string) => `export const o = { ${value}: 1 };`,
    (value: string) => `import x from ${value};`,
    (value: string) => `export type T = ${value};`,
    (value: string) => `export const o = { description: ${value} };`,
    (value: string) => `export const o = { required: [${value}] };`,
    (value: string) => `export const o = a[${value}];`,
    (value: string) => `export enum E { A = ${value} }`,
    (value: string) => `export const SOME_NAME = ${value};`,
  ];
  for (const position of positions) {
    const text = repeat(REPEATED, 9, (value) => position(value));
    assertEquals(detectMagicLiterals([file("a.ts", text)], {}), [], position("x"));
  }
});

Deno.test("the piped stdio value and a text content type are structural", () => {
  const text = repeat("", 9, () => 'export const o = { stdout: "piped", type: "text" };');
  assertEquals(detectMagicLiterals([file("a.ts", text)], {}), []);
});

Deno.test("a status literal counts by default and is skipped when the options list it", () => {
  const source = uses('"pending-state"', 9);
  assertEquals(detectMagicLiterals([file("a.ts", source)], {}).length, 1);
  assertEquals(detectMagicLiterals([file("a.ts", source)], { statusLiterals: ["pending-state"] }), []);
});

Deno.test("additional strings, metadata properties, and array properties extend the skip lists", () => {
  assertEquals(
    detectMagicLiterals([file("a.ts", uses(REPEATED, 9))], { additionalStrings: ["shared literal text"] }),
    [],
  );
  const custom = repeat(REPEATED, 9, (value) => `export const o = { remark: ${value} };`);
  assertEquals(detectMagicLiterals([file("a.ts", custom)], {}).length, 1);
  assertEquals(detectMagicLiterals([file("a.ts", custom)], { metadataProperties: ["remark"] }), []);
  const listed = repeat(REPEATED, 9, (value) => `export const o = { labels: [${value}] };`);
  assertEquals(detectMagicLiterals([file("a.ts", listed)], {}).length, 1);
  assertEquals(detectMagicLiterals([file("a.ts", listed)], { structuralArrayProperties: ["labels"] }), []);
});

Deno.test("a definition file does not count and makes a literal reusable", () => {
  const definition = file("src/constants.ts", `export const NAMES = { first: ${REPEATED} };\n`);
  const user = file("src/use.ts", uses(REPEATED, 4));
  const found = detectMagicLiterals([definition, user], {});
  assertEquals(found.length, 1);
  assertEquals(found[0].hasExistingConstantCandidate, true);
  assertEquals(found[0].score, 10 + 4 * 3 + 5 + 40);
  const plain = detectMagicLiterals([user], {});
  assertEquals(plain[0].hasExistingConstantCandidate, false);
  assertEquals(plain[0].score, 10 + 4 * 3 + 5);
});

Deno.test("definitionFileSuffixes changes which files define constants", () => {
  const definition = file("src/names.ts", `export const NAMES = { first: ${REPEATED} };\n`);
  const user = file("src/use.ts", uses(REPEATED, 4));
  assertEquals(detectMagicLiterals([definition, user], {})[0].hasExistingConstantCandidate, false);
  const found = detectMagicLiterals([definition, user], { definitionFileSuffixes: ["names.ts"] });
  assertEquals(found[0].hasExistingConstantCandidate, true);
});

Deno.test("test scaffolding strings are skipped only in a test file", () => {
  const source = uses('"mock-value-here"', 9);
  assertEquals(detectMagicLiterals([file("a_test.ts", source, true)], {}), []);
  assertEquals(detectMagicLiterals([file("a.ts", source, false)], {}).length, 1);
  const custom = detectMagicLiterals([file("a_test.ts", source, true)], { testScaffoldPattern: "^nothing" });
  assertEquals(custom.length, 1);
});

Deno.test("thresholds come from the options", () => {
  const source = file("a.ts", uses(REPEATED, 2));
  assertEquals(detectMagicLiterals([source], {}), []);
  const lowered = detectMagicLiterals([source], { thresholds: { localString: 1 } });
  assertEquals(lowered.length, 1);
});

Deno.test("violations sort by score, then global first, then files, then occurrences", () => {
  const files = [
    file("a.ts", uses('"first literal text"', 4)),
    file("b.ts", uses('"second literal text"', 5)),
    ...["c.ts", "d.ts", "e.ts"].map((path) => file(path, uses('"third literal text"', 2))),
  ];
  const found = detectMagicLiterals(files, {});
  assertEquals(found.map((entry) => entry.value), [
    '"third literal text"',
    '"second literal text"',
    '"first literal text"',
  ]);
  assertEquals(found.map((entry) => entry.scope), ["global", "local", "local"]);
});

Deno.test("a violation formats as a header and a per-file breakdown", () => {
  const found = detectMagicLiterals([file("a.ts", uses(REPEATED, 4))], {});
  const lines = formatMagicViolation(found[0], (path) => `rel/${path}`);
  assertEquals(lines[0], `[MODULE] score=27 existing-constant=no ${REPEATED} (string) appears 4x across 1 file`);
  assertEquals(lines.includes("    ┃   rel/a.ts: 4 occurrences (line 1)"), true);
});

Deno.test("a breakdown that lists more than ten files ends with a summary line", () => {
  const files = Array.from({ length: 12 }, (_, index) => file(`f${index}.ts`, uses(REPEATED, 1)));
  const found = detectMagicLiterals(files, { thresholds: { globalString: 5 } });
  const lines = formatMagicViolation(found[0], (path) => path);
  assertEquals(lines.some((line) => line.includes("… and 2 more file(s) with 2 occurrence(s)")), true);
});

Deno.test("the option schema applies defaults and rejects an unknown key", () => {
  const defaults = MagicLiteralOptionsSchema.parse({});
  assertEquals(defaults.thresholds, { localString: 3, globalString: 5, localNumber: 4, globalNumber: 6 });
  assertEquals(defaults.checkNumbers, true);
  assertEquals(defaults.statusLiterals, []);
  assertThrows(() => MagicLiteralOptionsSchema.parse({ nope: 1 }));
});
