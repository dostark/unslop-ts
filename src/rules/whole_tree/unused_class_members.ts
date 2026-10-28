/**
 * @module WholeTreeUnusedClassMembers
 * @path src/rules/whole_tree/unused_class_members.ts
 * @description Lists the class members that nothing reads. A private member is checked inside its class, and a public or protected method or accessor is listed when its name is accessed nowhere in the walked files. A member that an implemented interface, an extended base, or the runtime calls is a contract and is never listed.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/definition_reach.ts, src/rules/whole_tree/unused_enum_members.ts, src/rules/whole_tree/unused_exports.ts]
 */

import ts from "typescript";
import { hasPragma, isExported } from "./declaration_markers.ts";
import { createDefinitionReach, definitionKey, type IDefinitionReach, type IFileBindings } from "./definition_reach.ts";
import type { IModuleGraph } from "./unused_exports_resolved.ts";

const IGNORE_NEXT_LINE = /unslop-ignore-next-line\s+unused-class-member\b/;
/** Names that the runtime or the language calls on any object. */
const RUNTIME_NAMES: ReadonlySet<string> = new Set([
  "toString",
  "toJSON",
  "toLocaleString",
  "valueOf",
  "then",
  "next",
  "return",
  "throw",
]);
/** The members that a subclass of a built-in error inherits. */
const ERROR_MEMBERS: readonly string[] = ["name", "message", "cause", "stack", "toString", "errors"];
const ERROR_BASES: ReadonlySet<string> = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
]);

/** One class member that nothing reads. */
export interface IUnusedClassMember {
  readonly repoPath: string;
  readonly className: string;
  readonly member: string;
  readonly line: number;
}

/** The inputs of the class member check. */
export interface IClassMemberInput {
  readonly graph: IModuleGraph;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  /** True for the files whose classes the report lists. */
  readonly isScanned: (repoPath: string) => boolean;
}

/** A class or an interface declaration: the types whose members are contracts for the classes that name them. */
interface ITypeDef {
  readonly repoPath: string;
  readonly name: string;
  readonly node: ts.ClassDeclaration | ts.InterfaceDeclaration;
  exported: boolean;
}

/** The names a class owes to its heritage, or every name when a base cannot be resolved. */
type Contract = ReadonlySet<string> | "all";

/** One candidate member of a class. */
interface ICandidate {
  readonly name: string;
  readonly line: number;
  readonly isPrivate: boolean;
  readonly node: ts.ClassElement | ts.ParameterDeclaration;
}

/** The plain name of a member, including the `#` of a private name. A computed name has none. */
function memberNameOf(name: ts.Node | undefined): string | null {
  if (!name) return null;
  const isPlain = ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ||
    ts.isPrivateIdentifier(name);
  return isPlain ? name.text : null;
}

function modifiersOf(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiersOf(node).some((modifier) => modifier.kind === kind);
}

function isDecorated(node: ts.Node): boolean {
  return ts.canHaveDecorators(node) && (ts.getDecorators(node) ?? []).length > 0;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isPrivateMember(name: ts.Node | undefined, node: ts.Node): boolean {
  return (name !== undefined && ts.isPrivateIdentifier(name)) || hasModifier(node, ts.SyntaxKind.PrivateKeyword);
}

/** The member names that an interface or class declaration lists. */
function declaredNames(node: ts.ClassDeclaration | ts.InterfaceDeclaration): string[] {
  const names: string[] = [];
  for (const member of node.members) {
    const name = memberNameOf(ts.getNameOfDeclaration(member));
    if (name !== null) names.push(name);
  }
  return names;
}

/** True for a member that a heritage clause, a keyword, or a decorator already ties to a caller. */
function isTiedMember(node: ts.ClassElement): boolean {
  return hasModifier(node, ts.SyntaxKind.AbstractKeyword) || hasModifier(node, ts.SyntaxKind.OverrideKeyword) ||
    isDecorated(node);
}

function parameterProperties(constructor: ts.ConstructorDeclaration, sourceFile: ts.SourceFile): ICandidate[] {
  const candidates: ICandidate[] = [];
  for (const parameter of constructor.parameters) {
    if (!ts.isIdentifier(parameter.name) || !hasModifier(parameter, ts.SyntaxKind.PrivateKeyword)) continue;
    candidates.push({
      name: parameter.name.text,
      line: lineOf(sourceFile, parameter),
      isPrivate: true,
      node: parameter,
    });
  }
  return candidates;
}

/** The members of a class that the check may list. Public fields stay out, because serialization can read them. */
function candidatesOf(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): ICandidate[] {
  const candidates: ICandidate[] = [];
  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      candidates.push(...parameterProperties(member, sourceFile));
      continue;
    }
    const isCallable = ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member);
    const isField = ts.isPropertyDeclaration(member);
    if ((!isCallable && !isField) || isTiedMember(member)) continue;
    const name = memberNameOf(member.name);
    if (name === null) continue;
    const isPrivate = isPrivateMember(member.name, member);
    if (isField && !isPrivate) continue;
    candidates.push({ name, line: lineOf(sourceFile, member), isPrivate, node: member });
  }
  return candidates;
}

