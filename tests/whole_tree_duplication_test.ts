/**
 * @module WholeTreeDuplicationTest
 * @path tests/whole_tree_duplication_test.ts
 * @description Duplicate type contracts and duplicate named constants across files, with allow lists and stale-entry checks.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [src/rules/whole_tree/duplicate_type.ts, src/rules/whole_tree/duplicate_constant.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  DuplicateConstantOptionsSchema,
  DuplicateTypeOptionsSchema,
  findDuplicateConstants,
  findDuplicateTypes,
  validateConstantAllowEntries,
  validateTypeAllowEntries,
} from "../src/rules/whole_tree/mod.ts";

const A = "packages/a/src/a.ts";
const B = "packages/b/src/b.ts";
const C = "packages/c/src/c.ts";

function files(entries: Record<string, string>): { path: string; text: string }[] {
  return Object.entries(entries).map(([path, text]) => ({ path, text }));
}

Deno.test("duplicate types report the later file and the first file", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { a: string; b: number; }\n",
      [B]: "export interface IThing { a: string; b: number; }\n",
    }),
    {},
  );
  assertEquals(found, [{ name: "IThing", firstFile: A, laterFile: B }]);
});

Deno.test("duplicate types report each later file against the first one", () => {
  const found = findDuplicateTypes(
    files({
      [C]: "export interface IThing { a: string; b: number; }\n",
      [A]: "export interface IThing { a: string; b: number; }\n",
      [B]: "export interface IThing { a: string; b: number; }\n",
    }),
    {},
  );
  assertEquals(found.map((entry) => entry.laterFile), [B, C]);
  assertEquals(found.every((entry) => entry.firstFile === A), true);
});

Deno.test("member order and spacing do not matter for a duplicate type", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { readonly a: string; b: number; }\n",
      [B]: "export interface IThing { b: number; readonly  a: string;\n }\n",
    }),
    {},
  );
  assertEquals(found.length, 1);
});

Deno.test("a one-member interface is reported only when minProperties is lowered", () => {
  const sources = files({
    [A]: "export interface IThing { a: string; }\n",
    [B]: "export interface IThing { a: string; }\n",
  });
  assertEquals(findDuplicateTypes(sources, {}).length, 0);
  assertEquals(findDuplicateTypes(sources, { minProperties: 1 }).length, 1);
});

Deno.test("a different member type or name is not a duplicate type", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export interface IThing { a: string; b: number; }\n",
      [B]: "export interface IThing { a: string; b: string; }\n",
      [C]: "export interface IOther { a: string; b: number; }\n",
    }),
    {},
  );
  assertEquals(found.length, 0);
});

Deno.test("an object type alias and an interface with extends are compared on their members", () => {
  const aliases = findDuplicateTypes(
    files({
      [A]: "export type TThing = { a: string; b: number };\n",
      [B]: "export type TThing = { a: string; b: number };\n",
    }),
    {},
  );
  assertEquals(aliases.length, 1);
  const extended = findDuplicateTypes(
    files({
      [A]: "export interface IThing extends IBase { a: string; b: number; }\n",
      [B]: "export interface IThing { a: string; b: number; }\n",
    }),
    {},
  );
  assertEquals(extended.length, 1);
});

Deno.test("a nested type and a type in a comment are not top-level duplicates", () => {
  const found = findDuplicateTypes(
    files({
      [A]: "export function f() {\n  interface IThing { a: string; b: number; }\n}\n",
      [B]: "// export interface IThing { a: string; b: number; }\nexport const x = 1;\n",
    }),
    {},
  );
  assertEquals(found.length, 0);
});

Deno.test("an allowed pair of types is not reported, and a stale allow entry is named", () => {
  const sources = files({
    [A]: "export interface IThing { a: string; b: number; }\n",
    [B]: "export interface IThing { a: string; b: number; }\n",
  });
  const allow = [{ name: "IThing", files: [A, B], reason: "Edition boundary." }];
  assertEquals(findDuplicateTypes(sources, { allow }).length, 0);
  assertEquals(validateTypeAllowEntries(sources, { allow }), []);
  const stale = validateTypeAllowEntries(
    files({ [A]: "export interface IOther { a: string; b: number; }\n" }),
    { allow: [{ name: "IMISSING", files: [A, C], reason: "No longer real." }] },
  );
  assertEquals(stale, ["IMISSING"]);
});

Deno.test("an allow entry that lists a third file is still stale when the pair no longer matches", () => {
  const sources = files({
    [A]: "export interface IThing { a: string; b: number; }\n",
    [B]: "export interface IThing { a: string; b: number; }\n",
  });
  const allow = [{ name: "IThing", files: [A, B, C], reason: "Three copies once." }];
  assertEquals(validateTypeAllowEntries(sources, { allow }), ["IThing"]);
});

Deno.test("duplicate constants report the later file and the first file", () => {
  const found = findDuplicateConstants(
    files({
      [A]: "export const MAX_RETRIES = 3;\n",
      [B]: "export const MAX_RETRIES = 3;\n",
    }),
    {},
  );
  assertEquals(found, [{ name: "MAX_RETRIES", firstFile: A, laterFile: B }]);
});

Deno.test("a different value or name is not a duplicate constant", () => {
  const found = findDuplicateConstants(
    files({
      [A]: "export const MAX_RETRIES = 3;\n",
      [B]: "export const MAX_RETRIES = 4;\n",
      [C]: "export const MIN_RETRIES = 3;\n",
    }),
    {},
  );
  assertEquals(found.length, 0);
});

Deno.test("static arrays, objects, and strings compare by value, and a call or identifier does not", () => {
  const found = findDuplicateConstants(
    files({
      [A]: 'export const LIST = ["a", "b"];\nexport const TABLE = { x: 1, y: "z" };\nexport const NOW = Date.now();\n',
      [B]: 'export const LIST = ["a", "b"];\nexport const TABLE = { y: "z", x: 1 };\nexport const NOW = Date.now();\n',
    }),
    {},
  );
  assertEquals(found.map((entry) => entry.name).sort(), ["LIST", "TABLE"]);
});

Deno.test("a lower-case name is skipped by the default pattern and matched by a custom one", () => {
  const sources = files({
    [A]: "export const limit = 3;\n",
    [B]: "export const limit = 3;\n",
  });
  assertEquals(findDuplicateConstants(sources, {}).length, 0);
  assertEquals(findDuplicateConstants(sources, { namePattern: "^[a-z]+$" }).length, 1);
});

Deno.test("an allowed pair of constants is not reported, and a stale allow entry is named", () => {
  const sources = files({
    [A]: "export const MAX_RETRIES = 3;\n",
    [B]: "export const MAX_RETRIES = 3;\n",
  });
  const allow = [{ name: "MAX_RETRIES", files: [A, B], reason: "Package isolation." }];
  assertEquals(findDuplicateConstants(sources, { allow }).length, 0);
  const stale = validateConstantAllowEntries(
    files({ [A]: "export const OTHER = 1;\n" }),
    { allow: [{ name: "MISSING", files: [A, C], reason: "No longer real." }] },
  );
  assertEquals(stale, ["MISSING"]);
});

Deno.test("the option schemas apply defaults and reject an unknown key or an allow entry without a reason", () => {
  assertEquals(DuplicateTypeOptionsSchema.parse({}), { minProperties: 2, allow: [] });
  assertEquals(DuplicateConstantOptionsSchema.parse({}), { namePattern: "^[A-Z][A-Z0-9_]*$", allow: [] });
  assertThrows(() => DuplicateTypeOptionsSchema.parse({ nope: 1 }));
  assertThrows(() => DuplicateConstantOptionsSchema.parse({ allow: [{ name: "X", files: [A] }] }));
});
