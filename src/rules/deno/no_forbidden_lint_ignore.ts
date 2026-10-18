/**
 * @module NoForbiddenLintIgnore
 * @path packages/lint-rules/src/rules/deno/no_forbidden_lint_ignore.ts
 * @description Reports a `deno-lint-ignore` comment that silences a rule the project forbids ignoring.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts, packages/lint-rules/src/rules/deno/ignore_directive.ts]
 */

import type { IPluginRuleContext, LintVisitor } from "../types.ts";
import { DEFAULT_REASON_SEPARATOR, parseIgnoreDirective } from "./ignore_directive.ts";

/** The rules no ignore comment may silence unless the catalog says otherwise. */
export const DEFAULT_FORBIDDEN_IGNORES: readonly string[] = ["no-explicit-any"];

export function createNoForbiddenLintIgnore(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const rawForbidden = ctx.options.forbiddenRules;
  const forbidden = new Set(Array.isArray(rawForbidden) ? rawForbidden.map(String) : DEFAULT_FORBIDDEN_IGNORES);
  const includeFileIgnores = ctx.options.includeFileIgnores !== false;
  return {
    Program(): void {
      for (const comment of context.sourceCode.getAllComments()) {
        // Deno honors an ignore directive only in a line comment.
        if (comment.type !== "Line") continue;
        const directive = parseIgnoreDirective(comment.value, DEFAULT_REASON_SEPARATOR);
        if (!directive || (directive.isFileDirective && !includeFileIgnores)) continue;
        for (const id of directive.ids) {
          if (!forbidden.has(id)) continue;
          context.report({
            range: comment.range,
            message: `Using '// deno-lint-ignore ${id}' is not allowed; address the typing issue explicitly.`,
            hint: "Fix the cause. Other ignore comments stay available.",
          });
        }
      }
    },
  };
}
