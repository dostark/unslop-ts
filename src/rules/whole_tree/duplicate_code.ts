/**
 * @module WholeTreeDuplicateCode
 * @path src/rules/whole_tree/duplicate_code.ts
 * @description Measures token-level code duplication per configured scan group by running jscpd and comparing each group's percentage to its threshold, and gates new clones against a committed baseline.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/rules/whole_tree/options.ts, src/rules/whole_tree/duplicate_baseline.ts, src/rules/whole_tree/duplicate_scope.ts, src/cli/whole_tree.ts]
 */

import { join } from "@std/path";
import {
  buildBaseline,
  fingerprintClone,
  type IDuplicateBaseline,
  newClones,
  parseBaseline,
  resolvedCount,
  serializeBaseline,
} from "./duplicate_baseline.ts";
import { crossGroupClones } from "./duplicate_scope.ts";
import { involvedLineCount } from "./duplicate_views.ts";
import type { IDuplicateCodeGroup, IDuplicateCodeSettings } from "./options.ts";

/** The report file that jscpd writes into its output directory. */
export const JSCPD_REPORT_FILE = "jscpd-report.json";

/** The baseline key and report label of the pass that compares clones across scan groups. */
export const CROSS_GROUP_NAME = "cross-group";

const JSCPD_REPORTER = "json";
const IGNORE_SEPARATOR = ",";
const NPX = "npx";
const PERCENT = 100;

/** One end of a clone: a file and the line range it covers. */
export interface ICloneRange {
  readonly file: string;
  readonly start: number;
  readonly end: number;
}

/** One pair of duplicated blocks. The id identifies the pair by its files and code, so it survives a move. */
export interface IClone {
  readonly id: string;
  readonly lines: number;
  readonly first: ICloneRange;
  readonly second: ICloneRange;
}

/** The measured duplication of one scan group. */
export interface IDuplicateCodeGroupResult {
  readonly name: string;
  /** The duplicated-line share that jscpd reports, which counts each clone once. */
  readonly percentage: number;
  readonly threshold: number;
  readonly passed: boolean;
  readonly duplicatedLines: number;
  /** The lines of every scanned file. */
  readonly totalLines: number;
  /** The lines that any clone touches, counted once across all copies. */
  readonly involvedLines: number;
  /** The share of the scanned lines that sit in at least one clone, which is how other detectors count. */
  readonly involvedPercentage: number;
  readonly clones: readonly IClone[];
  /** The clones that the baseline does not list. Empty when no baseline applies. */
  readonly newClones: readonly IClone[];
  /** The baseline entries that no current clone matches. Zero when no baseline applies. */
  readonly resolvedClones: number;
}

/** The clones whose two copies sit in different scan groups. */
export interface ICrossGroupResult {
  readonly clones: readonly IClone[];
  readonly newClones: readonly IClone[];
  readonly resolvedClones: number;
  readonly passed: boolean;
}

/** The result of a duplicate-code run. */
export interface IDuplicateCodeReport {
  readonly groups: readonly IDuplicateCodeGroupResult[];
  /** The cross-group pass, or null when the settings leave it off or fewer than two groups ran. */
  readonly cross: ICrossGroupResult | null;
}

/** Runs jscpd with the given arguments and leaves its JSON report in the output directory. */
export type TJscpdRunner = (args: readonly string[], outputDir: string) => Promise<void>;

