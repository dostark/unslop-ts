/**
 * @module IgnoreNeedsReason
 * @path packages/lint-rules/src/rules/deno/ignore_needs_reason.ts
 * @description Requires a reason on a `deno-lint-ignore <plugin>/<rule>` comment.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts, packages/lint-rules/src/rules/deno/ignore_directive.ts]
 */

import type { IPluginRuleContext, LintVisitor } from "../types.ts";
import { DEFAULT_REASON_SEPARATOR, parseIgnoreDirective } from "./ignore_directive.ts";

export function createIgnoreNeedsReason(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const idPrefix = `${ctx.pluginName}/`;
  const separator = typeof ctx.options.separator === "string" ? ctx.options.separator : DEFAULT_REASON_SEPARATOR;
  for (const comment of context.sourceCode.getAllComments()) {
    const directive = parseIgnoreDirective(comment.value, separator);
    if (!directive) continue;
    if (!directive.ids.some((id) => id.startsWith(idPrefix))) continue;
    if (directive.reason.length > 0) continue;
    context.report({
      range: comment.range,
      message: `A 'deno-lint-ignore' for a rule of the '${ctx.pluginName}' plugin needs a reason after '${separator}'.`,
      hint: `Write \`// deno-lint-ignore ${directive.ids[0]} ${separator} <reason>\`.`,
    });
  }
  return {};
}
