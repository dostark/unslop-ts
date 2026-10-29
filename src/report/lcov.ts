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

/** The metadata tags the parser accepts and ignores after validating their shape. */
const METADATA_TAGS: ReadonlySet<string> = new Set([
  "TN",
  "VER",
  "FN",
  "FNDA",
  "FNF",
  "FNH",
  "LF",
  "LH",
  "BRDA",
  "BRF",
  "BRH",
]);

/** The counts a metadata record carries, when it carries counts. */
const NUMERIC_METADATA: ReadonlySet<string> = new Set(["FNF", "FNH", "LF", "LH", "BRF", "BRH"]);

/** Reads one `TAG:value` line with the strict record schema. */
function parseRecord(line: string): { tag: string; value: string } {
  const separator = line.indexOf(":");
  if (separator <= 0) throw new LcovError(`malformed LCOV record: ${line.slice(0, 80)}`);
  return LcovRecordSchema.parse({ tag: line.slice(0, separator), value: line.slice(separator + 1) });
}

/** Rejects a count that is not a finite nonnegative number. */
function countOf(value: string, record: string): number {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) throw new LcovError(`${record}: '${value}' is not a nonnegative count`);
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

/** Rejects a DA record whose line or hits are not valid LCOV counts. */
function applyDaRecord(
  value: string,
  current: { readonly path: string | null },
  files: Map<string, Map<number, number>>,
): void {
  const fields = value.split(",");
  if (fields.length > 3) throw new LcovError("a DA record has more than three fields");
  const [lineValue, hitsValue] = fields;
  const lineNumber = Number(lineValue);
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
    throw new LcovError(`DA line '${lineValue}' is not a positive integer`);
  }
  const hits = countOf(hitsValue ?? "", `DA ${lineValue}`);
  const target = current.path === null ? null : files.get(current.path);
  if (target === null || target === undefined) return;
  target.set(lineNumber, (target.get(lineNumber) ?? 0) + hits);
}

/** Validates and ignores one supported metadata record. */
function applyMetadataRecord(tag: string, value: string): void {
  if (!METADATA_TAGS.has(tag)) throw new LcovError(`unknown LCOV record '${tag}'`);
  if (NUMERIC_METADATA.has(tag)) countOf(value, tag);
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
    if (record.length > MAX_LCOV_RECORD_BYTES) {
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
    if (tag === "TN" || tag === "VER") continue;
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
