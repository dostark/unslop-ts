/**
 * @module ReexportRules
 * @path src/rules/reexport_rules.ts
 * @description Rule that keeps module re-exports in barrel files.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/rules/rule_options.ts]
 */

import { asNode } from "../engine/type_environment.ts";
import { BarrelOnlyReExportsOptions } from "./rule_options.ts";
import type { IPluginRuleContext, IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

const DEFAULT_GUIDE = "the module structure rules";

/** True when the path names a barrel file under the configured suffixes. */
function isBarrel(repoPath: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => repoPath.endsWith(suffix));
}

export function createBarrelOnlyReExports(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const options = BarrelOnlyReExportsOptions.parse(ctx.options);
  if (ctx.isTestFile) return {};
  if (isBarrel(ctx.repoPath, options.barrelSuffixes)) return {};
  if (options.allowPaths.some((prefix) => ctx.repoPath.startsWith(prefix))) return {};
  const report = (node: IRuleNode): void => {
    context.report({
      node,
      message: `A module re-export belongs in a barrel file (${
        options.barrelSuffixes.join(", ")
      }), not in an ordinary module.`,
      hint: `See ${ctx.codeStyle ?? DEFAULT_GUIDE}.`,
    });
  };
  return {
    ExportNamedDeclaration(node: IRuleNode): void {
      if (asNode(node).source) report(node);
    },
    ExportAllDeclaration(node: IRuleNode): void {
      report(node);
    },
  };
}
