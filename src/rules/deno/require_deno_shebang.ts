/**
 * @module RequireDenoShebang
 * @path packages/lint-rules/src/rules/deno/require_deno_shebang.ts
 * @description Reports a file whose first line does not start with the configured Deno shebang.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts, packages/lint-rules/src/rules/rule_options.ts]
 */

import type { IPluginRuleContext, LintVisitor } from "../types.ts";

/** The shebang a runnable Deno script starts with unless the catalog says otherwise. */
export const DEFAULT_DENO_SHEBANG = "#!/usr/bin/env -S deno run -A";

export function createRequireDenoShebang(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const shebang = String(ctx.options.shebang ?? DEFAULT_DENO_SHEBANG);
  return {
    Program(): void {
      const text = context.sourceCode.text;
      if (text.startsWith(shebang)) return;
      // Anchor the report to line 1, because the program node starts after any leading comment.
      const firstLineEnd = text.indexOf("\n");
      const end = firstLineEnd === -1 ? text.length : firstLineEnd;
      context.report({
        range: [0, end],
        message: `Maintenance scripts must start with '${shebang}'.`,
        hint: "Put the shebang on line 1, before any header comment.",
      });
    },
  };
}
