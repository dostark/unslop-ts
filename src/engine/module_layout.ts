/**
 * @module ModuleLayout
 * @path src/engine/module_layout.ts
 * @description Classifies the top-level statements of a module and finds where imports, types, and code start.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/module_layout_rules.ts, src/engine/type_environment.ts]
 */

import { asNode, type ILintNode, isNodeLike } from "./type_environment.ts";

export type StatementKind = "import" | "type" | "functional" | "skip";

export interface ILayoutStatement {
  readonly kind: StatementKind;
  readonly node: ILintNode;
  readonly startLine: number;
  readonly endLine: number;
}

export interface IModuleLayout {
  readonly statements: readonly ILayoutStatement[];
  /** The first type, interface, enum, or declare statement. */
  readonly firstType: ILayoutStatement | null;
  /** The end line of the last import-like statement, or null when the module has none. */
  readonly lastImportEndLine: number | null;
  /** The first statement that is neither an import, a type definition, nor an export list. */
  readonly firstFunctional: ILayoutStatement | null;
  /** The first import-like statement that comes after functional code. */
  readonly firstImportAfterFunctional: ILayoutStatement | null;
}

const IMPORT_STATEMENTS = new Set(["ImportDeclaration", "ExportAllDeclaration", "TSImportEqualsDeclaration"]);
const TYPE_DECLARATIONS = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration"]);
const EXPORT_NAMED = "ExportNamedDeclaration";
const EXPORT_DEFAULT = "ExportDefaultDeclaration";
const NEWLINE_CODE = 10;

function classifyDeclaration(node: ILintNode): StatementKind {
  return TYPE_DECLARATIONS.has(node.type) || node.declare === true ? "type" : "functional";
}

/** What a top-level statement is for the purpose of placement rules. */
function classifyStatement(node: ILintNode): StatementKind {
  if (IMPORT_STATEMENTS.has(node.type)) return "import";
  if (node.type === EXPORT_NAMED) {
    if (isNodeLike(node.source)) return "import";
    if (isNodeLike(node.declaration)) return classifyDeclaration(asNode(node.declaration));
    return "skip";
  }
  if (node.type === EXPORT_DEFAULT) {
    return isNodeLike(node.declaration) && TYPE_DECLARATIONS.has(asNode(node.declaration).type) ? "type" : "functional";
  }
  return classifyDeclaration(node);
}

/** The offsets at which each line of the text starts. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === NEWLINE_CODE) starts.push(index + 1);
  }
  return starts;
}

/** The 1-based line that holds the offset. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

function rangeOf(node: ILintNode): readonly [number, number] {
  return node.range ?? [0, 0];
}

/** Builds the layout of a program from its top-level statements. */
export function layoutOf(program: ILintNode, text: string): IModuleLayout {
  const starts = lineStarts(text);
  const body = program.body;
  const statements: ILayoutStatement[] = [];
  for (const entry of Array.isArray(body) ? body : []) {
    if (!isNodeLike(entry)) continue;
    const node = asNode(entry);
    const [from, to] = rangeOf(node);
    statements.push({
      kind: classifyStatement(node),
      node,
      startLine: lineAt(starts, from),
      endLine: lineAt(starts, Math.max(from, to - 1)),
    });
  }
  const firstType = statements.find((statement) => statement.kind === "type") ?? null;
  const imports = statements.filter((statement) => statement.kind === "import");
  const firstFunctional = statements.find((statement) => statement.kind === "functional") ?? null;
  const firstImportAfterFunctional = firstFunctional === null
    ? null
    : imports.find((statement) => statement.startLine > firstFunctional.startLine) ?? null;
  return {
    statements,
    firstType,
    lastImportEndLine: imports.length === 0 ? null : Math.max(...imports.map((statement) => statement.endLine)),
    firstFunctional,
    firstImportAfterFunctional,
  };
}
