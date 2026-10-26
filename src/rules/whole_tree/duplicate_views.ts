/**
 * @module WholeTreeDuplicateViews
 * @path src/rules/whole_tree/duplicate_views.ts
 * @description Turns the clone pairs of a duplicate-code group into a per-file ranking or into blocks with a copy count.
 * @architectural-layer Shared
 * @related-files [src/rules/whole_tree/duplicate_code.ts, src/cli/whole_tree.ts]
 */

import type { IClone, ICloneRange } from "./duplicate_code.ts";

/** How the clones of a group are listed. */
export type DuplicateView = "pair" | "file" | "block";

const VIEWS: readonly DuplicateView[] = ["pair", "file", "block"];

/** One file and how much of it other code repeats. */
export interface IFileDuplication {
  readonly file: string;
  /** Lines of the file that sit in at least one clone. */
  readonly duplicatedLines: number;
  /** Clone pairs that touch the file. */
  readonly clones: number;
  /** Other files that share a clone with it, not counting itself. */
  readonly partners: number;
}

/** One block of code and every place it appears. */
export interface IDuplicateBlock {
  readonly copies: number;
  /** The length of the longest copy. */
  readonly lines: number;
  readonly locations: readonly ICloneRange[];
}

/** Reads the `--by` value. Nothing means the pair view and an unknown value gives null. */
export function parseView(value: string | undefined): DuplicateView | null {
  if (value === undefined) return "pair";
  return VIEWS.find((view) => view === value) ?? null;
}

/** Ranks files by the union of the lines that clones cover, most first, ties by path. */
export function rankFiles(clones: readonly IClone[]): IFileDuplication[] {
  const lines = new Map<string, Set<number>>();
  const cloneCount = new Map<string, number>();
  const partners = new Map<string, Set<string>>();
  const touch = (range: ICloneRange, other: ICloneRange): void => {
    const covered = lines.get(range.file) ?? new Set<number>();
    for (let line = range.start; line <= range.end; line++) covered.add(line);
    lines.set(range.file, covered);
    cloneCount.set(range.file, (cloneCount.get(range.file) ?? 0) + 1);
    const others = partners.get(range.file) ?? new Set<string>();
    if (other.file !== range.file) others.add(other.file);
    partners.set(range.file, others);
  };
  for (const clone of clones) {
    touch(clone.first, clone.second);
    touch(clone.second, clone.first);
  }
  return [...lines.entries()]
    .map(([file, covered]) => ({
      file,
      duplicatedLines: covered.size,
      clones: cloneCount.get(file) ?? 0,
      partners: partners.get(file)?.size ?? 0,
    }))
    .sort((left, right) => right.duplicatedLines - left.duplicatedLines || left.file.localeCompare(right.file));
}

/** The share of the shorter range that two ranges of one file must overlap to count as the same region. */
const SAME_REGION_OVERLAP = 0.8;

function overlapsEnough(region: ICloneRange, range: ICloneRange): boolean {
  const overlap = Math.min(region.end, range.end) - Math.max(region.start, range.start) + 1;
  const shorter = Math.min(region.end - region.start, range.end - range.start) + 1;
  return overlap >= SAME_REGION_OVERLAP * shorter;
}

/**
 * Groups the ranges of each file into regions. A range joins a region when it overlaps the region's first
 * range by at least {@link SAME_REGION_OVERLAP} of the shorter one, so shifted copies of one block share a
 * region but a range that only touches a block does not chain two different blocks together.
 */
function mergeRanges(clones: readonly IClone[]): Map<string, ICloneRange[]> {
  const byFile = new Map<string, ICloneRange[]>();
  for (const clone of clones) {
    for (const range of [clone.first, clone.second]) {
      byFile.set(range.file, [...(byFile.get(range.file) ?? []), range]);
    }
  }
  const merged = new Map<string, ICloneRange[]>();
  for (const [file, ranges] of byFile) {
    const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
    const heads: ICloneRange[] = [];
    const spans: ICloneRange[] = [];
    for (const range of sorted) {
      const index = heads.findIndex((head) => overlapsEnough(head, range));
      if (index < 0) {
        heads.push(range);
        spans.push({ file, start: range.start, end: range.end });
      } else {
        const span = spans[index]!;
        spans[index] = { file, start: Math.min(span.start, range.start), end: Math.max(span.end, range.end) };
      }
    }
    merged.set(file, spans);
  }
  return merged;
}

function findRegion(merged: Map<string, ICloneRange[]>, range: ICloneRange): string {
  const regions = merged.get(range.file) ?? [];
  const index = regions.findIndex((region) => overlapsEnough(region, range));
  return `${range.file}#${index}`;
}

/** Groups clone pairs that share a region into blocks, ordered by the lines that removing the extra copies saves. */
export function collapseBlocks(clones: readonly IClone[]): IDuplicateBlock[] {
  const merged = mergeRanges(clones);
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const up = parent.get(key) ?? key;
    if (up === key) return key;
    const root = find(up);
    parent.set(key, root);
    return root;
  };
  const regionRange = new Map<string, ICloneRange>();
  for (const [file, regions] of merged) {
    regions.forEach((region, index) => regionRange.set(`${file}#${index}`, region));
  }
  for (const clone of clones) {
    const first = find(findRegion(merged, clone.first));
    const second = find(findRegion(merged, clone.second));
    if (first !== second) parent.set(first, second);
  }
  const components = new Map<string, ICloneRange[]>();
  for (const [key, range] of regionRange) {
    const root = find(key);
    components.set(root, [...(components.get(root) ?? []), range]);
  }
  return [...components.values()]
    .map((locations) => ({
      copies: locations.length,
      lines: Math.max(...locations.map((range) => range.end - range.start + 1)),
      locations: [...locations].sort((left, right) => left.file.localeCompare(right.file) || left.start - right.start),
    }))
    .filter((block) => block.copies > 1)
    .sort((left, right) =>
      (right.copies - 1) * right.lines - (left.copies - 1) * left.lines ||
      left.locations[0]!.file.localeCompare(right.locations[0]!.file)
    );
}
