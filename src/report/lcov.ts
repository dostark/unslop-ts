/**
 * @module Lcov
 * @path src/report/lcov.ts
 * @description Bounded LCOV parser that maps line coverage onto snapshot identities only.
 * @architectural-layer Tooling
 * @dependencies [zod]
 * @related-files [src/report/health.ts, src/report/crap.ts]
 */

import { fromFileUrl } from "@std/path";
import { z } from "zod";
import { normalize } from "../engine/posix_path.ts";

/** The largest accepted LCOV input. */
export const MAX_LCOV_BYTES = 256 * 1024 * 1024;

/** The largest accepted single LCOV record. */
export const MAX_LCOV_RECORD_BYTES = 1024 * 1024;

/** One line sample of a coverage file. */
export interface ILcovFileCoverage {
  readonly lines: ReadonlyMap<number, number>;
}

/** The parsed coverage of one snapshot. */
export interface ILcovCoverage {
  /** Snapshot path to the merged line hits. */
  readonly files: ReadonlyMap<string, ILcovFileCoverage>;
  /** Record paths that match no snapshot identity. */
  readonly unmatched: readonly string[];
}

/** A rejected LCOV input. */
export class LcovError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LcovError";
  }
}

/** One parsed LCOV line. */
const LcovRecordSchema = z.object({
  tag: z.string().min(1),
  value: z.string(),
}).strict();

/** The count tags, whose whole value is one nonnegative integer. */
const COUNT_TAGS: ReadonlySet<string> = new Set(["FNF", "FNH", "LF", "LH", "BRF", "BRH"]);

/** The free-form tags the parser accepts without a value grammar. */
const FREE_TAGS: ReadonlySet<string> = new Set(["TN", "VER"]);

const COUNT = /^\d+$/;
const LINE_NUMBER = /^[1-9]\d*$/;
const FN_RECORD = /^[1-9]\d*(,[1-9]\d*)?,.+$/;
const FNDA_RECORD = /^\d+,.+$/;
const BRDA_RECORD = /^[1-9]\d*,\d+,\d+,(\d+|-)$/;
const RECORD_GRAMMARS: ReadonlyMap<string, RegExp> = new Map([
  ["FN", FN_RECORD],
  ["FNDA", FNDA_RECORD],
  ["BRDA", BRDA_RECORD],
]);
const DA_FIELDS_MAX = 3;
const UTF8_BYTES_PER_UNIT_MAX = 3;

/** Reads one `TAG:value` line with the strict record schema. */
function parseRecord(line: string): { tag: string; value: string } {
  const separator = line.indexOf(":");
  if (separator <= 0) throw new LcovError(`malformed LCOV record: ${line.slice(0, 80)}`);
  return LcovRecordSchema.parse({ tag: line.slice(0, separator), value: line.slice(separator + 1) });
}

/** Rejects a count that is not a nonnegative decimal integer within the finite range. */
function countOf(value: string, record: string): number {
  const count = Number(value);
  if (!COUNT.test(value) || !Number.isFinite(count)) {
    throw new LcovError(`${record}: '${value}' is not a nonnegative count`);
  }
  return count;
}

