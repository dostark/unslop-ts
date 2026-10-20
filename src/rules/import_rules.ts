/**
 * @module ImportRules
 * @path src/rules/import_rules.ts
 * @description Rules about dynamic imports, inline import types, and re-exports of other modules.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/engine/glob.ts, src/engine/module_layout.ts]
 */

import type { JsonValue } from "../engine/catalog.ts";
import { matchesAnyGlob } from "../engine/glob.ts";
import { lineAt, lineStarts } from "../engine/module_layout.ts";
import { asNode, type ILintNode, isNodeLike, toLintNode } from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

interface IDynamicAllowance {
  readonly files: readonly string[];
  readonly specifiers: readonly RegExp[];
}

interface IImportedName {
  readonly line: number;
}

const EXPORT_NAMED = "ExportNamedDeclaration";
const EXPORT_ALL = "ExportAllDeclaration";
const IMPORT_DECLARATION = "ImportDeclaration";
/** The node types whose body is a statement scope, so a call inside them is not at the top level. */
const NESTED_SCOPES = new Set([
  "BlockStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassBody",
  "StaticBlock",
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "TryStatement",
  "SwitchStatement",
]);
const DYNAMIC_CALL_WORDS = "import";

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dynamicAllowances(value: JsonValue): IDynamicAllowance[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    files: stringList(entry.files),
    specifiers: stringList(entry.specifiers).map((pattern) => new RegExp(pattern)),
  }));
}

/** The text of a literal specifier, or null when the specifier is computed. */
function specifierOf(source: ILintNode | null): string | null {
  if (source === null) return null;
  return typeof source.value === "string" ? source.value : null;
}

function nodeOrNull(value: unknown): ILintNode | null {
  return isNodeLike(value) ? asNode(value) : null;
}

/** True when an allow entry covers this file and this specifier. */
function isAllowedDynamicImport(
  allowances: readonly IDynamicAllowance[],
  repoPath: string,
  specifier: string | null,
): boolean {
  return allowances.some((allowance) => {
    if (!matchesAnyGlob(repoPath, allowance.files)) return false;
    if (allowance.specifiers.length === 0) return true;
    return specifier !== null && allowance.specifiers.some((pattern) => pattern.test(specifier));
  });
}

/** True when some ancestor of the node is a block, a function, a class body, or a control statement. */
function isInsideStatement(node: ILintNode): boolean {
  for (let parent = nodeOrNull(node.parent); parent !== null; parent = nodeOrNull(parent.parent)) {
    if (NESTED_SCOPES.has(parent.type)) return true;
  }
  return false;
}

function dynamicImportVisitor(
  context: Deno.lint.RuleContext,
  ctx: IPluginRuleContext,
  shouldReport: (node: ILintNode) => boolean,
  message: string,
  hint: string,
): LintVisitor {
  const allowances = dynamicAllowances(ctx.options.allowDynamicImports);
  return {
    ImportExpression(rawNode: Deno.lint.Node): void {
      const node = asNode(rawNode);
      if (!shouldReport(node)) return;
      if (isAllowedDynamicImport(allowances, ctx.repoPath, specifierOf(nodeOrNull(node.source)))) return;
      context.report({ node: rawNode, message, hint });
    },
  };
}

export function createImportInsideStatement(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  return dynamicImportVisitor(
    context,
    ctx,
    isInsideStatement,
    `Use of ${DYNAMIC_CALL_WORDS}() inside other statements (for example in an if, a function, or a loop) is prohibited. All imports must be at the top level.`,
    "Move the import to the top of the module.",
  );
}

export function createDynamicImport(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  return dynamicImportVisitor(
    context,
    ctx,
    () => true,
    `Dynamic imports (${DYNAMIC_CALL_WORDS}(...)) are prohibited without a documented reason.`,
    `Write \`// deno-lint-ignore ${ctx.pluginName}/dynamic-import -- <reason>\` above the call.`,
  );
}

export function createInlineTypeImport(context: Deno.lint.RuleContext, _ctx: IPluginRuleContext): LintVisitor {
  return {
    TSImportType(rawNode: Deno.lint.Node): void {
      const node = asNode(rawNode);
      const parent = nodeOrNull(node.parent);
      if (parent !== null && parent.type === "TSTypeQuery") return;
      if (nodeOrNull(node.qualifier) === null) return;
      context.report({
        node: rawNode,
        message:
          "Inline type imports (an import type with a member access inside a type annotation) are prohibited. Declare an explicit `import type` at the top of the file.",
        hint: 'Write `import type { IName } from "./module.ts";` at the top of the file.',
      });
    },
  };
}

/** The imported local names of a module, mapped to the line where each is declared. */
function importedNames(program: ILintNode, starts: readonly number[]): Map<string, IImportedName> {
  const names = new Map<string, IImportedName>();
  const body = program.body;
  for (const statement of Array.isArray(body) ? body : []) {
    const node = nodeOrNull(statement);
    if (node === null || node.type !== IMPORT_DECLARATION) continue;
    for (const specifier of Array.isArray(node.specifiers) ? node.specifiers : []) {
      const local = nodeOrNull(nodeOrNull(specifier)?.local);
      if (local === null || typeof local.name !== "string" || local.range === undefined) continue;
      names.set(local.name, { line: lineAt(starts, local.range[0]) });
    }
  }
  return names;
}

export function createReExportImported(context: Deno.lint.RuleContext, _ctx: IPluginRuleContext): LintVisitor {
  return {
    Program(rawNode: Deno.lint.Node): void {
      const program = asNode(rawNode);
      const starts = lineStarts(context.sourceCode.text);
      const imported = importedNames(program, starts);
      for (const entry of Array.isArray(program.body) ? program.body : []) {
        const node = nodeOrNull(entry);
        if (node === null || node.range === undefined) continue;
        const source = nodeOrNull(node.source);
        if (node.type === EXPORT_ALL || (node.type === EXPORT_NAMED && source !== null)) {
          context.report({
            node: toLintNode(node),
            message:
              "Re-exporting entities from other modules (for example 'export { ... } from ...' or 'export * from ...') is prohibited. Each module must only export entities it defines.",
            hint: "Export the entity from its origin and import it where it is used.",
          });
          continue;
        }
        if (node.type !== EXPORT_NAMED || node.declaration) continue;
        const exportLine = lineAt(starts, node.range[0]);
        for (const specifier of Array.isArray(node.specifiers) ? node.specifiers : []) {
          const local = nodeOrNull(nodeOrNull(specifier)?.local);
          const name = typeof local?.name === "string" ? local.name : null;
          const origin = name === null ? undefined : imported.get(name);
          if (name === null || origin === undefined) continue;
          const message = origin.line + 1 === exportLine
            ? `Improper re-export of '${name}' on the next line after its import. Combine into 'export { ... } from ...' or define it locally.`
            : `Exporting imported entity '${name}' (imported on line ${origin.line}) is prohibited. Define it locally or export it from its origin.`;
          context.report({
            node: toLintNode(node),
            message,
            hint: "Define the entity locally or export it from its origin.",
          });
        }
      }
    },
  };
}
