/**
 * @module WholeTreeDuplicateBaselineTest
 * @path tests/whole_tree_duplicate_baseline_test.ts
 * @description Clone fingerprints and the committed baseline let the duplicate-code check fail on a new clone while known clones stay allowed.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/duplicate_baseline.ts]
 */

import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import type { IClone } from "../src/rules/whole_tree/duplicate_code.ts";
import {
  buildBaseline,
  fingerprintClone,
  newClones,
  parseBaseline,
  resolvedCount,
  serializeBaseline,
} from "../src/rules/whole_tree/duplicate_baseline.ts";

const A = { file: "packages/a.ts", start: 1, end: 7 };
const B = { file: "packages/b.ts", start: 3, end: 9 };

function clone(id: string, lines = 7, first = A, second = B): IClone {
  return { id, lines, first, second };
}

Deno.test("a fingerprint is stable when the clone moves, when the pair swaps, and when whitespace changes", () => {
  const original = fingerprintClone(A, B, "const x = 1;\nreturn x;", 7);
  assertEquals(fingerprintClone({ ...A, start: 40, end: 46 }, B, "const x = 1;\nreturn x;", 7), original);
  assertEquals(fingerprintClone(B, A, "const x = 1;\nreturn x;", 7), original);
  assertEquals(fingerprintClone(A, B, "  const x = 1;\n\n  return   x;", 7), original);
  assert(/^[0-9a-f]{16}$/.test(original));
});

Deno.test("a fingerprint changes with the cloned code and with the files", () => {
  const original = fingerprintClone(A, B, "const x = 1;", 7);
  assertNotEquals(fingerprintClone(A, B, "const y = 2;", 7), original);
  assertNotEquals(fingerprintClone(A, { ...B, file: "packages/c.ts" }, "const x = 1;", 7), original);
});

Deno.test("a clone without a fragment is fingerprinted from its files and length", () => {
  assertNotEquals(fingerprintClone(A, B, null, 7), fingerprintClone(A, B, null, 8));
  assertEquals(fingerprintClone(A, B, null, 7), fingerprintClone(B, A, null, 7));
});

Deno.test("a baseline round-trips through its file text with groups and entries sorted", () => {
  const baseline = buildBaseline(
    [{ name: "tests", clones: [clone("bb"), clone("aa")] }, { name: "source", clones: [clone("cc")] }],
    null,
  );
  const text = serializeBaseline(baseline);
  assertEquals(parseBaseline(text), baseline);
  assertEquals(Object.keys(baseline.groups), ["source", "tests"]);
  assertEquals(baseline.groups.tests?.map((entry) => entry.id), ["aa", "bb"]);
  assertEquals(serializeBaseline(parseBaseline(text)), text);
});

Deno.test("a baseline entry keeps the clone locations for review", () => {
  const baseline = buildBaseline([{ name: "source", clones: [clone("aa", 7)] }], null);
  assertEquals(baseline.groups.source, [{
    id: "aa",
    lines: 7,
    first: "packages/a.ts:1-7",
    second: "packages/b.ts:3-9",
  }]);
});

Deno.test("updating the baseline replaces the measured groups and keeps the others", () => {
  const previous = buildBaseline(
    [{ name: "source", clones: [clone("old")] }, { name: "tests", clones: [clone("t1")] }],
    null,
  );
  const updated = buildBaseline([{ name: "source", clones: [clone("new")] }], previous);
  assertEquals(updated.groups.source?.map((entry) => entry.id), ["new"]);
  assertEquals(updated.groups.tests?.map((entry) => entry.id), ["t1"]);
});

Deno.test("only clones missing from the group baseline are new, and gone entries are counted as resolved", () => {
  const baseline = buildBaseline([{ name: "source", clones: [clone("known"), clone("gone")] }], null);
  const current = [clone("known"), clone("fresh")];
  assertEquals(newClones(current, baseline, "source").map((entry) => entry.id), ["fresh"]);
  assertEquals(resolvedCount(current, baseline, "source"), 1);
});

Deno.test("a group that the baseline does not list treats every clone as new", () => {
  const baseline = buildBaseline([{ name: "source", clones: [clone("known")] }], null);
  assertEquals(newClones([clone("known")], baseline, "tests").length, 1);
  assertEquals(resolvedCount([clone("known")], baseline, "tests"), 0);
});

Deno.test("parsing rejects text that is not a version 1 baseline", () => {
  assertThrows(() => parseBaseline("not json"), Error, "baseline");
  assertThrows(() => parseBaseline(JSON.stringify({ version: 2, groups: {} })), Error, "version");
  assertThrows(() => parseBaseline(JSON.stringify({ version: 1 })), Error, "baseline");
  assertThrows(
    () => parseBaseline(JSON.stringify({ version: 1, groups: { source: [{ id: 5 }] } })),
    Error,
    "baseline",
  );
});
