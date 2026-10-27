/**
 * @module WholeTreeDuplicateFormat
 * @path src/rules/whole_tree/duplicate_format.ts
 * @description Converts a duplicate-code report into a plain JSON document for tools: the figures, the clones with their ids, and the new-clone flags.
 * @architectural-layer Shared
 * @related-files [src/rules/whole_tree/duplicate_code.ts, src/cli/whole_tree.ts]
 */

import type { IClone, ICloneRange, ICrossGroupResult, IDuplicateCodeReport } from "./duplicate_code.ts";
import { atLeastLines } from "./duplicate_views.ts";

/** One clone in the JSON document. */
export interface IJsonClone {
  id: string;
  lines: number;
  /** True when the baseline does not list the clone. Always false without a baseline. */
  isNew: boolean;
  first: ICloneRange;
  second: ICloneRange;
}

/** One scan group in the JSON document. */
export interface IJsonGroup {
  name: string;
  passed: boolean;
  threshold: number;
  percentage: number;
  involvedPercentage: number;
  duplicatedLines: number;
  involvedLines: number;
  totalLines: number;
  newClones: number;
  resolvedClones: number;
  clones: IJsonClone[];
}

/** The cross-group pass in the JSON document. */
export interface IJsonCrossGroup {
  passed: boolean;
  newClones: number;
  resolvedClones: number;
  clones: IJsonClone[];
}

/** The JSON document of a duplicate-code run. */
export interface IJsonReport {
  passed: boolean;
  groups: IJsonGroup[];
  crossGroup: IJsonCrossGroup | null;
}

function toJsonClones(clones: readonly IClone[], fresh: readonly IClone[], minLines: number): IJsonClone[] {
  const freshIds = new Set(fresh.map((clone) => clone.id));
  return atLeastLines(clones, minLines).map((clone) => ({
    id: clone.id,
    lines: clone.lines,
    isNew: freshIds.has(clone.id),
    first: { file: clone.first.file, start: clone.first.start, end: clone.first.end },
    second: { file: clone.second.file, start: clone.second.start, end: clone.second.end },
  }));
}

function toJsonCross(cross: ICrossGroupResult, minLines: number): IJsonCrossGroup {
  return {
    passed: cross.passed,
    newClones: cross.newClones.length,
    resolvedClones: cross.resolvedClones,
    clones: toJsonClones(cross.clones, cross.newClones, minLines),
  };
}

/**
 * Converts the report to a document. `minLines` drops short clones from the clone lists only; the figures
 * and the verdict always count every clone.
 */
export function toJsonReport(report: IDuplicateCodeReport, minLines: number): IJsonReport {
  return {
    passed: report.groups.every((group) => group.passed) && (report.cross?.passed ?? true),
    groups: report.groups.map((group) => ({
      name: group.name,
      passed: group.passed,
      threshold: group.threshold,
      percentage: group.percentage,
      involvedPercentage: group.involvedPercentage,
      duplicatedLines: group.duplicatedLines,
      involvedLines: group.involvedLines,
      totalLines: group.totalLines,
      newClones: group.newClones.length,
      resolvedClones: group.resolvedClones,
      clones: toJsonClones(group.clones, group.newClones, minLines),
    })),
    crossGroup: report.cross === null ? null : toJsonCross(report.cross, minLines),
  };
}
