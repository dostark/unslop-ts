/**
 * @module MaxFileLines
 * @path src/rules/max_file_lines.ts
 * @description Module size limit as a plugin rule: a file with more physical lines than the hard limit is reported once, at its first line.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/rules/rule_options.ts, tests/max_file_lines_test.ts]
 */

import { DEFAULT_MAX_FILE_LINES } from "../metrics/constants.ts";
import type { IPluginRuleContext, IRuleContext, LintVisitor } from "./types.ts";

const LINE_BREAK = "\n";

/** The physical lines of a text. A final line break does not start another line. */
export function physicalLinesOf(text: string): number {
  if (text.length === 0) return 0;
  const breaks = text.split(LINE_BREAK).length - 1;
  return text.endsWith(LINE_BREAK) ? breaks : breaks + 1;
}

/** Builds the rule that reports a file above the hard line limit. Comments and blank lines count, because a reader loads them. */
export function createMaxFileLines(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const max = typeof ctx.options.max === "number" ? ctx.options.max : DEFAULT_MAX_FILE_LINES;
  return {
    Program(): void {
      const text = context.sourceCode.text;
      const lines = physicalLinesOf(text);
      if (lines <= max) return;
      const firstLineEnd = text.indexOf(LINE_BREAK);
      context.report({
        range: [0, firstLineEnd === -1 ? text.length : firstLineEnd],
        message: `File has ${lines} lines (limit ${max}).`,
        hint: "Split the file into modules with one responsibility each and a narrow interface.",
      });
    },
  };
}
