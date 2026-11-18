/**
 * @module CycleBaseline
 * @path src/rules/whole_tree/cycle_baseline.ts
 * @description Strict import-cycle baseline model, root-confined path guard, atomic write and deterministic text.
 * @architectural-layer Shared
 * @dependencies [zod, @std/path]
 * @related-files [src/rules/whole_tree/import_cycles.ts, src/rules/whole_tree/cycle_report.ts, src/cli/whole_tree.ts]
 */

import { basename, dirname, join } from "@std/path";
import { z } from "zod";
import type { JsonValue } from "../../engine/catalog.ts";
import type { ICycleAnalysis, ICycleFinding, IUnresolvedRef } from "./import_cycles.ts";

/** The cycle scope an entry kind names. Only a runtime cycle fails the gate. */
export type TBaselineCycleKind = "runtime";

/** One known runtime cycle, keyed by the stable member hash. */
export interface ICycleBaselineEntry {
  readonly id: string;
  readonly kind: TBaselineCycleKind;
  /** Sorted repo-relative POSIX paths. */
  readonly files: readonly string[];
}

/** One reviewed unresolved reference that the completeness rule tolerates. */
export interface IAllowedUnresolved {
  readonly specifier: string;
  readonly from: string;
  readonly reason: string;
}

/** A measured cycle whose region no longer matches one baseline entry. */
export interface IChangedCycle {
  readonly id: string;
  readonly expected: readonly string[];
  readonly actual: readonly string[];
}

/** The comparison of one analysis with the committed baseline. */
export interface ICycleGate {
  readonly matched: number;
  readonly added: readonly ICycleFinding[];
  readonly changed: readonly IChangedCycle[];
  readonly stale: readonly ICycleBaselineEntry[];
  readonly unlisted_unresolved: readonly IUnresolvedRef[];
  readonly passed: boolean;
}

/** Which roots gate, and whether a new or a stale entry fails the run. */
export interface ICycleGateOptions {
  readonly gateRoots: readonly string[];
  readonly failOnNew: boolean;
  readonly failOnStale: boolean;
}

/** The committed import-cycle baseline. It carries no timestamp and no tool version. */
export interface ICycleBaseline {
  readonly version: typeof CYCLE_BASELINE_VERSION;
  readonly allowed_unresolved: readonly IAllowedUnresolved[];
  readonly cycles: readonly ICycleBaselineEntry[];
}

/** A baseline rejection. The exit code follows the check contract: 2 for a path or usage fault, 1 for a bad file. */
export class CycleBaselineError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
    this.name = "CycleBaselineError";
  }
}

/** The baseline file does not exist yet, so an update starts from an empty allowlist. */
export class CycleBaselineMissingError extends CycleBaselineError {}

/** The only baseline file format this version reads and writes. */
export const CYCLE_BASELINE_VERSION = 1;

/** The largest baseline file this version reads or writes. */
export const MAX_CYCLE_BASELINE_BYTES = 1024 * 1024;

/** The largest number of cycles this version stores. */
export const MAX_CYCLE_BASELINE_CYCLES = 10_000;

const CYCLE_ID_PATTERN = /^cyc-[0-9a-f]{16}$/;
const DRIVE_LETTER = /^[A-Za-z]:/;
const INSIDE_MESSAGE = "inside the project root";

const CycleEntrySchema: z.ZodType<ICycleBaselineEntry, ICycleBaselineEntry> = z.object({
  id: z.string().regex(CYCLE_ID_PATTERN),
  kind: z.literal("runtime"),
  files: z.array(z.string().min(1)).min(1),
}).strict();

const AllowedUnresolvedSchema: z.ZodType<IAllowedUnresolved, IAllowedUnresolved> = z.object({
  specifier: z.string().min(1),
  from: z.string().min(1),
  reason: z.string().min(1),
}).strict();

const CycleBaselineSchema: z.ZodType<ICycleBaseline, ICycleBaseline> = z.object({
  version: z.literal(CYCLE_BASELINE_VERSION),
  allowed_unresolved: z.array(AllowedUnresolvedSchema),
  cycles: z.array(CycleEntrySchema),
}).strict();

/** True when a repository-relative POSIX path stays inside the root. */
function isRepoRelative(path: string): boolean {
  if (path === "" || path.startsWith("/") || DRIVE_LETTER.test(path)) return false;
  return !path.split("/").includes("..");
}

function compareUnresolved(left: IAllowedUnresolved, right: IAllowedUnresolved): number {
  return left.from.localeCompare(right.from) || left.specifier.localeCompare(right.specifier);
}

