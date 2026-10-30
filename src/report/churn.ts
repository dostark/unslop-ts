/**
 * @module Churn
 * @path src/report/churn.ts
 * @description Fixed-argv Git history parsing, committer-date decay and hotspot scores.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/health.ts, src/report/constants.ts]
 */

import { type IChildLimits, runBounded } from "./bounded_io.ts";
import {
  CHURN_HALF_LIFE_DAYS,
  GIT_LIMITS,
  MAX_GIT_PROBE_BYTES,
  MAX_GIT_STDERR_BYTES,
  SECONDS_PER_DAY,
} from "./constants.ts";

/** One commit record as the fixed Git argv prints it. */
export interface IGitCommit {
  readonly hash: string;
  readonly committer_time: number;
  readonly files: readonly IGitCommitFile[];
}

/** One numstat record of a commit. */
export interface IGitCommitFile {
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
  readonly binary: boolean;
}

/** One measured file's history. */
export interface IChurnFile {
  readonly commits: number;
  readonly weight: number;
}

/** The history of one project root. */
export interface IChurnHistory {
  readonly available: boolean;
  readonly reason: string | null;
  readonly shallow: boolean;
  readonly empty: boolean;
  readonly files: ReadonlyMap<string, IChurnFile>;
}

/** One qualified hotspot. */
export interface IHotspotScore {
  readonly path: string;
  readonly commits: number;
  readonly churn: number;
  readonly density: number;
  readonly score: number;
}

/** The decay weight of one committer time at one captured clock. */
export function churnWeightOf(committerTime: number, now: number): number {
  const age = Math.max(0, now - committerTime);
  return 0.5 ** (age / SECONDS_PER_DAY / CHURN_HALF_LIFE_DAYS);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Parses `180d`, `6m` or an ISO date into a safe-integer epoch boundary. */
export function parseSince(value: string, now: Date): number {
  const duration = /^(\d+)([dm])$/.exec(value);
  if (duration !== null) {
    const amount = Number(duration[1]);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`--since needs a positive duration: '${value}'`);
    const days = duration[2] === "m" ? amount * 30 : amount;
    const epoch = Math.floor(now.getTime() / 1000) - days * SECONDS_PER_DAY;
    if (!Number.isSafeInteger(epoch)) throw new Error(`--since duration is out of range: '${value}'`);
    return epoch;
  }
  const parsed = ISO_DATE.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) throw new Error(`--since needs a day/month duration or an ISO date: '${value}'`);
  return Math.floor(parsed / 1000);
}

/** Parses one numstat token whose path may contain tabs and newlines. */
function parseNumstat(token: string): IGitCommitFile | null {
  const first = token.indexOf("\t");
  if (first === -1) return null;
  const second = token.indexOf("\t", first + 1);
  if (second === -1) return null;
  const addedField = token.slice(0, first);
  const deletedField = token.slice(first + 1, second);
  const path = token.slice(second + 1);
  if (path.length === 0) return null;
  const binary = addedField === "-" && deletedField === "-";
  if (!binary) {
    const added = Number(addedField);
    const deleted = Number(deletedField);
    if (!Number.isInteger(added) || added < 0 || !Number.isInteger(deleted) || deleted < 0) return null;
  }
  return {
    path,
    added: binary ? 0 : Number(addedField),
    deleted: binary ? 0 : Number(deletedField),
    binary,
  };
}

/** Parses the NUL-framed history the fixed argv prints. */
export function parseHistory(text: string): readonly IGitCommit[] {
  const commits: IGitCommit[] = [];
  const tokens = text.split("\0");
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token !== "COMMIT") {
      index++;
      continue;
    }
    const hash = tokens[index + 1] ?? "";
    const committerTime = Number(tokens[index + 2] ?? "");
    if (hash.length === 0 || !Number.isInteger(committerTime)) break;
    index += 3;
    const files: IGitCommitFile[] = [];
    while (index < tokens.length && tokens[index] !== "COMMIT") {
      const record = tokens[index].replace(/^\n/, "");
      index++;
      if (record.length === 0) continue;
      const file = parseNumstat(record);
      if (file !== null) files.push(file);
    }
    commits.push({ hash, committer_time: committerTime, files });
  }
  return commits;
}

/** The churn of one file from the parsed commits, counting each commit once. */
function churnOf(
  commits: readonly IGitCommit[],
  pathOf: (raw: string) => string | null,
  snapshot: ReadonlySet<string>,
  now: number,
): Map<string, IChurnFile> {
  const files = new Map<string, IChurnFile>();
  for (const commit of commits) {
    const seen = new Set<string>();
    const weight = churnWeightOf(commit.committer_time, now);
    for (const record of commit.files) {
      const path = pathOf(record.path);
      if (path === null || seen.has(path) || !snapshot.has(path)) continue;
      seen.add(path);
      const current = files.get(path) ?? { commits: 0, weight: 0 };
      files.set(path, { commits: current.commits + 1, weight: current.weight + weight });
    }
  }
  return files;
}

