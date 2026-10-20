/**
 * @module ModuleLayoutTest
 * @path tests/module_layout_test.ts
 * @description Cases for the import-placement and exported-interface-placement rules and the shared layout helper.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/module_layout_rules.ts, src/engine/module_layout.ts]
 */

import { assertEquals } from "@std/assert";
import { findingsOf, linesOf, plainRun } from "./helpers/rule_runner.ts";

Deno.test("import-placement accepts imports first, then types, then code", () => {
  const source =
    'import { a } from "./a.ts";\nexport interface IThing {\n  readonly a: number;\n}\nexport const b = a;\n';
  assertEquals(linesOf("import-placement", plainRun(source)), []);
});

Deno.test("import-placement reports a type definition that precedes the last import", () => {
  const source =
    'import { a } from "./a.ts";\nexport interface IThing {\n  readonly a: number;\n}\nimport { b } from "./b.ts";\nexport { a, b };\n';
  const [finding] = findingsOf("import-placement", plainRun(source));
  assertEquals(finding.line, 2);
  assertEquals(finding.message.includes("must follow all imports"), true);
});

Deno.test("import-placement reports the first import that follows code, once per file", () => {
  const source =
    'export const first = 1;\nimport { a } from "./a.ts";\nimport { b } from "./b.ts";\nexport { a, b };\n';
  const findings = findingsOf("import-placement", plainRun(source));
  assertEquals(findings.map((finding) => finding.line), [2]);
  assertEquals(findings[0].message.includes("functional code started at line 1"), true);
});

Deno.test("import-placement counts export-from statements as imports and an export list as no code", () => {
  const source = 'import { a } from "./a.ts";\nexport { a };\nexport { b } from "./b.ts";\n';
  assertEquals(linesOf("import-placement", plainRun(source)), []);
});

Deno.test("import-placement treats enums and declare statements as type definitions", () => {
  const afterImports = 'import { a } from "./a.ts";\ndeclare const g: number;\nenum E {\n  A,\n}\nexport { a };\n';
  assertEquals(linesOf("import-placement", plainRun(afterImports)), []);
  const beforeImport = 'enum E {\n  A,\n}\nimport { a } from "./a.ts";\nexport { a };\n';
  assertEquals(linesOf("import-placement", plainRun(beforeImport)), [1]);
});

Deno.test("import-placement counts a side-effect import as an import", () => {
  const source = 'import "./side.ts";\nimport { a } from "./a.ts";\nexport { a };\n';
  assertEquals(linesOf("import-placement", plainRun(source)), []);
  const late = 'export const x = 1;\nimport "./side.ts";\n';
  assertEquals(linesOf("import-placement", plainRun(late)), [2]);
});

Deno.test("import-placement accepts a file with no import and a file with only imports", () => {
  assertEquals(linesOf("import-placement", plainRun("export const a = 1;\n")), []);
  assertEquals(linesOf("import-placement", plainRun('import { a } from "./a.ts";\nexport { a };\n')), []);
});

Deno.test("exported-interface-placement reports each exported interface that follows code", () => {
  const source = [
    "export const first = 1;",
    "export interface IOne {",
    "  readonly a: number;",
    "}",
    "export function f(): void {}",
    "export interface ITwo {",
    "  readonly b: number;",
    "}",
    "",
  ].join("\n");
  assertEquals(linesOf("exported-interface-placement", plainRun(source)), [2, 6]);
});

Deno.test("exported-interface-placement accepts interfaces before code and ignores a non-exported interface", () => {
  const before = "export interface IOne {\n  readonly a: number;\n}\nexport const first = 1;\n";
  assertEquals(linesOf("exported-interface-placement", plainRun(before)), []);
  const local = "export const first = 1;\ninterface ILocal {\n  readonly a: number;\n}\n";
  assertEquals(linesOf("exported-interface-placement", plainRun(local)), []);
});

Deno.test("exported-interface-placement reports the line where the functional code started", () => {
  const source = "const first = 1;\nexport interface IOne {\n  readonly a: number;\n}\nexport { first };\n";
  const [finding] = findingsOf("exported-interface-placement", plainRun(source));
  assertEquals(finding.message.includes("functional code started at line 1"), true);
});
