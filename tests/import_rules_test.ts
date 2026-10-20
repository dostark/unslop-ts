/**
 * @module ImportRulesTest
 * @path tests/import_rules_test.ts
 * @description Positive, negative, and option cases for the dynamic-import, inline-type-import, and re-export rules.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/import_rules.ts, src/rules/mod.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { CatalogError } from "../mod.ts";
import { findingsOf, linesOf, plainRun, runAt } from "./helpers/rule_runner.ts";

const IMPORT_CALL = "import";
const EDITION_ENTRY = "apps/daemon/main.ts";
const TEAM_ALLOW = { allowDynamicImports: [{ files: ["apps/daemon/**"], specifiers: ["^@team/"] }] };

Deno.test("import-inside-statement reports an import call inside a function and not one at the top level", () => {
  const nested = `export function load() {\n  return ${IMPORT_CALL}("./b.ts");\n}\n`;
  assertEquals(linesOf("import-inside-statement", plainRun(nested)), [2]);
  assertEquals(linesOf("import-inside-statement", plainRun(`export const m = await ${IMPORT_CALL}("./b.ts");\n`)), []);
});

Deno.test("import-inside-statement reports an import call inside a block of an if statement", () => {
  const source = `if (Deno.args.length > 0) {\n  await ${IMPORT_CALL}("./b.ts");\n}\n`;
  assertEquals(linesOf("import-inside-statement", plainRun(source)), [2]);
});

Deno.test("import-inside-statement ignores an import type, a string, and a comment", () => {
  const source = [
    `export type T = typeof ${IMPORT_CALL}("./b.ts");`,
    `export const text = "${IMPORT_CALL}(x)";`,
    `// ${IMPORT_CALL}("./c.ts") appears in a comment`,
    "",
  ].join("\n");
  assertEquals(linesOf("import-inside-statement", plainRun(source)), []);
});

Deno.test("import-inside-statement skips an allowed specifier in an allowed file and reports the same call elsewhere", () => {
  const source = `export function load() {\n  return ${IMPORT_CALL}("@team/x");\n}\n`;
  assertEquals(linesOf("import-inside-statement", runAt(source, EDITION_ENTRY, TEAM_ALLOW)), []);
  assertEquals(linesOf("import-inside-statement", runAt(source, "packages/x/src/a.ts", TEAM_ALLOW)), [2]);
  const other = `export function load() {\n  return ${IMPORT_CALL}("@other/x");\n}\n`;
  assertEquals(linesOf("import-inside-statement", runAt(other, EDITION_ENTRY, TEAM_ALLOW)), [2]);
});

Deno.test("dynamic-import reports an import call at the top level and inside a function", () => {
  assertEquals(linesOf("dynamic-import", plainRun(`export const m = await ${IMPORT_CALL}("./b.ts");\n`)), [1]);
  assertEquals(linesOf("dynamic-import", plainRun(`export function f() {\n  return ${IMPORT_CALL}("./b.ts");\n}\n`)), [
    2,
  ]);
});

Deno.test("dynamic-import ignores an import type and a call in text", () => {
  const source = `export type T = typeof ${IMPORT_CALL}("./b.ts");\nexport const s = "${IMPORT_CALL}(x)";\n`;
  assertEquals(linesOf("dynamic-import", plainRun(source)), []);
});

Deno.test("dynamic-import applies the same file and specifier allow list as import-inside-statement", () => {
  const source = `export const m = await ${IMPORT_CALL}("@team/x");\n`;
  assertEquals(linesOf("dynamic-import", runAt(source, EDITION_ENTRY, TEAM_ALLOW)), []);
  assertEquals(linesOf("dynamic-import", runAt(source, "apps/exactl/main.ts", TEAM_ALLOW)), [1]);
});

Deno.test("dynamic-import reports a call with a computed specifier even in an allowed file", () => {
  const source = `export function f(p: string) {\n  return ${IMPORT_CALL}(p);\n}\n`;
  assertEquals(linesOf("dynamic-import", runAt(source, EDITION_ENTRY, TEAM_ALLOW)), [2]);
});

Deno.test("inline-type-import reports an import type with a member and not a typeof query or a bare module type", () => {
  assertEquals(linesOf("inline-type-import", plainRun(`export type L = Promise<${IMPORT_CALL}("./b.ts").IThing>;\n`)), [
    1,
  ]);
  assertEquals(linesOf("inline-type-import", plainRun(`export type Q = typeof ${IMPORT_CALL}("./b.ts").value;\n`)), []);
  assertEquals(linesOf("inline-type-import", plainRun(`export type N = ${IMPORT_CALL}("./b.ts");\n`)), []);
});

Deno.test("re-export-imported reports export-from forms and a re-export of an imported name", () => {
  const source = [
    'export { a } from "./a.ts";',
    'export * from "./b.ts";',
    'export type { C } from "./c.ts";',
    'import { d } from "./d.ts";',
    "export { d };",
    "",
  ].join("\n");
  assertEquals(linesOf("re-export-imported", plainRun(source)), [1, 2, 3, 5]);
});

Deno.test("re-export-imported accepts a local export and an export of a local declaration", () => {
  const source = "const local = 1;\nexport { local };\nexport const other = 2;\n";
  assertEquals(linesOf("re-export-imported", plainRun(source)), []);
});

Deno.test("re-export-imported says when the export follows its import immediately", () => {
  const source = 'import { d } from "./d.ts";\nexport { d };\n';
  const [finding] = findingsOf("re-export-imported", plainRun(source));
  assertEquals(finding.line, 2);
  assertEquals(finding.message.includes("next line after its import"), true);
});

Deno.test("an allow list with a bad shape is rejected when the catalog is parsed", () => {
  const source = "export const a = 1;\n";
  assertThrows(
    () => linesOf("dynamic-import", runAt(source, "x.ts", { allowDynamicImports: [{ files: "apps/**" }] })),
    CatalogError,
  );
  assertThrows(
    () => linesOf("re-export-imported", runAt(source, "x.ts", { allowReExports: [] })),
    CatalogError,
  );
});
