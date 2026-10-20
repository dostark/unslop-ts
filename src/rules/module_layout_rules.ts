/**
 * @module ModuleLayoutRules
 * @path src/rules/module_layout_rules.ts
 * @description Rules about where imports, type definitions, and exported interfaces sit in a module.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/module_layout.ts, src/rules/mod.ts]
 */

import { layoutOf } from "../engine/module_layout.ts";
import { asNode, toLintNode } from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

const EXPORT_NAMED = "ExportNamedDeclaration";
const INTERFACE_DECLARATION = "TSInterfaceDeclaration";

export function createImportPlacement(context: Deno.lint.RuleContext, _ctx: IPluginRuleContext): LintVisitor {
  return {
    Program(rawNode: Deno.lint.Node): void {
      const layout = layoutOf(asNode(rawNode), context.sourceCode.text);
      const { firstType, lastImportEndLine, firstImportAfterFunctional, firstFunctional } = layout;
      if (firstType !== null && lastImportEndLine !== null && firstType.startLine < lastImportEndLine) {
        context.report({
          node: toLintNode(firstType.node),
          message: `Interface/type definitions must follow all imports (last import at line ${lastImportEndLine}).`,
          hint: "Move the type definitions below the last import.",
        });
      }
      if (firstImportAfterFunctional !== null && firstFunctional !== null) {
        context.report({
          node: toLintNode(firstImportAfterFunctional.node),
          message:
            `Imports must be at the top, preceding functional code (functional code started at line ${firstFunctional.startLine}).`,
          hint: "Move the import to the top of the module.",
        });
      }
    },
  };
}

export function createExportedInterfacePlacement(
  context: Deno.lint.RuleContext,
  _ctx: IPluginRuleContext,
): LintVisitor {
  return {
    Program(rawNode: Deno.lint.Node): void {
      const layout = layoutOf(asNode(rawNode), context.sourceCode.text);
      const functional = layout.firstFunctional;
      if (functional === null) return;
      for (const statement of layout.statements) {
        if (statement.startLine <= functional.startLine) continue;
        const declaration = statement.node.declaration;
        const isExportedInterface = statement.node.type === EXPORT_NAMED &&
          typeof declaration === "object" && declaration !== null && !Array.isArray(declaration) &&
          asNode(declaration).type === INTERFACE_DECLARATION;
        if (!isExportedInterface) continue;
        context.report({
          node: toLintNode(statement.node),
          message:
            `Exported interfaces must be at the top, preceding functional code (functional code started at line ${functional.startLine}).`,
          hint: "Declare exported interfaces right after the imports.",
        });
      }
    },
  };
}