/** Every class and interface declaration of the walked files. */
function collectTypes(sourceFiles: ReadonlyMap<string, ts.SourceFile>): Map<string, ITypeDef> {
  const defs = new Map<string, ITypeDef>();
  for (const [repoPath, sourceFile] of sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) continue;
      if (!statement.name) continue;
      const name = statement.name.text;
      defs.set(definitionKey(repoPath, name), { repoPath, name, node: statement, exported: isExported(statement) });
    }
    markListedExports(repoPath, sourceFile, defs);
  }
  return defs;
}

/** An `export { Name }` list exports a declaration of the same file. */
function markListedExports(repoPath: string, sourceFile: ts.SourceFile, defs: Map<string, ITypeDef>): void {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const def = defs.get(definitionKey(repoPath, (element.propertyName ?? element.name).text));
      if (def && !element.propertyName) def.exported = true;
    }
  }
}

/** The property name that a node reads: `.name`, `["name"]`, a `{ name }` pattern, or `Type["name"]`. */
function accessedNameOf(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    return ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const name = node.propertyName ?? node.name;
    return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
  }
  if (ts.isIndexedAccessTypeNode(node) && ts.isLiteralTypeNode(node.indexType)) {
    return ts.isStringLiteralLike(node.indexType.literal) ? node.indexType.literal.text : null;
  }
  return null;
}

/** The type name that `keyof Type` or `keyof typeof value` exposes with all its members. */
function keyedNameOf(node: ts.Node): string | null {
  if (!ts.isTypeOperatorNode(node) || node.operator !== ts.SyntaxKind.KeyOfKeyword) return null;
  const operand = ts.isTypeQueryNode(node.type)
    ? node.type.exprName
    : ts.isTypeReferenceNode(node.type)
    ? node.type.typeName
    : null;
  return operand && ts.isIdentifier(operand) ? operand.text : null;
}

/** The property names that code accesses in one file, and the type names that `keyof` exposes. */
function collectAccessedNames(sourceFile: ts.SourceFile, into: Set<string>, keyed: Set<string>): void {
  const visit = (node: ts.Node): void => {
    const accessed = accessedNameOf(node);
    if (accessed !== null) into.add(accessed);
    const exposed = keyedNameOf(node);
    if (exposed !== null) keyed.add(exposed);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** True when the access only assigns to the member, which does not read it. */
function isWriteOnly(access: ts.Node): boolean {
  const parent = access.parent;
  return ts.isBinaryExpression(parent) && parent.left === access &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isExpressionStatement(parent.parent);
}

/** The names that the body of a class reads, which is where a private member can be reached. */
function readNamesInClass(node: ts.ClassDeclaration): Set<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isPropertyAccessExpression(child) && !isWriteOnly(child)) names.add(child.name.text);
    else if (
      ts.isElementAccessExpression(child) && ts.isStringLiteralLike(child.argumentExpression) && !isWriteOnly(child)
    ) {
      names.add(child.argumentExpression.text);
    } else if (ts.isBindingElement(child) && ts.isObjectBindingPattern(child.parent)) {
      const name = child.propertyName ?? child.name;
      if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) names.add(name.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

/** The context that resolves the heritage of a class to the types that it names. */
interface IClassContext extends IDefinitionReach<ITypeDef> {
  readonly defs: ReadonlyMap<string, ITypeDef>;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  readonly memo: Map<ITypeDef, Contract>;
  readonly bindings: Map<string, IFileBindings<ITypeDef>>;
}

/** The bindings of the file that declares `def`, built once per file. */
function bindingsFor(context: IClassContext, repoPath: string): IFileBindings<ITypeDef> {
  const known = context.bindings.get(repoPath);
  if (known) return known;
  const bindings = context.bindingsOf(repoPath, context.sourceFiles.get(repoPath)!);
  context.bindings.set(repoPath, bindings);
  return bindings;
}

/** The heritage type names of a class or interface, as written. Null stands for a base that is not a plain name. */
function heritageNames(node: ts.ClassDeclaration | ts.InterfaceDeclaration): Array<string | null> {
  const names: Array<string | null> = [];
  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) names.push(ts.isIdentifier(type.expression) ? type.expression.text : null);
  }
  return names;
}

