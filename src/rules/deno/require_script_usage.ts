/**
 * @module RequireScriptUsage
 * @path src/rules/deno/require_script_usage.ts
 * @description Reports a script whose header has no Usage section.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/engine/comments.ts]
 */

import { moduleHeaderComment } from "../../engine/comments.ts";
import type { IPluginRuleContext, LintVisitor } from "../types.ts";

const DEFAULT_MARKER = "Usage:";
const DEFAULT_MAX_HEADER_LINES = 15;
const LINE_BREAK = /\r?\n/;

export function createRequireScriptUsage(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const marker = typeof ctx.options.marker === "string" ? ctx.options.marker : DEFAULT_MARKER;
  const maxLines = typeof ctx.options.maxHeaderLines === "number"
    ? ctx.options.maxHeaderLines
    : DEFAULT_MAX_HEADER_LINES;
  return {
    Program(): void {
      const text = context.sourceCode.text;
      // A script without a header is the case of the module-header rule.
      if (moduleHeaderComment(context.sourceCode) === null) return;
      if (text.split(LINE_BREAK).slice(0, maxLines).join("\n").includes(marker)) return;
      const end = text.indexOf("\n");
      context.report({
        range: [0, end === -1 ? text.length : end],
        message: `Maintenance scripts must include a '${marker}' section in the header.`,
        hint: `See ${ctx.codeStyle ?? "the utility script rules"}.`,
      });
    },
  };
}