interface IRawRange {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

interface IRawClone {
  readonly lines: number;
  readonly fragment?: string;
  readonly firstFile: IRawRange;
  readonly secondFile: IRawRange;
}

interface IRawTotal {
  readonly percentage: number;
  readonly duplicatedLines: number;
  readonly sources: number;
  readonly lines?: number;
}

interface IRawReport {
  readonly statistics: { readonly total: IRawTotal };
  readonly duplicates: readonly IRawClone[];
}

function commonArgs(settings: IDuplicateCodeSettings, minLines: number, maxGapLines: number, outputDir: string) {
  const args = [
    "--min-lines",
    String(minLines),
    "--min-tokens",
    String(settings.minTokens),
    "--reporters",
    JSCPD_REPORTER,
    "--output",
    outputDir,
    "--absolute",
    "--silent",
  ];
  if (maxGapLines > 0) args.push("--max-gap-lines", String(maxGapLines));
  return args;
}

/** Builds the jscpd arguments for one group. The threshold stays out so that jscpd never decides the exit code. */
export function buildJscpdArgs(
  settings: IDuplicateCodeSettings,
  group: IDuplicateCodeGroup,
  outputDir: string,
): string[] {
  const args = [
    ...group.paths,
    ...commonArgs(settings, group.minLines ?? settings.minLines, group.maxGapLines ?? settings.maxGapLines, outputDir),
  ];
  if (group.ignore.length > 0) args.push("--ignore", group.ignore.join(IGNORE_SEPARATOR));
  if (group.pattern !== null) args.push("--pattern", group.pattern);
  return args;
}

/**
 * Builds the jscpd arguments for the cross-group pass: the union of the group paths, the shortest group
 * minimum, and only the ignore globs that every group shares. The caller attributes files to groups afterwards.
 */
export function buildUnionJscpdArgs(
  settings: IDuplicateCodeSettings,
  groups: readonly IDuplicateCodeGroup[],
  outputDir: string,
): string[] {
  const paths = [...new Set(groups.flatMap((group) => group.paths))];
  const shared = (groups[0]?.ignore ?? []).filter((glob) => groups.every((group) => group.ignore.includes(glob)));
  const minLines = Math.min(...groups.map((group) => group.minLines ?? settings.minLines));
  const args = [...paths, ...commonArgs(settings, minLines, settings.maxGapLines, outputDir)];
  if (shared.length > 0) args.push("--ignore", shared.join(IGNORE_SEPARATOR));
  return args;
}

/** A runner that executes the pinned jscpd release through npx from the repository root. */
export function npxRunner(version: string, repoRoot: string): TJscpdRunner {
  return async (args) => {
    const output = await new Deno.Command(NPX, {
      args: ["--yes", `jscpd@${version}`, ...args],
      cwd: repoRoot,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (output.code !== 0) {
      throw new Error(`jscpd ${version} exited with code ${output.code}: ${new TextDecoder().decode(output.stderr)}`);
    }
  };
}

function toRepoPath(repoRoot: string, path: string): string {
  return path.startsWith(repoRoot + "/") ? path.slice(repoRoot.length + 1) : path;
}

function parseReport(text: string, groupName: string): IRawReport {
  const parsed: Partial<IRawReport> = JSON.parse(text);
  const total = parsed.statistics?.total;
  if (total === undefined || !Array.isArray(parsed.duplicates)) {
    throw new Error(`The jscpd report of group '${groupName}' has no statistics.`);
  }
  if (total.sources === 0) {
    throw new Error(`Group '${groupName}' scanned no files; check its paths, ignore globs, and pattern.`);
  }
  return { statistics: { total }, duplicates: parsed.duplicates };
}

async function readReport(outputDir: string, groupName: string): Promise<IRawReport> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(outputDir, JSCPD_REPORT_FILE));
  } catch {
    throw new Error(`jscpd wrote no report for group '${groupName}'.`);
  }
  return parseReport(text, groupName);
}

function compareClones(left: IClone, right: IClone): number {
  return right.lines - left.lines || left.first.file.localeCompare(right.first.file) ||
    left.first.start - right.first.start;
}

function toClone(repoRoot: string, raw: IRawClone): IClone {
  const range = (side: IRawRange): ICloneRange => ({
    file: toRepoPath(repoRoot, side.name),
    start: side.start,
    end: side.end,
  });
  const first = range(raw.firstFile);
  const second = range(raw.secondFile);
  return { id: fingerprintClone(first, second, raw.fragment ?? null, raw.lines), lines: raw.lines, first, second };
}

