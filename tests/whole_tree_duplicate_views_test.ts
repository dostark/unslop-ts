/**
 * @module WholeTreeDuplicateViewsTest
 * @path tests/whole_tree_duplicate_views_test.ts
 * @description The duplicate-code views rank files by duplicated lines and collapse overlapping clone pairs into blocks with a copy count.
 * @architectural-layer Test
 * @related-files [src/rules/whole_tree/duplicate_views.ts, src/rules/whole_tree/duplicate_code.ts]
 */

import { assertEquals } from "@std/assert";
import type { IClone } from "../src/rules/whole_tree/duplicate_code.ts";
import { collapseBlocks, parseView, rankFiles } from "../src/rules/whole_tree/duplicate_views.ts";

function clone(a: string, aStart: number, aEnd: number, b: string, bStart: number, bEnd: number): IClone {
  return {
    lines: aEnd - aStart + 1,
    first: { file: a, start: aStart, end: aEnd },
    second: { file: b, start: bStart, end: bEnd },
  };
}

Deno.test("files are ranked by the union of their duplicated lines", () => {
  const ranked = rankFiles([clone("a.ts", 1, 10, "b.ts", 1, 10), clone("a.ts", 5, 12, "c.ts", 20, 27)]);
  assertEquals(ranked.map((row) => [row.file, row.duplicatedLines, row.clones, row.partners]), [
    ["a.ts", 12, 2, 2],
    ["b.ts", 10, 1, 1],
    ["c.ts", 8, 1, 1],
  ]);
});

Deno.test("files with equal duplicated lines are ordered by path", () => {
  const ranked = rankFiles([clone("z.ts", 1, 5, "y.ts", 1, 5)]);
  assertEquals(ranked.map((row) => row.file), ["y.ts", "z.ts"]);
});

Deno.test("three pairwise copies of one block collapse into one block with three copies", () => {
  const blocks = collapseBlocks([
    clone("a.ts", 1, 10, "b.ts", 1, 10),
    clone("a.ts", 1, 10, "c.ts", 1, 10),
    clone("b.ts", 1, 10, "c.ts", 1, 10),
  ]);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0]?.copies, 3);
  assertEquals(blocks[0]?.lines, 10);
  assertEquals(blocks[0]?.locations.map((range) => range.file), ["a.ts", "b.ts", "c.ts"]);
});

Deno.test("overlapping ranges in one file merge into one copy of the block", () => {
  const blocks = collapseBlocks([clone("a.ts", 1, 10, "b.ts", 1, 10), clone("a.ts", 3, 12, "c.ts", 3, 12)]);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0]?.copies, 3);
  assertEquals(blocks[0]?.locations[0], { file: "a.ts", start: 1, end: 12 });
});

Deno.test("a range that only partly overlaps a block does not chain two blocks together", () => {
  const blocks = collapseBlocks([
    clone("a.ts", 1, 10, "b.ts", 1, 10),
    clone("a.ts", 9, 40, "c.ts", 9, 40),
  ]);
  assertEquals(blocks.map((block) => [block.copies, block.lines]), [[2, 32], [2, 10]]);
});

Deno.test("a block copied inside one file counts both ranges", () => {
  const blocks = collapseBlocks([clone("a.ts", 1, 10, "a.ts", 30, 39)]);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0]?.copies, 2);
});

Deno.test("unrelated clones stay separate blocks, ordered by removable lines", () => {
  const blocks = collapseBlocks([
    clone("a.ts", 1, 5, "b.ts", 1, 5),
    clone("c.ts", 1, 40, "d.ts", 1, 40),
    clone("e.ts", 1, 6, "f.ts", 1, 6),
    clone("e.ts", 1, 6, "g.ts", 1, 6),
    clone("f.ts", 1, 6, "g.ts", 1, 6),
  ]);
  assertEquals(blocks.map((block) => [block.copies, block.lines]), [[2, 40], [3, 6], [2, 5]]);
});

Deno.test("parseView accepts pair, file, and block and rejects anything else", () => {
  assertEquals(parseView(undefined), "pair");
  assertEquals(parseView("file"), "file");
  assertEquals(parseView("block"), "block");
  assertEquals(parseView("group"), null);
});
