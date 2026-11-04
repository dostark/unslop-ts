/**
 * @module HealthLargeFiles
 * @path src/report/large_files.ts
 * @description Lists the files of the snapshot that have more physical lines than the soft or the hard module size limit, largest first.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/rules/max_file_lines.ts, src/report/health.ts, src/report/health_model.ts]
 */

import { physicalLinesOf } from "../rules/max_file_lines.ts";
import type { IHealthLargeFile } from "./health_model.ts";
import type { IParsedHealthFile } from "./parse.ts";

/** The two module size limits that a project configures. */
export interface IFileLineLimits {
  /** The advisory limit. It equals the hard limit when the project sets no soft limit. */
  readonly soft: number;
  readonly hard: number;
}

/** The files above a limit, largest first. Null limits mean the project does not use the rule. */
export function largeFilesOf(
  files: ReadonlyMap<string, IParsedHealthFile>,
  limits: IFileLineLimits | null,
): IHealthLargeFile[] {
  if (limits === null) return [];
  const large: IHealthLargeFile[] = [];
  for (const [path, file] of files) {
    const lines = physicalLinesOf(file.text);
    if (lines > limits.hard) large.push({ path, lines, limit: "hard" });
    else if (lines > limits.soft) large.push({ path, lines, limit: "soft" });
  }
  return large.sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));
}