/** Normalizes one SF value to a snapshot path, or null when it matches no snapshot. */
function normalizeLcovPath(
  value: string,
  rootPath: string,
  snapshotPaths: ReadonlySet<string>,
): string | null {
  let candidate = value.trim();
  if (candidate.startsWith("file:")) {
    try {
      candidate = fromFileUrl(candidate);
    } catch {
      return null;
    }
  }
  if (candidate.startsWith("/")) {
    const prefix = `${rootPath.replace(/\/$/, "")}/`;
    if (!candidate.startsWith(prefix)) return null;
    candidate = candidate.slice(prefix.length);
  } else {
    candidate = normalize(candidate);
  }
  candidate = candidate.replace(/^\.\//, "");
  if (candidate.startsWith("../") || candidate.startsWith("/")) return null;
  return snapshotPaths.has(candidate) ? candidate : null;
}

/** True when the path escapes the root by traversal. */
function escapesRoot(value: string): boolean {
  const normalized = normalize(value.replace(/^\.\//, ""));
  return normalized.startsWith("../") || normalized === "..";
}

/** Rejects a DA record whose line, hits or merged total are not valid finite LCOV counts. */
function applyDaRecord(
  value: string,
  current: { readonly path: string | null },
  files: Map<string, Map<number, number>>,
): void {
  const fields = value.split(",");
  if (fields.length > DA_FIELDS_MAX) throw new LcovError("a DA record has more than three fields");
  const [lineValue, hitsValue] = fields;
  if (!LINE_NUMBER.test(lineValue)) throw new LcovError(`DA line '${lineValue}' is not a positive integer`);
  if (hitsValue === undefined || hitsValue === "") throw new LcovError(`DA ${lineValue}: the hit count is missing`);
  const hits = countOf(hitsValue, `DA ${lineValue}`);
  if (fields.length === DA_FIELDS_MAX && fields[2] === "") {
    throw new LcovError(`DA ${lineValue}: the checksum is empty`);
  }
  const target = current.path === null ? null : files.get(current.path);
  if (target === null || target === undefined) return;
  const merged = (target.get(Number(lineValue)) ?? 0) + hits;
  if (!Number.isFinite(merged)) throw new LcovError(`DA ${lineValue}: the merged hit count is not finite`);
  target.set(Number(lineValue), merged);
}

/** Validates and ignores one supported metadata record against its grammar. */
function applyMetadataRecord(tag: string, value: string): void {
  if (COUNT_TAGS.has(tag)) {
    countOf(value, tag);
    return;
  }
  const grammar = RECORD_GRAMMARS.get(tag);
  if (grammar === undefined) throw new LcovError(`unknown LCOV record '${tag}'`);
  if (!grammar.test(value)) throw new LcovError(`${tag}: '${value.slice(0, 80)}' does not match the record grammar`);
}

/** Opens one SF record, attributing an outside or escaping path as unmatched. */
function startRecord(
  value: string,
  current: { readonly path: string | null } | null,
  rootPath: string,
  snapshotPaths: ReadonlySet<string>,
  files: Map<string, Map<number, number>>,
  unmatched: string[],
): { readonly path: string | null } {
  if (current !== null) throw new LcovError("SF record without the previous end_of_record");
  if (escapesRoot(value)) {
    unmatched.push(value);
    return { path: null };
  }
  const path = normalizeLcovPath(value, rootPath, snapshotPaths);
  if (path === null) unmatched.push(value);
  else if (!files.has(path)) files.set(path, new Map());
  return { path };
}

/** The UTF-8 byte length of a record, encoded only when its length could exceed the bound. */
function byteLengthOf(record: string): number {
  if (record.length * UTF8_BYTES_PER_UNIT_MAX <= MAX_LCOV_RECORD_BYTES) return record.length;
  return new TextEncoder().encode(record).byteLength;
}

/** Parses one LCOV text against the snapshot identities. */
export function parseLcov(
  text: string,
  rootPath: string,
  snapshotPaths: ReadonlySet<string>,
): ILcovCoverage {
  const files = new Map<string, Map<number, number>>();
  const unmatched: string[] = [];
  let current: { readonly path: string | null } | null = null;
  for (const record of text.split("\n")) {
    if (byteLengthOf(record) > MAX_LCOV_RECORD_BYTES) {
      throw new LcovError(`an LCOV record exceeds the ${MAX_LCOV_RECORD_BYTES} byte bound`);
    }
    const line = record.trim();
    if (line.length === 0) continue;
    if (line === "end_of_record") {
      if (current === null) throw new LcovError("end_of_record without an SF record");
      current = null;
      continue;
    }
    const { tag, value } = parseRecord(line);
    if (tag === "SF") {
      current = startRecord(value, current, rootPath, snapshotPaths, files, unmatched);
      continue;
    }
    if (FREE_TAGS.has(tag)) continue;
    if (current === null) throw new LcovError(`${tag} record outside an SF record`);
    if (tag === "DA") {
      applyDaRecord(value, current, files);
      continue;
    }
    applyMetadataRecord(tag, value);
  }
  if (current !== null) throw new LcovError("the LCOV input ends before end_of_record");
  return {
    files: new Map([...files].map(([path, lines]) => [path, { lines }])),
    unmatched,
  };
}
