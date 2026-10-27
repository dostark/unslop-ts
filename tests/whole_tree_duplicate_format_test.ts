/**
 * @module WholeTreeDuplicateFormatTest
 * @path tests/whole_tree_duplicate_format_test.ts
 * @description The duplicate-code report converts to a plain JSON document that tools can read, with the figures, the clones, and the new-clone flags.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/duplicate_format.ts]
 */

import { assertEquals } from "@std/assert";
import type {
  IClone,
  IDuplicateCodeGroupResult,
  IDuplicateCodeReport,
} from "../src/rules/whole_tree/duplicate_code.ts";
import { toJsonReport } from "../src/rules/whole_tree/duplicate_format.ts";

function clone(id: string, lines: number): IClone {
  return {
    id,
    lines,
    first: { file: "packages/a.ts", start: 1, end: lines },
    second: { file: "packages/b.ts", start: 5, end: 4 + lines },
  };
}

function groupResult(overrides: Partial<IDuplicateCodeGroupResult>): IDuplicateCodeGroupResult {
  return {
    name: "source",
    percentage: 1.5,
    threshold: 2,
    passed: true,
    duplicatedLines: 30,
    totalLines: 1000,
    involvedLines: 50,
    involvedPercentage: 5,
    clones: [clone("aa", 12), clone("bb", 6)],
    newClones: [],
    resolvedClones: 0,
    ...overrides,
  };
}

Deno.test("the JSON report carries each group's figures, its clones, and the overall verdict", () => {
  const report: IDuplicateCodeReport = { groups: [groupResult({})], cross: null };
  const json = toJsonReport(report, 1);
  assertEquals(json.passed, true);
  assertEquals(json.crossGroup, null);
  assertEquals(json.groups[0], {
    name: "source",
    passed: true,
    threshold: 2,
    percentage: 1.5,
    involvedPercentage: 5,
    duplicatedLines: 30,
    involvedLines: 50,
    totalLines: 1000,
    newClones: 0,
    resolvedClones: 0,
    clones: [
      {
        id: "aa",
        lines: 12,
        isNew: false,
        first: { file: "packages/a.ts", start: 1, end: 12 },
        second: { file: "packages/b.ts", start: 5, end: 16 },
      },
      {
        id: "bb",
        lines: 6,
        isNew: false,
        first: { file: "packages/a.ts", start: 1, end: 6 },
        second: { file: "packages/b.ts", start: 5, end: 10 },
      },
    ],
  });
});

Deno.test("a clone in the new list is flagged and a failed group fails the report", () => {
  const fresh = clone("bb", 6);
  const report: IDuplicateCodeReport = {
    groups: [groupResult({ passed: false, newClones: [fresh], resolvedClones: 2 })],
    cross: null,
  };
  const json = toJsonReport(report, 1);
  assertEquals(json.passed, false);
  assertEquals(json.groups[0]?.newClones, 1);
  assertEquals(json.groups[0]?.resolvedClones, 2);
  assertEquals(json.groups[0]?.clones.map((entry) => [entry.id, entry.isNew]), [["aa", false], ["bb", true]]);
});

Deno.test("the listing minimum drops short clones from the JSON and leaves the figures alone", () => {
  const json = toJsonReport({ groups: [groupResult({})], cross: null }, 10);
  assertEquals(json.groups[0]?.clones.map((entry) => entry.id), ["aa"]);
  assertEquals(json.groups[0]?.duplicatedLines, 30);
});

Deno.test("the cross-group result appears in the JSON and a failed cross-group pass fails the report", () => {
  const cross = { clones: [clone("xx", 12)], newClones: [clone("xx", 12)], resolvedClones: 0, passed: false };
  const json = toJsonReport({ groups: [groupResult({})], cross }, 1);
  assertEquals(json.passed, false);
  assertEquals(json.crossGroup?.newClones, 1);
  assertEquals(json.crossGroup?.clones.map((entry) => [entry.id, entry.isNew]), [["xx", true]]);
});