/** Rejects a semantic fault that the shape schema cannot see. */
function validateSemantics(baseline: ICycleBaseline): void {
  if (baseline.cycles.length > MAX_CYCLE_BASELINE_CYCLES) {
    throw new CycleBaselineError(
      `The import-cycle baseline holds more than ${MAX_CYCLE_BASELINE_CYCLES} cycles.`,
      1,
    );
  }
  const ids = new Set<string>();
  for (const cycle of baseline.cycles) {
    if (ids.has(cycle.id)) {
      throw new CycleBaselineError(`The import-cycle baseline lists a duplicate cycle id '${cycle.id}'.`, 1);
    }
    ids.add(cycle.id);
    if (!cycle.files.every(isRepoRelative)) {
      throw new CycleBaselineError(
        `The import-cycle baseline names a file that is not ${INSIDE_MESSAGE}: '${cycle.id}'.`,
        1,
      );
    }
    const sorted = [...cycle.files].sort((left, right) => left.localeCompare(right));
    const unique = new Set(cycle.files).size === cycle.files.length;
    if (!unique || sorted.some((file, index) => file !== cycle.files[index])) {
      throw new CycleBaselineError(`The import-cycle baseline files of '${cycle.id}' must be sorted and unique.`, 1);
    }
  }
}

/** Parses baseline text and rejects a wrong version, a non-runtime cycle, a duplicate, an unsorted list and an escape. */
export function parseCycleBaseline(text: string): ICycleBaseline {
  if (new TextEncoder().encode(text).length > MAX_CYCLE_BASELINE_BYTES) {
    throw new CycleBaselineError(`The import-cycle baseline exceeds ${MAX_CYCLE_BASELINE_BYTES} bytes.`, 1);
  }
  let value: JsonValue;
  try {
    value = JSON.parse(text) as JsonValue;
  } catch {
    throw new CycleBaselineError("The import-cycle baseline is not valid JSON.", 1);
  }
  const parsed = CycleBaselineSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new CycleBaselineError(`The import-cycle baseline is invalid: ${issues.join("; ")}`, 1);
  }
  validateSemantics(parsed.data);
  return parsed.data;
}

