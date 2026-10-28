/**
 * @module WholeTreeDuplicateBaseline
 * @path src/rules/whole_tree/duplicate_baseline.ts
 * @description Fingerprints clones and keeps a committed baseline of known clones, so the duplicate-code check can fail on a new clone while the known ones stay allowed.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [src/rules/whole_tree/duplicate_code.ts, src/cli/whole_tree.ts]
 */

import { z } from "zod";
import type { IClone, ICloneRange } from "./duplicate_code.ts";

/** The only baseline file format that this version reads and writes. */
const BASELINE_VERSION = 1;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;
const HASH_DIGITS = 16;
const HEX_RADIX = 16;
const KEY_SEPARATOR = "|";

/** One known clone, with its locations kept as text so a reviewer can read the baseline diff. */
export interface IBaselineEntry {
  id: string;
  lines: number;
  first: string;
  second: string;
}

/** The committed clones of every scan group. */
export interface IDuplicateBaseline {
  version: typeof BASELINE_VERSION;
  groups: Record<string, IBaselineEntry[]>;
}

/** The clones that one scan group measured. */
export interface IMeasuredClones {
  readonly name: string;
  readonly clones: readonly IClone[];
}

const EntrySchema: z.ZodType<IBaselineEntry, IBaselineEntry> = z.object({
  id: z.string().min(1),
  lines: z.number().int().nonnegative(),
  first: z.string(),
  second: z.string(),
}).strict();

const BaselineSchema: z.ZodType<IDuplicateBaseline, IDuplicateBaseline> = z.object({
  version: z.literal(BASELINE_VERSION),
  groups: z.record(z.string(), z.array(EntrySchema)),
}).strict();

function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(HEX_RADIX).padStart(HASH_DIGITS, "0");
}

/**
 * Identifies a clone by its two files and its code, so moving the clone inside its files, swapping the
 * pair, or changing whitespace keeps the id. A clone without code falls back to its files and length.
 */
export function fingerprintClone(
  first: ICloneRange,
  second: ICloneRange,
  fragment: string | null,
  lines: number,
): string {
  const files = [first.file, second.file].sort();
  const body = fragment === null ? `lines:${lines}` : fragment.replace(/\s+/g, "");
  return fnv1a64([...files, body].join(KEY_SEPARATOR));
}

function describe(range: ICloneRange): string {
  return `${range.file}:${range.start}-${range.end}`;
}

function toEntry(clone: IClone): IBaselineEntry {
  return { id: clone.id, lines: clone.lines, first: describe(clone.first), second: describe(clone.second) };
}

function compareEntries(left: IBaselineEntry, right: IBaselineEntry): number {
  return left.first.localeCompare(right.first) || left.second.localeCompare(right.second) ||
    left.id.localeCompare(right.id);
}

function sortedGroups(groups: Record<string, IBaselineEntry[]>): Record<string, IBaselineEntry[]> {
  const sorted: Record<string, IBaselineEntry[]> = {};
  for (const name of Object.keys(groups).sort()) sorted[name] = [...(groups[name] ?? [])].sort(compareEntries);
  return sorted;
}

/** Builds the baseline for the measured groups. Groups that the previous baseline lists but this run did not measure stay as they were. */
export function buildBaseline(
  measured: readonly IMeasuredClones[],
  previous: IDuplicateBaseline | null,
): IDuplicateBaseline {
  const groups: Record<string, IBaselineEntry[]> = { ...(previous?.groups ?? {}) };
  for (const group of measured) groups[group.name] = group.clones.map(toEntry);
  return { version: BASELINE_VERSION, groups: sortedGroups(groups) };
}

/** Writes the baseline as stable text with one entry per line, so a change shows as a readable diff. */
export function serializeBaseline(baseline: IDuplicateBaseline): string {
  const groups = sortedGroups(baseline.groups);
  const body = Object.entries(groups).map(([name, entries]) => {
    const rows = entries.map((entry) => `      ${JSON.stringify(entry)}`).join(",\n");
    return `    ${JSON.stringify(name)}: [${rows === "" ? "" : `\n${rows}\n    `}]`;
  });
  return `{\n  "version": ${BASELINE_VERSION},\n  "groups": {\n${body.join(",\n")}\n  }\n}\n`;
}

/** Reads baseline text. It rejects text that is not JSON or not a version 1 baseline. */
export function parseBaseline(text: string): IDuplicateBaseline {
  let parsed;
  try {
    parsed = BaselineSchema.safeParse(JSON.parse(text));
  } catch {
    throw new Error("The duplicate-code baseline is not valid JSON.");
  }
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`The duplicate-code baseline is invalid: ${issues.join("; ")}`);
  }
  return parsed.data;
}

function knownCounts(baseline: IDuplicateBaseline, group: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of baseline.groups[group] ?? []) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  return counts;
}

/**
 * Returns the clones that the group baseline does not cover. Pairs of one repeated block share an id, so each
 * baseline entry covers one clone and an extra copy of a known block still counts as new.
 */
export function newClones(clones: readonly IClone[], baseline: IDuplicateBaseline, group: string): IClone[] {
  const remaining = knownCounts(baseline, group);
  return clones.filter((clone) => {
    const left = remaining.get(clone.id) ?? 0;
    if (left === 0) return true;
    remaining.set(clone.id, left - 1);
    return false;
  });
}

/** Counts the baseline entries of the group that no current clone matches, which means the clone was removed. */
export function resolvedCount(clones: readonly IClone[], baseline: IDuplicateBaseline, group: string): number {
  const remaining = knownCounts(baseline, group);
  for (const clone of clones) {
    const left = remaining.get(clone.id) ?? 0;
    if (left > 0) remaining.set(clone.id, left - 1);
  }
  let resolved = 0;
  for (const left of remaining.values()) resolved += left;
  return resolved;
}
