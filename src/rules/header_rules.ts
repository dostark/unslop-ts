/**
 * @module HeaderRules
 * @path src/rules/header_rules.ts
 * @description Rules about a module header comment and about a test file name that records a plan phase.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/comments.ts, src/rules/mod.ts]
 */

import { lineOfOffset, moduleHeaderComment } from "../engine/comments.ts";
import type { IPluginRuleContext, IRuleContext, LintVisitor } from "./types.ts";

const DEFAULT_MAX_START_LINE = 5;
const DEFAULT_FILENAME_PATTERN = "(?:^|[_.-])phase[-_]?(\\d+)(?:[_.-]|$)";
const DEFAULT_LABEL = "phase";

/** The range of the first line, so a whole-file report anchors to line 1. */
function firstLineRange(text: string): [number, number] {
  const end = text.indexOf("\n");
  return [0, end === -1 ? text.length : end];
}

export function createRequireModuleHeader(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const maxStartLine = typeof ctx.options.maxStartLine === "number" ? ctx.options.maxStartLine : DEFAULT_MAX_START_LINE;
  return {
    Program(): void {
      const text = context.sourceCode.text;
      const header = moduleHeaderComment(context.sourceCode);
      if (header && lineOfOffset(text, header.range[0]) <= maxStartLine) return;
      context.report({
        range: firstLineRange(text),
        message: "Modules should start with a descriptive header comment.",
        hint: `See ${ctx.codeStyle ?? "the module structure rules"}.`,
      });
    },
  };
}

export function createEphemeralFilename(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const pattern = new RegExp(
    typeof ctx.options.pattern === "string" ? ctx.options.pattern : DEFAULT_FILENAME_PATTERN,
    "i",
  );
  const label = typeof ctx.options.label === "string" ? ctx.options.label : DEFAULT_LABEL;
  return {
    Program(): void {
      if (!ctx.isTestFile) return;
      const basename = ctx.repoPath.slice(ctx.repoPath.lastIndexOf("/") + 1);
      const match = pattern.exec(basename);
      if (!match) return;
      context.report({
        range: firstLineRange(context.sourceCode.text),
        message: `Test file name embeds a numbered plan-phase reference ("${label}${
          match[1]
        }") — this is ephemeral implementation history in the path, same as in a comment. Name the file after the behavior it verifies; the phase-plan doc is the durable record of which phase introduced it.`,
        hint: `See ${ctx.codeStyle ?? "the comment discipline rules"}.`,
      });
    },
  };
}
