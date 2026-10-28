/**
 * @module WholeTreeUnusedEnumMembers
 * @path src/rules/whole_tree/unused_enum_members.ts
 * @description Lists the enum members that no `Enum.Member` reference reaches. A reference resolves through imports, aliases, barrels, and namespace imports to the enum it names, and an enum used as a whole value uses every member. Only the configured `publicEntries` files make an enum public API; a manifest export does not.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/unused_exports_resolved.ts, src/rules/whole_tree/unused_exports.ts]
 */

import ts from "typescript";
import type { IModuleGraph } from "./unused_exports_resolved.ts";

const KEY_SEPARATOR = "\0";
const DEFAULT_EXPORT = "default";
const IGNORE_NEXT_LINE = /unslop-ignore-next-line\s+unused-enum-member\b/;
/** Generic types whose type arguments require every member of an enum argument. */
const EXHAUSTIVE_GENERICS: ReadonlySet<string> = new Set([
  "Record",
  "Partial",
  "Required",
  "Exclude",
  "Extract",
  "Omit",
  "Pick",
]);

/** One enum member that no reference reaches. */
export interface IUnusedEnumMember {
  readonly repoPath: string;
  readonly enumName: string;
  readonly member: string;
  readonly line: number;
}

/** The inputs of the enum member check. */
export interface IEnumMemberInput {
  readonly graph: IModuleGraph;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  /** True for the files whose enums the report lists. */
  readonly isScanned: (repoPath: string) => boolean;
}

interface IEnumMember {
  readonly name: string;
  readonly line: number;
  readonly exempt: boolean;
}

/** One enum declaration and what the references found for it. */
interface IEnumDef {
  readonly repoPath: string;
  readonly name: string;
  readonly node: ts.EnumDeclaration;
  readonly members: readonly IEnumMember[];
  readonly used: Set<string>;
  exported: boolean;
  escaped: boolean;
}

function keyOf(repoPath: string, name: string): string {
  return `${repoPath}${KEY_SEPARATOR}${name}`;
}

function memberName(member: ts.EnumMember): string {
  return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : member.name.getText();
}

function hasPragma(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  const text = sourceFile.getFullText();
  return (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).some((range) =>
    IGNORE_NEXT_LINE.test(text.slice(range.pos, range.end))
  );
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** The enum declarations of one file, with the exports that hide them from reference counting. */
function collectEnums(repoPath: string, sourceFile: ts.SourceFile): IEnumDef[] {
  const defs = new Map<string, IEnumDef>();
  for (const statement of sourceFile.statements) {
    if (!ts.isEnumDeclaration(statement)) continue;
    const closed = hasPragma(sourceFile, statement);
    const members = statement.members.map((member): IEnumMember => ({
      name: memberName(member),
      line: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
      exempt: closed || hasPragma(sourceFile, member),
    }));
    defs.set(statement.name.text, {
      repoPath,
      name: statement.name.text,
      node: statement,
      members,
      used: new Set(),
      exported: isExported(statement),
      escaped: false,
    });
  }
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const def = defs.get(statement.expression.text);
      if (def) def.escaped = true;
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const def = defs.get((element.propertyName ?? element.name).text);
      if (!def) continue;
      if (element.propertyName) def.escaped = true;
      else def.exported = true;
    }
  }
  return [...defs.values()];
}

/** True when the identifier names a declaration or a member, so it is not a read of a binding. */
function isNamePosition(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) {
    return ts.isPropertyAccessExpression(parent) ? parent.name === id : parent.right === id;
  }
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return true;
  if (ts.isExportSpecifier(parent)) return true;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  // SAFETY: every declaration node kind that names itself stores the identifier in `name`.
  return (parent as ts.Node & { name?: ts.Node }).name === id;
}

/** True when the type reference is an argument of a generic type that needs every member of the enum. */
function isExhaustiveTypeArgument(reference: ts.TypeReferenceNode): boolean {
  const parent = reference.parent;
  if (ts.isTypeReferenceNode(parent) && ts.isIdentifier(parent.typeName)) {
    return EXHAUSTIVE_GENERICS.has(parent.typeName.text);
  }
  return ts.isTypeParameterDeclaration(parent) && ts.isMappedTypeNode(parent.parent);
}

function stringArgument(access: ts.ElementAccessExpression): string | null {
  const argument = access.argumentExpression;
  return ts.isStringLiteralLike(argument) ? argument.text : null;
}

/** The enum declarations of the scanned files and the import graph that resolves a reference to one. */
interface IEnumContext {
  readonly graph: IModuleGraph;
  readonly defs: ReadonlyMap<string, IEnumDef>;
}

/** The exported enums that the name `name` of `module` reaches through re-exports. */
function reach(context: IEnumContext, module: string, name: string, seen = new Set<string>()): IEnumDef[] {
  const key = keyOf(module, name);
  if (seen.has(key)) return [];
  seen.add(key);
  const def = context.defs.get(key);
  const found: IEnumDef[] = def?.exported ? [def] : [];
  const edges = context.graph.edges.get(module);
  const forward = edges?.forwards.get(name);
  if (forward) {
    for (const target of context.graph.targetsOf(module, forward.specifier)) {
      found.push(...reach(context, target, forward.original, seen));
    }
  }
  if (name === DEFAULT_EXPORT) return found;
  for (const specifier of edges?.stars ?? []) {
    for (const target of context.graph.targetsOf(module, specifier)) found.push(...reach(context, target, name, seen));
  }
  return found;
}

