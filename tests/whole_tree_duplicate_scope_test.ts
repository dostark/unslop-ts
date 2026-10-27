/**
 * @module WholeTreeDuplicateScopeTest
 * @path tests/whole_tree_duplicate_scope_test.ts
 * @description The duplicate-code check attributes a file to a scan group by the group paths, ignore globs, and pattern, and keeps the clones whose two copies sit in different groups.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/duplicate_scope.ts]
 */

import { assertEquals } from "@std/assert";
import type { IClone } from "../src/rules/whole_tree/duplicate_code.ts";
import { crossGroupClones, groupOf } from "../src/rules/whole_tree/duplicate_scope.ts";
import type { IDuplicateCodeGroup } from "../src/rules/whole_tree/options.ts";

function group(overrides: Partial<IDuplicateCodeGroup>): IDuplicateCodeGroup {
  return {
    name: "source",
    paths: ["packages/"],
    ignore: [],
    pattern: null,
    minLines: null,
    maxGapLines: null,
    threshold: 2,
    ...overrides,
  };
}

const SOURCE = group({ name: "source", paths: ["packages/"], ignore: ["**/tests/**", "**/*.d.ts"] });
const TESTS = group({ name: "tests", paths: ["packages/"], pattern: "**/tests/**/*.ts", minLines: 10 });
const INTEGRATION = group({ name: "integration", paths: ["tests/integration"], minLines: 10 });
const GROUPS = [SOURCE, TESTS, INTEGRATION];

function clone(firstFile: string, secondFile: string, lines: number): IClone {
  return {
    id: `${firstFile}|${secondFile}`,
    lines,
    first: { file: firstFile, start: 1, end: lines },
    second: { file: secondFile, start: 1, end: lines },
  };
}

Deno.test("a file belongs to the first group whose paths, ignore globs, and pattern accept it", () => {
  assertEquals(groupOf("packages/core/src/a.ts", GROUPS)?.name, "source");
  assertEquals(groupOf("packages/core/tests/a_test.ts", GROUPS)?.name, "tests");
  assertEquals(groupOf("tests/integration/flow_test.ts", GROUPS)?.name, "integration");
});

Deno.test("a file that every group rejects belongs to no group", () => {
  assertEquals(groupOf("docs/readme.ts", GROUPS), null);
  assertEquals(groupOf("packages/core/src/types.d.ts", GROUPS), null);
  assertEquals(groupOf("packages/core/tests/data.json", GROUPS), null);
});

Deno.test("a group path matches a directory with or without a trailing slash and a single file", () => {
  assertEquals(groupOf("tests/integration/a.ts", [INTEGRATION])?.name, "integration");
  assertEquals(groupOf("tests/integration_extra/a.ts", [INTEGRATION]), null);
  assertEquals(groupOf("scripts/ci.ts", [group({ name: "one", paths: ["scripts/ci.ts"] })])?.name, "one");
});

Deno.test("cross-group clones keep only the pairs whose copies sit in different groups", () => {
  const within = clone("packages/a/src/x.ts", "packages/b/src/y.ts", 12);
  const across = clone("packages/a/src/x.ts", "packages/a/tests/x_test.ts", 12);
  const outside = clone("packages/a/src/x.ts", "docs/z.ts", 12);
  assertEquals(crossGroupClones([within, across, outside], GROUPS), [across]);
});

Deno.test("a cross-group clone must reach the larger of the two group minimums", () => {
  const shortAcross = clone("packages/a/src/x.ts", "packages/a/tests/x_test.ts", 7);
  const longAcross = clone("packages/a/src/x.ts", "packages/a/tests/x_test.ts", 10);
  assertEquals(crossGroupClones([shortAcross, longAcross], GROUPS, 5), [longAcross]);
});
