/**
 * @module WholeTreeDuplicateCode
 * @path src/rules/whole_tree/duplicate_code.ts
 * @description Measures token-level code duplication per configured scan group by running jscpd and comparing each group's percentage to its threshold.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/rules/whole_tree/options.ts, src/cli/whole_tree.ts]
 */

import { join } from "@std/path";
import type { IDuplicateCodeGroup, IDuplicateCodeSettings } from "./options.ts";

/** The report file that jscpd writes into its output directory. */
export const JSCPD_REPORT_FILE = "jscpd-report.json";

const JSCPD_REPORTER = "json";
const IGNORE_SEPARATOR = ",";
const NPX = "npx";

/** One end of a clone: a file and the line range it covers. */
export interface ICloneRange {
  readonly file: string;
  readonly start: number;
  readonly end: number;
}

/** One pair of duplicated blocks. */
export interface IClone {
  readonly lines: number;
  readonly first: ICloneRange;
  readonly second: ICloneRange;
}

/** The measured duplication of one scan group. */
export interface IDuplicateCodeGroupResult {
  readonly name: string;
  readonly percentage: number;
  readonly threshold: number;
  readonly passed: boolean;
  readonly duplicatedLines: number;
  readonly clones: readonly IClone[];
}

/** The result of a duplicate-code run. */
export interface IDuplicateCodeReport {
  readonly groups: readonly IDuplicateCodeGroupResult[];
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
  readonly firstFile: IRawRange;
  readonly secondFile: IRawRange;
}

interface IRawReport {
  readonly statistics: {
    readonly total: { readonly percentage: number; readonly duplicatedLines: number; readonly sources: number };
  };
  readonly duplicates: readonly IRawClone[];
}

/** Builds the jscpd arguments for one group. The threshold stays out so that jscpd never decides the exit code. */
export function buildJscpdArgs(
  settings: IDuplicateCodeSettings,
  group: IDuplicateCodeGroup,
  outputDir: string,
): string[] {
  const args = [
    ...group.paths,
    "--min-lines",
    String(settings.minLines),
    "--min-tokens",
    String(settings.minTokens),
    "--reporters",
    JSCPD_REPORTER,
    "--output",
    outputDir,
    "--absolute",
    "--silent",
  ];
  if (group.ignore.length > 0) args.push("--ignore", group.ignore.join(IGNORE_SEPARATOR));
  if (group.pattern !== null) args.push("--pattern", group.pattern);
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
  return { lines: raw.lines, first: range(raw.firstFile), second: range(raw.secondFile) };
}

async function measureGroup(
  repoRoot: string,
  settings: IDuplicateCodeSettings,
  group: IDuplicateCodeGroup,
  run: TJscpdRunner,
): Promise<IDuplicateCodeGroupResult> {
  const outputDir = await Deno.makeTempDir({ prefix: "unslop_duplicate_code_" });
  try {
    await run(buildJscpdArgs(settings, group, outputDir), outputDir);
    const report = await readReport(outputDir, group.name);
    const { percentage, duplicatedLines } = report.statistics.total;
    return {
      name: group.name,
      percentage,
      threshold: group.threshold,
      passed: percentage <= group.threshold,
      duplicatedLines,
      clones: report.duplicates.map((raw) => toClone(repoRoot, raw)).sort(compareClones),
    };
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
}

/** Measures every configured scan group, one jscpd run each, in the order the settings list them. */
export async function checkRepository(
  repoRoot: string,
  settings: IDuplicateCodeSettings,
  run: TJscpdRunner = npxRunner(settings.jscpdVersion, repoRoot),
): Promise<IDuplicateCodeReport> {
  const groups: IDuplicateCodeGroupResult[] = [];
  for (const group of settings.groups) groups.push(await measureGroup(repoRoot, settings, group, run));
  return { groups };
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