/** Every exported enum that `module` defines or forwards. */
function reachAll(context: IEnumContext, module: string, seen = new Set<string>()): IEnumDef[] {
  if (seen.has(module)) return [];
  seen.add(module);
  const edges = context.graph.edges.get(module);
  const found = [...context.defs.values()].filter((def) => def.repoPath === module && def.exported);
  for (const name of edges?.forwards.keys() ?? []) found.push(...reach(context, module, name));
  for (const specifier of edges?.stars ?? []) {
    for (const target of context.graph.targetsOf(module, specifier)) found.push(...reachAll(context, target, seen));
  }
  return found;
}

function markMember(list: readonly IEnumDef[], member: string): void {
  for (const def of list) def.used.add(member);
}

function escapeAll(list: readonly IEnumDef[]): void {
  for (const def of list) def.escaped = true;
}

/** Records one read of an enum binding by the shape of the expression that holds it. */
function useBinding(id: ts.Identifier, list: readonly IEnumDef[]): void {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === id) return markMember(list, parent.name.text);
  if (ts.isQualifiedName(parent) && parent.left === id) return markMember(list, parent.right.text);
  if (ts.isElementAccessExpression(parent) && parent.expression === id) {
    const literal = stringArgument(parent);
    return literal === null ? escapeAll(list) : markMember(list, literal);
  }
  if (ts.isTypeReferenceNode(parent) && parent.typeName === id) {
    if (isExhaustiveTypeArgument(parent)) escapeAll(list);
    return;
  }
  escapeAll(list);
}

/** The `ns.Enum` expression or type name that a namespace identifier starts, or null when the namespace escapes. */
function enumAccessOf(id: ts.Identifier): ts.PropertyAccessExpression | ts.QualifiedName | null {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === id) return parent;
  return ts.isQualifiedName(parent) && parent.left === id ? parent : null;
}

/** Records one read of a namespace import: `ns.Enum.Member` uses a member, and any other read escapes. */
function useNamespace(context: IEnumContext, id: ts.Identifier, targets: readonly string[]): void {
  const access = enumAccessOf(id);
  if (!access) return escapeAll(targets.flatMap((target) => reachAll(context, target)));
  const enumName = ts.isPropertyAccessExpression(access) ? access.name.text : access.right.text;
  const list = targets.flatMap((target) => reach(context, target, enumName));
  const outer = access.parent;
  if (ts.isPropertyAccessExpression(outer) && outer.expression === access) markMember(list, outer.name.text);
  else if (ts.isQualifiedName(outer) && outer.left === access) markMember(list, outer.right.text);
  else if (!(ts.isTypeReferenceNode(outer) && outer.typeName === access)) escapeAll(list);
}

/** The enums that each local name of a file denotes, and the modules that its namespace imports name. */
interface IFileBindings {
  readonly enums: Map<string, IEnumDef[]>;
  readonly namespaces: Map<string, string[]>;
}

function bindingsOf(context: IEnumContext, repoPath: string, sourceFile: ts.SourceFile): IFileBindings {
  const bindings: IFileBindings = { enums: new Map(), namespaces: new Map() };
  for (const def of context.defs.values()) if (def.repoPath === repoPath) bindings.enums.set(def.name, [def]);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const targets = context.graph.targetsOf(repoPath, statement.moduleSpecifier.text);
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) bindings.namespaces.set(named.name.text, targets);
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      const found = targets.flatMap((target) => reach(context, target, (element.propertyName ?? element.name).text));
      if (found.length > 0) bindings.enums.set(element.name.text, found);
    }
  }
  return bindings;
}

/** Records every read of an enum binding or a namespace import in one file. */
function recordReferences(context: IEnumContext, sourceFile: ts.SourceFile, bindings: IFileBindings): void {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isNamePosition(node)) {
      const list = bindings.enums.get(node.text);
      if (list) useBinding(node, list);
      const targets = bindings.namespaces.get(node.text);
      if (targets) useNamespace(context, node, targets);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** A member name inside an initializer of its own enum reads a sibling member. */
function recordSiblingReferences(def: IEnumDef): void {
  const siblings = new Set(def.members.map((member) => member.name));
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && siblings.has(node.text)) def.used.add(node.text);
    ts.forEachChild(node, visit);
  };
  for (const member of def.node.members) if (member.initializer) visit(member.initializer);
}

function listUnused(defs: Iterable<IEnumDef>, isScanned: (repoPath: string) => boolean): IUnusedEnumMember[] {
  const unused: IUnusedEnumMember[] = [];
  for (const def of defs) {
    if (def.escaped || !isScanned(def.repoPath)) continue;
    for (const member of def.members) {
      if (member.exempt || def.used.has(member.name)) continue;
      unused.push({ repoPath: def.repoPath, enumName: def.name, member: member.name, line: member.line });
    }
  }
  return unused;
}

/** Lists the enum members that no reference reaches. */
export function findUnusedEnumMembers(input: IEnumMemberInput): IUnusedEnumMember[] {
  const defs = new Map<string, IEnumDef>();
  for (const [repoPath, sourceFile] of input.sourceFiles) {
    for (const def of collectEnums(repoPath, sourceFile)) defs.set(keyOf(repoPath, def.name), def);
  }
  const context: IEnumContext = { graph: input.graph, defs };
  for (const [repoPath, sourceFile] of input.sourceFiles) {
    const bindings = bindingsOf(context, repoPath, sourceFile);
    if (bindings.enums.size > 0 || bindings.namespaces.size > 0) recordReferences(context, sourceFile, bindings);
  }
  for (const def of defs.values()) recordSiblingReferences(def);
  for (const entry of input.graph.configuredFiles) escapeAll(reachAll(context, entry));
  return listUnused(defs.values(), input.isScanned);
}
