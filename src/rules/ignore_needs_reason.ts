/**
 * @module IgnoreNeedsReason
 * @path packages/lint-rules/src/rules/ignore_needs_reason.ts
 * @description Requires a reason on a `deno-lint-ignore exaix/<rule>` comment.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts]
 */

import type { IPluginRuleContext, LintVisitor } from "./types.ts";

interface IComment {
  readonly type: string;
  readonly value: string;
}

const IGNORE_PATTERN = /^\s*deno-lint-ignore(?:-file)?\s+(.+)$/;

export function createIgnoreNeedsReason(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const separator = typeof ctx.options.separator === "string" ? ctx.options.separator : "--";
  const sourceCode = context.sourceCode as { getAllComments(): IComment[]; ast: Deno.lint.Node };
  for (const comment of sourceCode.getAllComments()) {
    const match = comment.value.match(IGNORE_PATTERN);
    if (!match) continue;
    const rest = match[1];
    const separatorIndex = rest.indexOf(separator);
    const idsPart = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
    const reason = separatorIndex === -1 ? "" : rest.slice(separatorIndex + separator.length).trim();
    const ids = idsPart.split(/[\s,]+/).filter((id) => id.length > 0);
    if (!ids.some((id) => id.startsWith("exaix/"))) continue;
    if (reason.length > 0) continue;
    context.report({
      node: sourceCode.ast,
      message: `A 'deno-lint-ignore' for an exaix rule needs a reason after '${separator}'.`,
      hint: `Write \`// deno-lint-ignore ${ids[0]} ${separator} <reason>\`.`,
    });
  }
  return {};
}
