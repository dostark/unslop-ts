/**
 * @module Duplication
 * @path src/report/duplication.ts
 * @description The local jscpd runner and the union of duplicated code-token lines for the health score.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/rules/whole_tree/duplicate_code.ts, src/report/health.ts]
 */

import { join, resolve } from "@std/path";
import {
  checkRepository as checkDuplicationRepository,
  type IClone,
  type TJscpdRunner,
} from "../rules/whole_tree/duplicate_code.ts";
import type { IDuplicateCodeSettings } from "../rules/whole_tree/options.ts";

/** The exact local jscpd release the runner accepts. */
const JSCPD_REQUIRED_VERSION = "5.4.2";

/** The largest retained runner stderr. */
const MAX_RUNNER_STDERR_BYTES = 8 * 1024;

/** The runner deadline in milliseconds. */
const RUNNER_DEADLINE_MS = 120 * 1000;

/** The measured duplication of one snapshot. */
export interface IDuplicationMeasurement {
  readonly available: boolean;
  readonly reason: string | null;
  readonly lines: number;
  readonly total_lines: number;
}

/** The inputs of one duplication measurement. */
export interface IDuplicationInput {
  readonly rootPath: string;
  readonly settings: IDuplicateCodeSettings;
  readonly runner: TJscpdRunner;
  readonly tokenLines: ReadonlyMap<string, ReadonlySet<number>>;
  readonly snapshotDigest: () => Promise<string>;
}

/** The unique code-token lines that any clone range covers in at least one copy. */
export function duplicatedLinesOf(
  clones: readonly IClone[],
  tokenLines: ReadonlyMap<string, ReadonlySet<number>>,
): number {
  const seen = new Set<string>();
  for (const clone of clones) {
    for (const range of [clone.first, clone.second]) {
      const lines = tokenLines.get(range.file);
      if (lines === undefined) continue;
      for (let line = range.start; line <= range.end; line++) {
        if (lines.has(line)) seen.add(`${range.file}:${line}`);
      }
    }
  }
  return seen.size;
}

/** The unique code-token lines in the measured snapshot. */
function snapshotTokenLinesOf(tokenLines: ReadonlyMap<string, ReadonlySet<number>>): number {
  let total = 0;
  for (const lines of tokenLines.values()) total += lines.size;
  return total;
}

/** Measures the duplication, treating a runner failure or a changed source as an attributed absence. */
export async function measureDuplication(input: IDuplicationInput): Promise<IDuplicationMeasurement> {
  const before = await input.snapshotDigest();
  let report;
  try {
    report = await checkDuplicationRepository(
      input.rootPath,
      { ...input.settings, baseline: null },
      input.runner,
      { tempRoot: "/tmp" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      reason: `duplication-runner-failed: ${message.slice(0, MAX_RUNNER_STDERR_BYTES)}`,
      lines: 0,
      total_lines: 0,
    };
  }
  const after = await input.snapshotDigest();
  if (before !== after) {
    return { available: false, reason: "source-changed-during-scan", lines: 0, total_lines: 0 };
  }
  const clones: IClone[] = [
    ...report.groups.flatMap((group) => group.clones),
    ...(report.cross?.clones ?? []),
  ];
  return {
    available: true,
    reason: null,
    lines: duplicatedLinesOf(clones, input.tokenLines),
    total_lines: snapshotTokenLinesOf(input.tokenLines),
  };
}

/** Reads the installed jscpd manifest and returns its validated bin path. */
async function installedJscpdBin(rootPath: string, requiredVersion: string): Promise<string> {
  const packageRoot = join(rootPath, "node_modules/jscpd");
  let text: string;
  try {
    text = await Deno.readTextFile(join(packageRoot, "package.json"));
  } catch {
    throw new Error("jscpd-not-installed");
  }
  const manifest = JSON.parse(text) as { version?: unknown; bin?: unknown };
  if (manifest.version !== requiredVersion) {
    throw new Error(`jscpd-version-mismatch: found '${String(manifest.version)}', need '${requiredVersion}'`);
  }
  const bin = typeof manifest.bin === "string"
    ? manifest.bin
    : manifest.bin !== null && typeof manifest.bin === "object"
    ? (manifest.bin as Record<string, unknown>).jscpd
    : undefined;
  if (typeof bin !== "string" || bin.length === 0) throw new Error("jscpd-bin-missing");
  const candidate = resolve(packageRoot, bin);
  const realPackage = await Deno.realPath(packageRoot);
  const realBin = await Deno.realPath(candidate);
  if (realBin !== realPackage && !realBin.startsWith(`${realPackage}/`)) {
    throw new Error("jscpd-bin-outside-package");
  }
  const stat = await Deno.stat(realBin);
  if (!stat.isFile) throw new Error("jscpd-bin-missing");
  return realBin;
}

/** Builds a runner for the validated local jscpd bin. No npm or npx is involved. */
export async function localJscpdRunner(
  rootPath: string,
  requiredVersion = JSCPD_REQUIRED_VERSION,
): Promise<TJscpdRunner> {
  const bin = await installedJscpdBin(rootPath, requiredVersion);
  return async (args) => {
    let output: Deno.CommandOutput;
    try {
      output = await new Deno.Command("node", {
        args: [bin, ...args],
        cwd: rootPath,
        env: { LD_LIBRARY_PATH: "" },
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(RUNNER_DEADLINE_MS),
      }).output();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`jscpd-runner-failed: ${message}`);
    }
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr.slice(0, MAX_RUNNER_STDERR_BYTES)).trim();
      throw new Error(`jscpd-failed: ${stderr || `exit ${output.code}`}`);
    }
  };
}