function joinContracts(parts: readonly Contract[]): Contract {
  const names = new Set<string>();
  for (const part of parts) {
    if (part === "all") return "all";
    for (const name of part) names.add(name);
  }
  return names;
}

/** The names that a type owes to its heritage, with its own declared names. */
function contractOf(context: IClassContext, def: ITypeDef): Contract {
  const known = context.memo.get(def);
  if (known) return known;
  context.memo.set(def, new Set());
  const bindings = bindingsFor(context, def.repoPath);
  const parts: Contract[] = [new Set(declaredNames(def.node))];
  for (const name of heritageNames(def.node)) parts.push(heritageContract(context, bindings.names, name));
  const contract = joinContracts(parts);
  context.memo.set(def, contract);
  return contract;
}

function heritageContract(
  context: IClassContext,
  names: ReadonlyMap<string, ITypeDef[]>,
  name: string | null,
): Contract {
  if (name === null) return "all";
  const targets = names.get(name);
  if (targets) return joinContracts(targets.map((target) => contractOf(context, target)));
  return ERROR_BASES.has(name) ? new Set(ERROR_MEMBERS) : "all";
}

/** The names that the heritage of a class (not the class itself) owes, or every name. */
function inheritedContract(context: IClassContext, def: ITypeDef): Contract {
  const bindings = bindingsFor(context, def.repoPath);
  return joinContracts(heritageNames(def.node).map((name) => heritageContract(context, bindings.names, name)));
}

/** Everything the check knows about the names that code reaches. */
interface IUsage {
  readonly accessed: ReadonlySet<string>;
  readonly keyed: ReadonlySet<string>;
  readonly publicTypes: ReadonlySet<ITypeDef>;
}

function isListable(
  candidate: ICandidate,
  def: ITypeDef,
  contract: Contract,
  usage: IUsage,
  reads: Set<string>,
): boolean {
  if (candidate.isPrivate) return !reads.has(candidate.name);
  if (RUNTIME_NAMES.has(candidate.name) || usage.publicTypes.has(def) || usage.keyed.has(def.name)) return false;
  if (contract === "all" || contract.has(candidate.name)) return false;
  return !usage.accessed.has(candidate.name);
}

function unusedOf(
  context: IClassContext,
  def: ITypeDef,
  node: ts.ClassDeclaration,
  usage: IUsage,
): IUnusedClassMember[] {
  const sourceFile = node.getSourceFile();
  if (hasPragma(sourceFile, node, IGNORE_NEXT_LINE) || hasModifier(node, ts.SyntaxKind.DeclareKeyword)) return [];
  const contract = inheritedContract(context, def);
  const reads = readNamesInClass(node);
  const seen = new Set<string>();
  const unused: IUnusedClassMember[] = [];
  for (const candidate of candidatesOf(node, sourceFile)) {
    if (seen.has(candidate.name) || hasPragma(sourceFile, candidate.node, IGNORE_NEXT_LINE)) continue;
    if (!isListable(candidate, def, contract, usage, reads)) continue;
    seen.add(candidate.name);
    unused.push({ repoPath: def.repoPath, className: def.name, member: candidate.name, line: candidate.line });
  }
  return unused;
}

/** Lists the class members that nothing reads. */
export function findUnusedClassMembers(input: IClassMemberInput): IUnusedClassMember[] {
  const defs = collectTypes(input.sourceFiles);
  const context: IClassContext = {
    defs,
    sourceFiles: input.sourceFiles,
    memo: new Map(),
    bindings: new Map(),
    ...createDefinitionReach(input.graph, defs),
  };
  const accessed = new Set<string>();
  const keyed = new Set<string>();
  for (const sourceFile of input.sourceFiles.values()) collectAccessedNames(sourceFile, accessed, keyed);
  const publicTypes = new Set<ITypeDef>();
  for (const entry of input.graph.configuredFiles) for (const def of context.reachAll(entry)) publicTypes.add(def);
  const usage: IUsage = { accessed, keyed, publicTypes };
  const unused: IUnusedClassMember[] = [];
  for (const def of defs.values()) {
    if (!ts.isClassDeclaration(def.node) || !input.isScanned(def.repoPath)) continue;
    unused.push(...unusedOf(context, def, def.node, usage));
  }
  return unused;
}
