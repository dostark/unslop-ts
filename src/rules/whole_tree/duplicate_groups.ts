/**
 * @module WholeTreeDuplicateGroups
 * @path src/rules/whole_tree/duplicate_groups.ts
 * @description Shared grouping for the duplicate-type and duplicate-constant checks: groups, duplicates, and stale allow entries.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/whole_tree/duplicate_type.ts, src/rules/whole_tree/duplicate_constant.ts]
 */

/** One source file to inspect. */
export interface ISourceUnit {
  readonly path: string;
  readonly text: string;
}

/** A copy of an item that another file already holds. */
export interface IDuplicate {
  readonly name: string;
  readonly firstFile: string;
  readonly laterFile: string;
}

/** An allowed duplicate: a name, the files that may share it, and why. */
export interface IDuplicateAllowEntry {
  readonly name: string;
  readonly files: readonly string[];
  readonly reason: string;
}

const KEY_SEPARATOR = "\u0000";
const MIN_FILES_FOR_DUPLICATE = 2;

/** Maps `name` and `signature` to the files that hold that exact pair, in first-seen order. */
export function groupBySignature(
  units: readonly ISourceUnit[],
  extract: (unit: ISourceUnit) => Map<string, string>,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const unit of units) {
    for (const [name, signature] of extract(unit)) {
      const key = `${name}${KEY_SEPARATOR}${signature}`;
      const held = groups.get(key) ?? [];
      if (!held.includes(unit.path)) held.push(unit.path);
      groups.set(key, held);
    }
  }
  return groups;
}

function nameOf(key: string): string {
  return key.split(KEY_SEPARATOR)[0];
}

/** Every later copy of a grouped item, against the first file in path order, minus the allowed pairs. */
export function duplicatesOf(
  groups: ReadonlyMap<string, readonly string[]>,
  allow: readonly IDuplicateAllowEntry[],
): IDuplicate[] {
  const duplicates: IDuplicate[] = [];
  for (const [key, held] of groups) {
    if (held.length < MIN_FILES_FOR_DUPLICATE) continue;
    const name = nameOf(key);
    const [first, ...later] = [...held].sort();
    for (const laterFile of later) {
      const allowed = allow.some((entry) =>
        entry.name === name && entry.files.includes(first) && entry.files.includes(laterFile)
      );
      if (!allowed) duplicates.push({ name, firstFile: first, laterFile });
    }
  }
  return duplicates;
}

/** The names of allow entries that no current duplicate matches. */
export function staleAllowEntries(
  groups: ReadonlyMap<string, readonly string[]>,
  allow: readonly IDuplicateAllowEntry[],
): string[] {
  const stale: string[] = [];
  for (const entry of allow) {
    const matches = [...groups].some(([key, held]) =>
      nameOf(key) === entry.name &&
      held.length >= MIN_FILES_FOR_DUPLICATE &&
      entry.files.every((file) => held.includes(file))
    );
    if (!matches) stale.push(entry.name);
  }
  return stale;
}