/** The Git message of `rev-parse --verify HEAD` in a repository without a commit. */
const UNBORN_HEAD_MESSAGE = "Needed a single revision";

/** Why a bounded Git call ended without a successful exit. */
const GIT_STOP_REASONS = {
  "stdout-overflow": "git-output-too-large",
  "stderr-overflow": "git-stderr-too-large",
  timeout: "git-command-timeout",
} as const;

/** Runs one Git command under the byte and time limits and returns its stdout, or a classified failure. */
async function runGit(
  root: string,
  args: readonly string[],
  limits: IChildLimits,
): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  let result;
  try {
    result = await runBounded("git", args, { cwd: root, env: { LD_LIBRARY_PATH: "" } }, limits);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `git-command-failed: ${message}` };
  }
  if (result.status !== "exited") return { ok: false, reason: GIT_STOP_REASONS[result.status] };
  if (result.code !== 0) {
    const stderr = new TextDecoder().decode(result.stderr.slice(0, MAX_GIT_STDERR_BYTES)).trim();
    if (stderr.includes("not a git repository")) return { ok: false, reason: "not-a-git-repository" };
    if (stderr.toLowerCase().includes("permission denied")) return { ok: false, reason: "permission-denied" };
    return { ok: false, reason: `git-command-failed: ${stderr || `exit ${result.code}`}` };
  }
  return { ok: true, stdout: new TextDecoder().decode(result.stdout) };
}

/** Reads the fixed-argv history of one measured root. Never throws for a missing repository. */
export async function collectChurn(
  rootPath: string,
  sinceEpoch: number,
  nowEpoch: number,
  snapshot: ReadonlySet<string>,
  limits: IChildLimits = GIT_LIMITS,
): Promise<IChurnHistory> {
  const unavailable = (reason: string): IChurnHistory => ({
    available: false,
    reason,
    shallow: false,
    empty: false,
    files: new Map(),
  });
  const probe: IChildLimits = { ...limits, maxStdoutBytes: Math.min(limits.maxStdoutBytes, MAX_GIT_PROBE_BYTES) };
  const top = await runGit(rootPath, ["rev-parse", "--show-toplevel"], probe);
  if (!top.ok) return unavailable(top.reason);
  const prefixResult = await runGit(rootPath, ["rev-parse", "--show-prefix"], probe);
  if (!prefixResult.ok) return unavailable(prefixResult.reason);
  const prefix = prefixResult.stdout.trim();
  const shallowResult = await runGit(rootPath, ["rev-parse", "--is-shallow-repository"], probe);
  if (!shallowResult.ok) return unavailable(shallowResult.reason);
  const shallow = shallowResult.stdout.trim() === "true";
  const head = await runGit(rootPath, ["rev-parse", "--verify", "HEAD"], probe);
  if (!head.ok) {
    if (!head.reason.includes(UNBORN_HEAD_MESSAGE)) return { ...unavailable(head.reason), shallow };
    return { available: true, reason: null, shallow, empty: true, files: new Map() };
  }
  const log = await runGit(
    rootPath,
    [
      "-c",
      "core.quotePath=false",
      "log",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--no-merges",
      "-z",
      "--numstat",
      "--format=%x00COMMIT%x00%H%x00%ct%x00",
      `--since=@${sinceEpoch}`,
      "--",
      ".",
    ],
    limits,
  );
  if (!log.ok) {
    const reason = log.reason === "git-output-too-large" ? "history-output-too-large" : log.reason;
    return { ...unavailable(reason), shallow };
  }
  const commits = parseHistory(log.stdout);
  const pathOf = (raw: string): string | null => {
    if (prefix.length === 0) return raw;
    return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
  };
  const mapped = churnOf(commits, pathOf, snapshot, nowEpoch);
  return { available: true, reason: null, shallow, empty: false, files: mapped };
}

/** The qualified hotspot scores, normalized over the qualified population. */
export function hotspotScoresOf(
  history: IChurnHistory,
  densityByPath: ReadonlyMap<string, number>,
  minCommits: number,
): readonly IHotspotScore[] {
  const qualified = [...history.files]
    .filter(([, file]) => file.commits >= minCommits)
    .map(([path, file]) => ({
      path,
      commits: file.commits,
      churn: file.weight,
      density: densityByPath.get(path) ?? 0,
    }));
  if (qualified.length === 0) return [];
  const maxChurn = Math.max(...qualified.map((entry) => entry.churn));
  const maxDensity = Math.max(...qualified.map((entry) => entry.density));
  return qualified
    .map((entry) => ({
      ...entry,
      score: maxChurn === 0 || maxDensity === 0 ? 0 : 100 * (entry.churn / maxChurn) * (entry.density / maxDensity),
    }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}
