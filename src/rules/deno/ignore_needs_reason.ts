/**
 * @module IgnoreNeedsReason
 * @path src/rules/deno/ignore_needs_reason.ts
 * @description Requires a reason on a `deno-lint-ignore <plugin>/<rule>` comment.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/rules/deno/ignore_directive.ts]
 */

import type { IPluginRuleContext, IRuleContext, LintVisitor } from "../types.ts";
import { DEFAULT_REASON_SEPARATOR, parseIgnoreDirective, resolveDialects } from "./ignore_directive.ts";

export function createIgnoreNeedsReason(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const idPrefix = `${ctx.pluginName}/`;
  const separator = typeof ctx.options.separator === "string" ? ctx.options.separator : DEFAULT_REASON_SEPARATOR;
  const dialects = resolveDialects(ctx.options.dialects, ctx.dialects);
  for (const comment of context.sourceCode.getAllComments()) {
    const directive = parseIgnoreDirective(comment.value, separator, dialects);
    if (!directive) continue;
    if (directive.dialect === "deno" && comment.type !== "Line") continue;
    if (!directive.ids.some((id) => id.startsWith(idPrefix))) continue;
    if (directive.reason.length > 0) continue;
    context.report({
      range: comment.range,
      message:
        `A '${directive.directive}' for a rule of the '${ctx.pluginName}' plugin needs a reason after '${separator}'.`,
      hint: `Write \`// ${directive.directive} ${directive.ids[0]} ${separator} <reason>\`.`,
    });
  }
  return {};
}
