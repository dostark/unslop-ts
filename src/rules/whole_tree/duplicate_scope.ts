/**
 * @module WholeTreeDuplicateScope
 * @path src/rules/whole_tree/duplicate_scope.ts
 * @description Attributes a file to a duplicate-code scan group by its paths, ignore globs, and pattern, and keeps the clones whose two copies sit in different groups.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/rules/whole_tree/duplicate_code.ts, src/rules/whole_tree/options.ts]
 */

import { globToRegExp } from "@std/path";
import type { IClone } from "./duplicate_code.ts";
import type { IDuplicateCodeGroup } from "./options.ts";

const GLOB_OPTIONS = { extended: true, globstar: true };

interface ICompiledScope {
  readonly ignore: readonly RegExp[];
  readonly pattern: RegExp | null;
}

const compiled = new WeakMap<IDuplicateCodeGroup, ICompiledScope>();

function compile(group: IDuplicateCodeGroup): ICompiledScope {
  const known = compiled.get(group);
  if (known !== undefined) return known;
  const scope: ICompiledScope = {
    ignore: group.ignore.map((glob) => globToRegExp(glob, GLOB_OPTIONS)),
    pattern: group.pattern === null ? null : globToRegExp(group.pattern, GLOB_OPTIONS),
  };
  compiled.set(group, scope);
  return scope;
}

function underPath(file: string, path: string): boolean {
  if (file === path) return true;
  return file.startsWith(path.endsWith("/") ? path : `${path}/`);
}

function accepts(group: IDuplicateCodeGroup, file: string): boolean {
  if (!group.paths.some((path) => underPath(file, path))) return false;
  const scope = compile(group);
  if (scope.ignore.some((ignored) => ignored.test(file))) return false;
  return scope.pattern === null || scope.pattern.test(file);
}

/** Returns the first group whose paths, ignore globs, and pattern accept the repository-relative file, or null. */
export function groupOf(file: string, groups: readonly IDuplicateCodeGroup[]): IDuplicateCodeGroup | null {
  return groups.find((group) => accepts(group, file)) ?? null;
}

/**
 * Keeps the clones whose two copies sit in different groups, which no single group run compares. A clone must
 * reach the larger of the two group minimums, so a short clone between source and tests stays out.
 */
export function crossGroupClones(
  clones: readonly IClone[],
  groups: readonly IDuplicateCodeGroup[],
  sharedMinLines: number = 1,
): IClone[] {
  return clones.filter((clone) => {
    const first = groupOf(clone.first.file, groups);
    const second = groupOf(clone.second.file, groups);
    if (first === null || second === null || first.name === second.name) return false;
    const floor = Math.max(first.minLines ?? sharedMinLines, second.minLines ?? sharedMinLines);
    return clone.lines >= floor;
  });
}
