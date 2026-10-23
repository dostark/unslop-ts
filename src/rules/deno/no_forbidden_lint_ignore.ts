/**
 * @module NoForbiddenLintIgnore
 * @path src/rules/deno/no_forbidden_lint_ignore.ts
 * @description Reports a `deno-lint-ignore` comment that silences a rule the project forbids ignoring.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/rules/deno/ignore_directive.ts]
 */

import type { IPluginRuleContext, IRuleContext, LintVisitor } from "../types.ts";
import { DEFAULT_REASON_SEPARATOR, parseIgnoreDirective, resolveDialects } from "./ignore_directive.ts";

/** The rules no ignore comment may silence unless the catalog says otherwise. */
export const DEFAULT_FORBIDDEN_IGNORES: readonly string[] = ["no-explicit-any"];

export function createNoForbiddenLintIgnore(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const rawForbidden = ctx.options.forbiddenRules;
  const forbidden = new Set(Array.isArray(rawForbidden) ? rawForbidden.map(String) : DEFAULT_FORBIDDEN_IGNORES);
  const includeFileIgnores = ctx.options.includeFileIgnores !== false;
  const dialects = resolveDialects(ctx.options.dialects, ctx.dialects);
  return {
    Program(): void {
      for (const comment of context.sourceCode.getAllComments()) {
        const directive = parseIgnoreDirective(comment.value, DEFAULT_REASON_SEPARATOR, dialects);
        // Deno honors an ignore directive only in a line comment.
        if (directive?.dialect === "deno" && comment.type !== "Line") continue;
        if (!directive || (directive.isFileDirective && !includeFileIgnores)) continue;
        for (const id of directive.ids) {
          if (!forbidden.has(id)) continue;
          context.report({
            range: comment.range,
            message: `Using '// ${directive.directive} ${id}' is not allowed; address the typing issue explicitly.`,
            hint: "Fix the cause. Other ignore comments stay available.",
          });
        }
      }
    },
  };
}
