/**
 * @module CliDiff
 * @path src/cli/diff.ts
 * @description A line-based unified diff for `--dry-run`; it never touches the filesystem.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/cli/commands/rules_write.ts]
 */

interface IDiffOp {
  readonly type: " " | "-" | "+";
  readonly line: string;
}

const NEWLINE = "\n";

function operations(before: readonly string[], after: readonly string[]): IDiffOp[] {
  const rows = before.length;
  const columns = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row][column] = before[row] === after[column]
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }
  const ops: IDiffOp[] = [];
  let row = 0;
  let column = 0;
  while (row < rows || column < columns) {
    if (row < rows && column < columns && before[row] === after[column]) {
      ops.push({ type: " ", line: before[row] });
      row++;
      column++;
    } else if (column < columns && (row === rows || table[row][column + 1] >= table[row + 1][column])) {
      ops.push({ type: "+", line: after[column] });
      column++;
    } else {
      ops.push({ type: "-", line: before[row] });
      row++;
    }
  }
  return ops;
}

/** A unified diff with one hunk; an unchanged input returns the empty string. */
export function unifiedDiff(label: string, before: string, after: string): string {
  const beforeLines = before.split(NEWLINE);
  const afterLines = after.split(NEWLINE);
  const ops = operations(beforeLines, afterLines);
  if (ops.every((op) => op.type === " ")) return "";
  const body = ops.map((op) => `${op.type}${op.line}`).join(NEWLINE);
  return `--- ${label}${NEWLINE}+++ ${label}${NEWLINE}` +
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@${NEWLINE}${body}${NEWLINE}`;
}
