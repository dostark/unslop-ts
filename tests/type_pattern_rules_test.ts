/**
 * @module TypePatternRulesTest
 * @path tests/type_pattern_rules_test.ts
 * @description Positive, negative, and option cases for the promise-response, suppression-pragma, and string-union rules.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/type_pattern_rules.ts, src/rules/mod.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { findingsOf, linesOf, plainRun, runAt } from "./helpers/rule_runner.ts";

const RESPONSE_PROMISE = ["Promise", "<Response>"].join("");
const PRAGMA_PREFIX = "@ts-";
const IGNORE = `${PRAGMA_PREFIX}ignore`;
const EXPECT_ERROR = `${PRAGMA_PREFIX}expect-error`;
const NOCHECK = `${PRAGMA_PREFIX}nocheck`;
const FAST_OR_SLOW = ['"fast"', '"slow"'].join(" | ");

Deno.test("promise-response-alias reports an alias of the weak promise and of a function that returns it", () => {
  assertEquals(linesOf("promise-response-alias", plainRun(`export type Fetcher = ${RESPONSE_PROMISE};\n`)), [1]);
  assertEquals(linesOf("promise-response-alias", plainRun(`type Fetcher = () => ${RESPONSE_PROMISE};\n`)), [1]);
  assertEquals(linesOf("promise-response-alias", plainRun(`type Fetcher = (url: string) => ${RESPONSE_PROMISE};\n`)), [
    1,
  ]);
});

Deno.test("promise-response-alias ignores other aliases, comments, and strings", () => {
  const source = [
    "export type Body = Promise<string>;",
    `// type Old = ${RESPONSE_PROMISE};`,
    `export const text = "type Old = ${RESPONSE_PROMISE};";`,
    "export type Wrapped = Array<Response>;",
    "",
  ].join("\n");
  assertEquals(linesOf("promise-response-alias", plainRun(source)), []);
});

Deno.test("promise-response-return reports the weak promise as a return type", () => {
  const source = [
    `export function get(): ${RESPONSE_PROMISE} {`,
    '  return fetch("x");',
    "}",
    `export const load = (): ${RESPONSE_PROMISE} => fetch("y");`,
    "export class Client {",
    `  send(): ${RESPONSE_PROMISE} {`,
    '    return fetch("z");',
    "  }",
    "}",
    "export interface IClient {",
    `  send(): ${RESPONSE_PROMISE};`,
    "}",
    "",
  ].join("\n");
  assertEquals(linesOf("promise-response-return", plainRun(source)), [1, 4, 6, 11]);
});

Deno.test("promise-response-return reports a parameter or variable annotation as the script did", () => {
  const source = `export function run(task: ${RESPONSE_PROMISE}): void {}\nexport let pending: ${RESPONSE_PROMISE};\n`;
  assertEquals(linesOf("promise-response-return", plainRun(source)), [1, 2]);
});

Deno.test("promise-response-return ignores a comment, a string, and another promise type", () => {
  const source = [
    `// get(): ${RESPONSE_PROMISE} is weak`,
    `export const note = "get(): ${RESPONSE_PROMISE}";`,
    "export function get(): Promise<string> {",
    '  return Promise.resolve("x");',
    "}",
    "",
  ].join("\n");
  assertEquals(linesOf("promise-response-return", plainRun(source)), []);
});

Deno.test("promise-response-return leaves the alias of a function type to promise-response-alias", () => {
  const source = `export type Fetcher = () => ${RESPONSE_PROMISE};\n`;
  assertEquals(linesOf("promise-response-return", plainRun(source)), []);
});

Deno.test("ts-suppression-pragmas reports a pragma that carries a description", () => {
  const source = [
    `// ${EXPECT_ERROR}: the literal is checked at run time`,
    'export const a: number = "x";',
    `// ${IGNORE} legacy value`,
    'export const b: number = "x";',
    `/* ${IGNORE} legacy value */`,
    'export const c: number = "x";',
    `// ${NOCHECK} generated file`,
    "",
  ].join("\n");
  assertEquals(linesOf("ts-suppression-pragmas", plainRun(source)), [1, 3, 5, 7]);
});

Deno.test("ts-suppression-pragmas leaves a pragma without a description to the built-in rule", () => {
  const source = [
    `// ${IGNORE}`,
    'export const a: number = "x";',
    `// ${EXPECT_ERROR}:`,
    'export const b: number = "x";',
    `/* ${IGNORE} */`,
    'export const c: number = "x";',
    "",
  ].join("\n");
  assertEquals(linesOf("ts-suppression-pragmas", plainRun(source)), []);
});

Deno.test("ts-suppression-pragmas ignores a pragma name inside prose or a string", () => {
  const source = [
    `// the ${IGNORE} pragma is banned here`,
    `export const text = "${IGNORE} reason";`,
    "",
  ].join("\n");
  assertEquals(linesOf("ts-suppression-pragmas", plainRun(source)), []);
});

Deno.test("magic-union-type reports an inline union of string literals", () => {
  const source = [
    `export function mode(value: ${FAST_OR_SLOW}): string {`,
    "  return value;",
    "}",
    "export interface IOptions {",
    `  readonly speed: ${FAST_OR_SLOW};`,
    "}",
    `export const pick = (input: string) => input as ${FAST_OR_SLOW};`,
    "",
  ].join("\n");
  assertEquals(linesOf("magic-union-type", plainRun(source)), [1, 5, 7]);
});

Deno.test("magic-union-type accepts the body of a named alias and unions of other types", () => {
  const source = [
    `export type Speed = ${FAST_OR_SLOW};`,
    'export type Mode = "fast" | "slow" | undefined;',
    "export function n(value: string | number): void {}",
    'export function one(value: "only" | undefined): void {}',
    "",
  ].join("\n");
  assertEquals(linesOf("magic-union-type", plainRun(source)), []);
});

Deno.test("magic-union-type reports a union that spans lines and one whose values contain a dash", () => {
  const source = ["export function mode(", '  value: "fast"', '    | "slow",', "): void {}", ""].join("\n");
  assertEquals(linesOf("magic-union-type", plainRun(source)).length, 1);
  assertEquals(
    linesOf("magic-union-type", plainRun('export function m(value: "a-b" | "c-d"): void {}\n')),
    [1],
  );
});

Deno.test("magic-union-type ignores a union written in a comment or a string", () => {
  const source = [`// mode: ${FAST_OR_SLOW}`, `export const text = '${FAST_OR_SLOW}';`, ""].join("\n");
  assertEquals(linesOf("magic-union-type", plainRun(source)), []);
});

Deno.test("magic-union-type reports the configured hint, and a default hint without one", () => {
  const source = `export function mode(value: ${FAST_OR_SLOW}): string {\n  return value;\n}\n`;
  const withHint = runAt(source, "packages/x/src/a.ts", { hint: "Define an enum in types/enums.ts." });
  const finding = findingsOf("magic-union-type", withHint)[0];
  assertStringIncludes(finding.message, "union of string literals");
  assertStringIncludes(finding.hint, "Define an enum in types/enums.ts.");
  const fallback = findingsOf("magic-union-type", plainRun(source))[0];
  assertStringIncludes(fallback.hint, "named type");
});
