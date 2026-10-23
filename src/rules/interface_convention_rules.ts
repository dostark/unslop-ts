/**
 * @module InterfaceConventionRules
 * @path src/rules/interface_convention_rules.ts
 * @description Opt-in naming rules for interfaces: a prefix on every exported interface, and no rename of a prefixed interface on import.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/rules/rule_options.ts]
 */

import { asNode, type ILintNode } from "../engine/type_environment.ts";
import type { IPluginRuleContext, IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

const DEFAULT_PREFIX = "I";
const DEFAULT_GUIDE = "the interface naming rules";
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function prefixOf(ctx: IPluginRuleContext): string {
  return typeof ctx.options.prefix === "string" ? ctx.options.prefix : DEFAULT_PREFIX;
}

/** True when the name starts with the prefix and the character after it is not lowercase. */
function hasInterfacePrefix(name: string, prefix: string): boolean {
  const next = name.charAt(prefix.length);
  return name.startsWith(prefix) && next === next.toUpperCase();
}

export function createExportedInterfaceNaming(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const prefix = prefixOf(ctx);
  const codeStyle = ctx.codeStyle ?? DEFAULT_GUIDE;
  return {
    "ExportNamedDeclaration > TSInterfaceDeclaration"(node: IRuleNode): void {
      const id = asNode(node).id;
      const name = id && typeof id === "object" ? asNode(id).name : undefined;
      if (typeof name !== "string" || hasInterfacePrefix(name, prefix)) return;
      context.report({
        node,
        message: `Exported interface '${name}' must start with a capital '${prefix}' (e.g., ${prefix}${name}).`,
        hint: `Name exported interfaces with a capital ${prefix} prefix. See ${codeStyle}.`,
      });
    },
  };
}

function nameOf(node: ILintNode | undefined): string | null {
  if (!node) return null;
  if (typeof node.name === "string") return node.name;
  return typeof node.value === "string" ? node.value : null;
}

export function createNoInterfaceRenameOnImport(context: IRuleContext, ctx: IPluginRuleContext): LintVisitor {
  const prefix = prefixOf(ctx);
  const interfaceName = new RegExp(`^${prefix.replace(REGEX_SPECIALS, "\\$&")}[A-Z]`);
  const codeStyle = ctx.codeStyle ?? DEFAULT_GUIDE;
  return {
    ImportSpecifier(rawNode: IRuleNode): void {
      const node = asNode(rawNode);
      const imported = nameOf(node.imported ? asNode(node.imported) : undefined);
      const local = nameOf(node.local ? asNode(node.local) : undefined);
      if (imported === null || local === null || imported === local || !interfaceName.test(imported)) return;
      context.report({
        node: rawNode,
        message: `Renaming interface '${imported}' to '${local}' is prohibited. Use the original name.`,
        hint: `Import the interface under its own name. See ${codeStyle}.`,
      });
    },
  };
}