/** Runs jscpd once and returns its report, with the clones sorted largest first. */
async function scan(
  repoRoot: string,
  label: string,
  buildArgs: (outputDir: string) => string[],
  run: TJscpdRunner,
): Promise<{ total: IRawTotal; clones: IClone[] }> {
  const outputDir = await Deno.makeTempDir({ prefix: "unslop_duplicate_code_" });
  try {
    await run(buildArgs(outputDir), outputDir);
    const report = await readReport(outputDir, label);
    const clones = report.duplicates.map((raw) => toClone(repoRoot, raw)).sort(compareClones);
    return { total: report.statistics.total, clones };
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * PERCENT;
}

async function measureGroup(
  repoRoot: string,
  settings: IDuplicateCodeSettings,
  group: IDuplicateCodeGroup,
  run: TJscpdRunner,
  baseline: IDuplicateBaseline | null,
): Promise<IDuplicateCodeGroupResult> {
  const { total, clones } = await scan(repoRoot, group.name, (dir) => buildJscpdArgs(settings, group, dir), run);
  const fresh = baseline === null ? [] : newClones(clones, baseline, group.name);
  const involvedLines = involvedLineCount(clones);
  const totalLines = total.lines ?? 0;
  return {
    name: group.name,
    percentage: total.percentage,
    threshold: group.threshold,
    passed: total.percentage <= group.threshold && fresh.length === 0,
    duplicatedLines: total.duplicatedLines,
    totalLines,
    involvedLines,
    involvedPercentage: share(involvedLines, totalLines),
    clones,
    newClones: fresh,
    resolvedClones: baseline === null ? 0 : resolvedCount(clones, baseline, group.name),
  };
}

async function measureCross(
  repoRoot: string,
  settings: IDuplicateCodeSettings,
  run: TJscpdRunner,
  baseline: IDuplicateBaseline | null,
): Promise<ICrossGroupResult> {
  const { clones: all } = await scan(
    repoRoot,
    CROSS_GROUP_NAME,
    (dir) => buildUnionJscpdArgs(settings, settings.groups, dir),
    run,
  );
  const clones = crossGroupClones(all, settings.groups, settings.minLines);
  const fresh = baseline === null ? [] : newClones(clones, baseline, CROSS_GROUP_NAME);
  return {
    clones,
    newClones: fresh,
    resolvedClones: baseline === null ? 0 : resolvedCount(clones, baseline, CROSS_GROUP_NAME),
    passed: fresh.length === 0,
  };
}

/** Reads the committed baseline of the settings, or null when the settings name none. */
export async function loadBaseline(
  repoRoot: string,
  settings: IDuplicateCodeSettings,
): Promise<IDuplicateBaseline | null> {
  if (settings.baseline === null) return null;
  let text: string;
  try {
    text = await Deno.readTextFile(join(repoRoot, settings.baseline));
  } catch {
    throw new Error(
      `The duplicate-code baseline '${settings.baseline}' cannot be read; create it with --update-baseline.`,
    );
  }
  return parseBaseline(text);
}

/** Writes the baseline for the measured groups, and the cross-group clones when that pass ran. Groups not measured keep their entries. */
export async function saveBaseline(
  repoRoot: string,
  settings: IDuplicateCodeSettings,
  report: IDuplicateCodeReport,
): Promise<string> {
  if (settings.baseline === null) throw new Error("The duplicate-code settings name no baseline file.");
  const path = join(repoRoot, settings.baseline);
  let previous: IDuplicateBaseline | null = null;
  try {
    previous = parseBaseline(await Deno.readTextFile(path));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const measured = report.groups.map((group) => ({ name: group.name, clones: group.clones }));
  if (report.cross !== null) measured.push({ name: CROSS_GROUP_NAME, clones: report.cross.clones });
  await Deno.writeTextFile(path, serializeBaseline(buildBaseline(measured, previous)));
  return settings.baseline;
}

/**
 * Measures every configured scan group, one jscpd run each, in the order the settings list them. When the
 * settings name a baseline, a clone it does not list fails its group. When they turn on cross-group
 * comparison and two or more groups run, one more run scans all groups together.
 */
export async function checkRepository(
  repoRoot: string,
  settings: IDuplicateCodeSettings,
  run: TJscpdRunner = npxRunner(settings.jscpdVersion, repoRoot),
): Promise<IDuplicateCodeReport> {
  const baseline = await loadBaseline(repoRoot, settings);
  const groups: IDuplicateCodeGroupResult[] = [];
  for (const group of settings.groups) groups.push(await measureGroup(repoRoot, settings, group, run, baseline));
  const cross = settings.crossGroups && settings.groups.length > 1
    ? await measureCross(repoRoot, settings, run, baseline)
    : null;
  return { groups, cross };
}

/** Narrows the settings to the named scan groups, keeping the settings order. No names keeps every group. */
export function selectGroups(settings: IDuplicateCodeSettings, names: readonly string[]): IDuplicateCodeSettings {
  if (names.length === 0) return settings;
  const known = settings.groups.map((group) => group.name);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown scan group '${unknown.join("', '")}'. Known groups: ${known.join(", ")}.`);
  }
  return { ...settings, groups: settings.groups.filter((group) => names.includes(group.name)) };
}
