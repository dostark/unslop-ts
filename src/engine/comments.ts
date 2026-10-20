/**
 * @module EngineComments
 * @path src/engine/comments.ts
 * @description Comment helpers for the comment and header rules: the module header, and the runs of comments past it.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/comment_rules.ts, src/rules/header_rules.ts, src/engine/module_layout.ts]
 */

import { lineAt, lineStarts } from "./module_layout.ts";
import { asNode, programOf } from "./type_environment.ts";

/** A block comment, or consecutive line comments, that start their own lines. */
export interface ICommentRun {
  /** The 1-based line of the first comment. */
  readonly startLine: number;
  /** The start of the first comment and the end of the last. */
  readonly range: readonly [number, number];
  /** The source lines of the run, delimiters included. */
  readonly lines: readonly string[];
}

/** A comment as the lint API reports it. */
export type LintComment = ReturnType<Deno.lint.SourceCode["getAllComments"]>[number];

const LINE_BREAK = /\r?\n/;

/** The offset where the first statement starts, or the text length when the file has no statement. */
export function firstStatementStart(sourceCode: Deno.lint.SourceCode): number {
  const body = asNode(programOf(sourceCode)).body;
  const first = Array.isArray(body) && body.length > 0 ? asNode(body[0]) : undefined;
  return first?.range?.[0] ?? sourceCode.text.length;
}

/** The first comment above the first statement, or null when the module has none. */
export function moduleHeaderComment(sourceCode: Deno.lint.SourceCode): LintComment | null {
  const limit = firstStatementStart(sourceCode);
  const first = sourceCode.getAllComments()[0];
  return first && first.range[1] <= limit ? first : null;
}

/** The 1-based line that holds an offset. */
export function lineOfOffset(text: string, offset: number): number {
  return lineAt(lineStarts(text), offset);
}

/**
 * The comment runs below the module header.
 * A trailing comment that follows code on its line is not part of a run.
 */
export function commentRuns(sourceCode: Deno.lint.SourceCode): ICommentRun[] {
  const text = sourceCode.text;
  const starts = lineStarts(text);
  const lines = text.split(LINE_BREAK);
  const limit = firstStatementStart(sourceCode);
  const runs: ICommentRun[] = [];
  let open: { startLine: number; endLine: number; range: [number, number] } | null = null;

  const flush = (): void => {
    if (!open) return;
    runs.push({ startLine: open.startLine, range: open.range, lines: lines.slice(open.startLine - 1, open.endLine) });
    open = null;
  };

  for (const comment of sourceCode.getAllComments()) {
    const startLine = lineAt(starts, comment.range[0]);
    const startsLine = text.slice(starts[startLine - 1], comment.range[0]).trim() === "";
    if (comment.range[0] < limit || !startsLine) continue;
    const endLine = lineAt(starts, comment.range[1] - 1);
    if (comment.type === "Line" && open && open.endLine + 1 === startLine) {
      open = { startLine: open.startLine, endLine, range: [open.range[0], comment.range[1]] };
      continue;
    }
    flush();
    open = { startLine, endLine, range: [comment.range[0], comment.range[1]] };
    if (comment.type === "Block") flush();
  }
  flush();
  return runs;
}
