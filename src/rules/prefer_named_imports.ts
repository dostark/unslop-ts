/**
 * @module PreferNamedImports
 * @path src/rules/prefer_named_imports.ts
 * @description Reports a namespace import whose members are all read as static member accesses.
 * @architectural-layer Shared
 * @related-files [src/rules/mod.ts, src/rules/import_rules.ts]
 */

import { asNode, type ILintNode, isNodeLike } from "../engine/type_environment.ts";
import type { IPluginRuleContext, IRuleContext, IRuleNode, LintVisitor } from "./types.ts";

const IMPORT_DECLARATION = "ImportDeclaration";
const NAMESPACE_SPECIFIER = "ImportNamespaceSpecifier";
const RULE_ID = "prefer-named-imports";
const PRAGMA = /unslop-ignore-next-line\b(.*)/;
const MEMBER = "[A-Za-z_$][A-Za-z0-9_$]*";

/** The local name a namespace import declares, or null for any other specifier. */
function namespaceName(specifiers: unknown): string | null {
  for (const rawSpecifier of Array.isArray(specifiers) ? specifiers : []) {
    const specifier = isNodeLike(rawSpecifier) ? asNode(rawSpecifier) : null;
    if (specifier === null || specifier.type !== NAMESPACE_SPECIFIER) continue;
    const local = isNodeLike(specifier.local) ? asNode(specifier.local) : null;
    if (local !== null && typeof local.name === "string") return local.name;
  }
  return null;
}

/** True when a preceding `unslop-ignore-next-line` comment lists this rule or no rule. */
function hasPragma(context: IRuleContext, node: ILintNode): boolean {
  for (const comment of context.sourceCode.getCommentsBefore(node)) {
    const match = PRAGMA.exec(comment.value.trim());
    if (match === null) continue;
    const ids = match[1].split(/[,\s]+/).filter((part) => part.length > 0);
    if (ids.length === 0 || ids.includes(RULE_ID)) return true;
  }
  return false;
}

/** The distinct member names read as `namespace.member`, in first-use order. */
function memberNames(text: string, namespace: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(new RegExp(`\\b${namespace}\\.(${MEMBER})`, "g"))) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** True when the namespace is used as a whole value, spread, or indexed dynamically. */
function isDynamicUse(text: string, namespace: string, node: ILintNode): boolean {
  if (new RegExp(`\\.\\.\\.\\s*${namespace}\\b`).test(text)) return true;
  if (new RegExp(`\\b${namespace}\\s*\\[`).test(text)) return true;
  const range = node.range;
  for (const match of text.matchAll(new RegExp(`\\b${namespace}\\b`, "g"))) {
    const index = match.index ?? 0;
    if (range !== undefined && index >= range[0] && index < range[1]) continue;
    const next = text.slice(index + namespace.length, index + namespace.length + 4).trimStart()[0] ?? "";
    if (next === "." || next === '"' || next === "'" || next === "`") continue;
    return true;
  }
  return false;
}

/** Reports a namespace import that can become a named import. */
export function createPreferNamedImports(context: IRuleContext, _ctx: IPluginRuleContext): LintVisitor {
  return {
    ImportDeclaration(rawNode: IRuleNode): void {
      const node = asNode(rawNode);
      if (node.type !== IMPORT_DECLARATION) return;
      const namespace = namespaceName(node.specifiers);
      if (namespace === null) return;
      const text = context.sourceCode.text;
      const members = memberNames(text, namespace);
      if (members.length === 0) return;
      if (isDynamicUse(text, namespace, node)) return;
      if (hasPragma(context, node)) return;
      const range = node.range;
      const statement = range === undefined ? "" : text.slice(range[0], range[1]);
      const typeOnly = /^import\s+type\b/.test(statement);
      const source = isNodeLike(node.source) ? String(asNode(node.source).value) : "";
      context.report({
        node: rawNode,
        message: `Namespace import '${namespace}' reads only static members (${
          members.join(", ")
        }); import them by name.`,
        hint: `${typeOnly ? "import type" : "import"} { ${members.join(", ")} } from "${source}";`,
      });
    },
  };
}