/** Serializes the baseline with sorted lists and no timestamp, so a regeneration is a reviewable diff. */
export function serializeCycleBaseline(baseline: ICycleBaseline): string {
  const document: ICycleBaseline = {
    version: CYCLE_BASELINE_VERSION,
    allowed_unresolved: [...baseline.allowed_unresolved].sort(compareUnresolved),
    cycles: [...baseline.cycles]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((cycle) => ({ id: cycle.id, kind: cycle.kind, files: [...cycle.files] })),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** True when every member of a cycle lies under a gate root, or when no root is configured. */
function isGateable(finding: ICycleFinding, gateRoots: readonly string[]): boolean {
  if (gateRoots.length === 0) return true;
  return finding.files.every((file) => gateRoots.some((root) => file.startsWith(root)));
}

/** True when two member lists name the same files. */
function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((file, index) => file === right[index]);
}

/** True when a measured cycle and a baseline entry share at least one file, which marks the same region. */
function sharesFile(left: readonly string[], right: readonly string[]): boolean {
  return left.some((file) => right.includes(file));
}

/** Builds the baseline from the gateable runtime cycles of one analysis and the reviewed allowlist. */
export function buildCycleBaseline(
  analysis: ICycleAnalysis,
  allowed: readonly IAllowedUnresolved[] = [],
  gateRoots: readonly string[] = [],
): ICycleBaseline {
  const cycles = analysis.cycles
    .filter((cycle) => cycle.kind === "runtime" && isGateable(cycle, gateRoots))
    .map((cycle: ICycleFinding) => ({
      id: cycle.id,
      kind: "runtime" as const,
      files: [...cycle.files],
    }));
  return { version: CYCLE_BASELINE_VERSION, allowed_unresolved: [...allowed].sort(compareUnresolved), cycles };
}

/** The canonical root, which every guard compares against. */
async function realRoot(repoRoot: string): Promise<string> {
  try {
    return await Deno.realPath(repoRoot);
  } catch {
    throw new CycleBaselineError(`The project root '${repoRoot}' is not readable.`, 2);
  }
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Resolves a baseline path under the root; an absolute, escaping or symlinked-out path is rejected. */
export async function resolveInsideRoot(repoRoot: string, relative: string): Promise<string> {
  if (!isRepoRelative(relative) || relative === ".") {
    throw new CycleBaselineError(
      `The import-cycle baseline path '${relative}' must stay ${INSIDE_MESSAGE}.`,
      2,
    );
  }
  const root = await realRoot(repoRoot);
  const parent = dirname(join(root, relative));
  let realParent: string;
  try {
    realParent = await Deno.realPath(parent);
  } catch {
    throw new CycleBaselineError(`The import-cycle baseline directory '${parent}' does not exist.`, 2);
  }
  if (!isInside(realParent, root)) {
    throw new CycleBaselineError(
      `The import-cycle baseline path '${relative}' must stay ${INSIDE_MESSAGE}.`,
      2,
    );
  }
  const target = join(realParent, basename(relative));
  try {
    const real = await Deno.realPath(target);
    if (!isInside(real, root)) {
      throw new CycleBaselineError(
        `The import-cycle baseline path '${relative}' must stay ${INSIDE_MESSAGE}.`,
        2,
      );
    }
    return real;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return target;
    throw error;
  }
}

/** Reads and validates one baseline under the repository root. */
export async function loadCycleBaseline(repoRoot: string, relative: string): Promise<ICycleBaseline> {
  const path = await resolveInsideRoot(repoRoot, relative);
  const info = await Deno.lstat(path).catch(() => null);
  if (info === null) {
    throw new CycleBaselineMissingError(
      `The import-cycle baseline '${relative}' cannot be read; create it with --update-baseline.`,
      1,
    );
  }
  if (!info.isFile) {
    throw new CycleBaselineError(`The import-cycle baseline '${relative}' is not a regular file.`, 1);
  }
  if (info.size > MAX_CYCLE_BASELINE_BYTES) {
    throw new CycleBaselineError(`The import-cycle baseline exceeds ${MAX_CYCLE_BASELINE_BYTES} bytes.`, 1);
  }
  return parseCycleBaseline(await Deno.readTextFile(path));
}

/** Writes the baseline atomically through a sibling temporary file, and returns the canonical path. */
export async function saveCycleBaseline(
  repoRoot: string,
  relative: string,
  baseline: ICycleBaseline,
): Promise<string> {
  const path = await resolveInsideRoot(repoRoot, relative);
  const temporary = `${path}.tmp`;
  await Deno.writeTextFile(temporary, serializeCycleBaseline(baseline));
  try {
    await Deno.rename(temporary, path);
  } catch (error) {
    await Deno.remove(temporary).catch(() => {});
    throw error;
  }
  return path;
}

/** Compares the gated runtime cycles with the baseline: matched, changed, new and stale. */
export function compareToBaseline(
  analysis: ICycleAnalysis,
  baseline: ICycleBaseline,
  options: ICycleGateOptions,
): ICycleGate {
  const gated = analysis.cycles.filter((cycle) => cycle.kind === "runtime" && isGateable(cycle, options.gateRoots));
  const remaining = new Map(baseline.cycles.map((cycle) => [cycle.id, cycle]));
  const added: ICycleFinding[] = [];
  const changed: IChangedCycle[] = [];
  let matched = 0;
  for (const finding of gated) {
    const entry = remaining.get(finding.id);
    if (entry !== undefined) {
      remaining.delete(finding.id);
      if (sameMembers(entry.files, finding.files)) matched++;
      else changed.push({ id: finding.id, expected: entry.files, actual: finding.files });
      continue;
    }
    const replaced = [...remaining.values()].find((candidate) => sharesFile(candidate.files, finding.files));
    if (replaced === undefined) {
      added.push(finding);
      continue;
    }
    remaining.delete(replaced.id);
    changed.push({ id: finding.id, expected: replaced.files, actual: finding.files });
  }
  const stale = [...remaining.values()].sort((left, right) => left.id.localeCompare(right.id));
  const allowedKeys = new Set(baseline.allowed_unresolved.map((entry) => `${entry.from}\u0000${entry.specifier}`));
  const unlisted_unresolved = analysis.graph.unresolved_refs.filter((reference) =>
    !allowedKeys.has(`${reference.from}\u0000${reference.specifier}`)
  );
  const uncatalogued = analysis.graph.unresolved > analysis.graph.unresolved_refs.length;
  const incomplete = unlisted_unresolved.length > 0 || uncatalogued ||
    analysis.graph.unresolved > baseline.allowed_unresolved.length;
  const cyclesPassed = !options.failOnNew || (added.length === 0 && changed.length === 0);
  const stalePassed = !options.failOnStale || stale.length === 0;
  return {
    matched,
    added,
    changed,
    stale,
    unlisted_unresolved,
    passed: cyclesPassed && stalePassed && !incomplete,
  };
}
