/**
 * @module WholeTreeClassReceivers
 * @path src/rules/whole_tree/class_receivers.ts
 * @description Ties each member access to the classes that it can reach. The type of the receiver comes from syntax alone: a `this` or `super`, a `new` expression, a typed parameter, variable, field, or return type, a cast, or a destructuring source. An access whose receiver is not a known class reaches every class.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/unused_class_members.ts, src/rules/whole_tree/definition_reach.ts]
 */

import ts from "typescript";
import type { IFileBindings } from "./definition_reach.ts";

/** A class or an interface declaration: the types whose members are contracts for the classes that name them. */
export interface ITypeDef {
  readonly repoPath: string;
  readonly name: string;
  readonly node: ts.ClassDeclaration | ts.InterfaceDeclaration;
  exported: boolean;
}

/** The classes that an accessed name may reach, or "any" when the receiver is not a known class. */
export type AccessTargets = Set<ITypeDef> | "any";

/** The lookups that receiver typing needs. */
export interface IReceiverContext {
  readonly bindingsFor: (repoPath: string) => IFileBindings<ITypeDef>;
  readonly reach: (module: string, name: string) => ITypeDef[];
  readonly defOfNode: ReadonlyMap<ts.Node, ITypeDef>;
  /** The types that a class or interface extends or implements. */
  readonly parentsOf: (def: ITypeDef) => readonly ITypeDef[];
  /** The type, its ancestors, and its descendants: every class that a call on the type may run. */
  readonly familyOf: (def: ITypeDef) => ReadonlySet<ITypeDef>;
}

/** The types of an expression or a type node, or null when they are not known. */
type Resolved = ITypeDef[] | null;

const MAX_DEPTH = 8;
/** Generic wrappers that leave the type of their first argument as the type of the value. */
const TRANSPARENT_GENERICS: ReadonlySet<string> = new Set([
  "Opt",
  "Readonly",
  "NonNullable",
  "Promise",
  "PromiseLike",
  "Awaited",
]);
const ABSENT_KEYWORDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.NeverKeyword,
]);
const FALLBACK_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

function combine(parts: readonly Resolved[]): Resolved {
  const found: ITypeDef[] = [];
  for (const part of parts) {
    if (part === null) return null;
    found.push(...part);
  }
  return found.length > 0 ? found : null;
}

function isAbsentType(node: ts.TypeNode): boolean {
  return ABSENT_KEYWORDS.has(node.kind) ||
    (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword);
}

function referencedTypes(context: IReceiverContext, repoPath: string, reference: ts.TypeReferenceNode): Resolved {
  const bindings = context.bindingsFor(repoPath);
  const typeName = reference.typeName;
  if (ts.isIdentifier(typeName)) {
    const wrapped = TRANSPARENT_GENERICS.has(typeName.text) ? reference.typeArguments?.[0] : undefined;
    return wrapped ? typesOfTypeNode(context, repoPath, wrapped) : bindings.names.get(typeName.text) ?? null;
  }
  if (!ts.isIdentifier(typeName.left)) return null;
  const targets = bindings.namespaces.get(typeName.left.text) ?? [];
  const found = targets.flatMap((target) => context.reach(target, typeName.right.text));
  return found.length > 0 ? found : null;
}

/** The classes and interfaces that a type annotation names. Null when any part of it is not one. */
function typesOfTypeNode(context: IReceiverContext, repoPath: string, node: ts.TypeNode): Resolved {
  if (ts.isParenthesizedTypeNode(node)) return typesOfTypeNode(context, repoPath, node.type);
  if (ts.isUnionTypeNode(node)) {
    const present = node.types.filter((part) => !isAbsentType(part));
    return combine(present.map((part) => typesOfTypeNode(context, repoPath, part)));
  }
  return ts.isTypeReferenceNode(node) ? referencedTypes(context, repoPath, node) : null;
}

function nameText(member: ts.Node): string | null {
  const name = ts.getNameOfDeclaration(member as ts.Declaration);
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : null;
}

function isParameterProperty(parameter: ts.ParameterDeclaration): boolean {
  return ts.canHaveModifiers(parameter) && (ts.getModifiers(parameter) ?? []).length > 0;
}

/** The member `name` that the type declares, with the type that declares it. */
interface IMemberSite {
  readonly member: ts.Node;
  readonly owner: ITypeDef;
}

function declaredMember(def: ITypeDef, name: string): ts.Node | null {
  for (const member of def.node.members) {
    if (ts.isConstructorDeclaration(member)) {
      const found = member.parameters.find((parameter) =>
        isParameterProperty(parameter) && ts.isIdentifier(parameter.name) && parameter.name.text === name
      );
      if (found) return found;
    } else if (nameText(member) === name) return member;
  }
  return null;
}

function findMember(context: IReceiverContext, def: ITypeDef, name: string, seen: Set<ITypeDef>): IMemberSite | null {
  if (seen.has(def)) return null;
  seen.add(def);
  const own = declaredMember(def, name);
  if (own) return { member: own, owner: def };
  for (const parent of context.parentsOf(def)) {
    const inherited = findMember(context, parent, name, seen);
    if (inherited) return inherited;
  }
  return null;
}

function isMethodMember(member: ts.Node): boolean {
  return ts.isMethodDeclaration(member) || ts.isMethodSignature(member);
}

/** The types of a field or accessor, or of the value that a method returns. */
function memberTypes(
  context: IReceiverContext,
  site: IMemberSite,
  asCall: boolean,
  depth: number,
): Resolved {
  const { member, owner } = site;
  if (isMethodMember(member) !== asCall) return null;
  const annotation = (member as ts.Node & { type?: ts.TypeNode }).type;
  if (annotation) return typesOfTypeNode(context, owner.repoPath, annotation);
  if (ts.isPropertyDeclaration(member) && member.initializer) {
    return typesOfExpression(context, owner.repoPath, member.initializer, depth + 1);
  }
  return null;
}

function typesOfProperty(
  context: IReceiverContext,
  repoPath: string,
  access: ts.PropertyAccessExpression,
  asCall: boolean,
  depth: number,
): Resolved {
  const owners = typesOfExpression(context, repoPath, access.expression, depth + 1);
  if (!owners) return null;
  return combine(owners.map((owner) => {
    const site = findMember(context, owner, access.name.text, new Set());
    return site ? memberTypes(context, site, asCall, depth) : null;
  }));
}

/** The class that `this` or `super` stands for at the node. Null inside a function that rebinds `this`. */
function enclosingClass(context: IReceiverContext, node: ts.Node): Resolved {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current)) return null;
    const isObjectMember = (ts.isMethodDeclaration(current) || ts.isAccessor(current)) &&
      ts.isObjectLiteralExpression(current.parent);
    if (isObjectMember || ts.isClassExpression(current)) return null;
    if (ts.isClassDeclaration(current)) {
      const def = context.defOfNode.get(current);
      return def ? [def] : null;
    }
  }
  return null;
}

/** What a local declaration says about the type of its variable: an annotation, an initializer, or nothing known. */
interface ILocalDeclaration {
  readonly type?: ts.TypeNode;
  readonly initializer?: ts.Expression;
}

const UNKNOWN_LOCAL: ILocalDeclaration = {};

function bindsName(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text;
  return name.elements.some((element) => !ts.isOmittedExpression(element) && bindsName(element.name, text));
}

function declarationInStatements(statements: readonly ts.Statement[], text: string): ILocalDeclaration | null {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === text) return UNKNOWN_LOCAL;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!bindsName(declaration.name, text)) continue;
      return ts.isIdentifier(declaration.name)
        ? { type: declaration.type, initializer: declaration.initializer }
        : UNKNOWN_LOCAL;
    }
  }
  return null;
}

function parameterDeclaration(scope: ts.Node, text: string): ILocalDeclaration | null {
  if (!ts.isFunctionLike(scope) || !("parameters" in scope)) return null;
  const parameter = scope.parameters.find((candidate) => bindsName(candidate.name, text));
  if (!parameter) return null;
  return ts.isIdentifier(parameter.name) ? { type: parameter.type, initializer: parameter.initializer } : UNKNOWN_LOCAL;
}

function loopDeclaration(scope: ts.Node, text: string): ILocalDeclaration | null {
  const isLoop = ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope);
  const initializer = isLoop ? scope.initializer : undefined;
  if (!initializer || !ts.isVariableDeclarationList(initializer)) return null;
  return initializer.declarations.some((declaration) => bindsName(declaration.name, text)) ? UNKNOWN_LOCAL : null;
}

function catchDeclaration(scope: ts.Node, text: string): ILocalDeclaration | null {
  const variable = ts.isCatchClause(scope) ? scope.variableDeclaration : undefined;
  return variable && bindsName(variable.name, text) ? UNKNOWN_LOCAL : null;
}

/** The declaration that one enclosing scope gives to the name, or null when the scope does not declare it. */
function declarationInScope(scope: ts.Node, text: string): ILocalDeclaration | null {
  if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)) {
    return declarationInStatements(scope.statements, text);
  }
  return parameterDeclaration(scope, text) ?? loopDeclaration(scope, text) ?? catchDeclaration(scope, text);
}

function localDeclaration(identifier: ts.Identifier): ILocalDeclaration | null {
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    const found = declarationInScope(scope, identifier.text);
    if (found) return found;
  }
  return null;
}

function classesNamed(context: IReceiverContext, repoPath: string, identifier: ts.Identifier): Resolved {
  const defs = context.bindingsFor(repoPath).names.get(identifier.text)?.filter((def) =>
    ts.isClassDeclaration(def.node)
  );
  return defs && defs.length > 0 ? defs : null;
}

function typesOfIdentifier(
  context: IReceiverContext,
  repoPath: string,
  identifier: ts.Identifier,
  depth: number,
): Resolved {
  const local = localDeclaration(identifier);
  if (!local) return classesNamed(context, repoPath, identifier);
  if (local.type) return typesOfTypeNode(context, repoPath, local.type);
  return local.initializer ? typesOfExpression(context, repoPath, local.initializer, depth + 1) : null;
}

function typesOfFallback(
  context: IReceiverContext,
  repoPath: string,
  expression: ts.Expression,
  depth: number,
): Resolved {
  if (ts.isConditionalExpression(expression)) {
    return combine([
      typesOfExpression(context, repoPath, expression.whenTrue, depth + 1),
      typesOfExpression(context, repoPath, expression.whenFalse, depth + 1),
    ]);
  }
  if (ts.isBinaryExpression(expression) && FALLBACK_OPERATORS.has(expression.operatorToken.kind)) {
    return combine([
      typesOfExpression(context, repoPath, expression.left, depth + 1),
      typesOfExpression(context, repoPath, expression.right, depth + 1),
    ]);
  }
  return null;
}

/** The types of a wrapper expression: a cast, a parenthesis, an assertion, an await, or a `this`. */
function typesOfWrapper(
  context: IReceiverContext,
  repoPath: string,
  expression: ts.Expression,
  depth: number,
): Resolved {
  if (
    ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) ||
    ts.isAwaitExpression(expression) || ts.isSatisfiesExpression(expression)
  ) {
    return typesOfExpression(context, repoPath, expression.expression, depth + 1);
  }
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return typesOfTypeNode(context, repoPath, expression.type);
  }
  if (expression.kind === ts.SyntaxKind.ThisKeyword || expression.kind === ts.SyntaxKind.SuperKeyword) {
    return enclosingClass(context, expression);
  }
  return typesOfFallback(context, repoPath, expression, depth);
}

/** The classes and interfaces that an expression evaluates to. Null when its type is not known from syntax. */
function typesOfExpression(
  context: IReceiverContext,
  repoPath: string,
  expression: ts.Expression,
  depth = 0,
): Resolved {
  if (depth > MAX_DEPTH) return null;
  if (ts.isNewExpression(expression)) {
    return ts.isIdentifier(expression.expression) ? classesNamed(context, repoPath, expression.expression) : null;
  }
  if (ts.isIdentifier(expression)) return typesOfIdentifier(context, repoPath, expression, depth);
  if (ts.isPropertyAccessExpression(expression)) return typesOfProperty(context, repoPath, expression, false, depth);
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    return typesOfProperty(context, repoPath, expression.expression, true, depth);
  }
  return typesOfWrapper(context, repoPath, expression, depth);
}

/** The types that a destructuring pattern reads from, taken from the initializer or the annotation. */
function patternSourceTypes(context: IReceiverContext, repoPath: string, pattern: ts.ObjectBindingPattern): Resolved {
  const owner = pattern.parent;
  if (ts.isVariableDeclaration(owner)) {
    if (owner.type) return typesOfTypeNode(context, repoPath, owner.type);
    return owner.initializer ? typesOfExpression(context, repoPath, owner.initializer) : null;
  }
  return ts.isParameter(owner) && owner.type ? typesOfTypeNode(context, repoPath, owner.type) : null;
}

/** The accessed name and the types of its receiver, for the nodes that read a named property. */
function accessOf(
  context: IReceiverContext,
  repoPath: string,
  node: ts.Node,
): { name: string; receiver: () => Resolved } | null {
  if (ts.isPropertyAccessExpression(node)) {
    return { name: node.name.text, receiver: () => typesOfExpression(context, repoPath, node.expression) };
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return {
      name: node.argumentExpression.text,
      receiver: () => typesOfExpression(context, repoPath, node.expression),
    };
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const name = node.propertyName ?? node.name;
    if (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) return null;
    const pattern = node.parent;
    return { name: name.text, receiver: () => patternSourceTypes(context, repoPath, pattern) };
  }
  if (ts.isIndexedAccessTypeNode(node) && ts.isLiteralTypeNode(node.indexType)) {
    const literal = node.indexType.literal;
    if (!ts.isStringLiteralLike(literal)) return null;
    return { name: literal.text, receiver: () => typesOfTypeNode(context, repoPath, node.objectType) };
  }
  return null;
}

/** The classes that an access reaches. An unknown receiver, or an interface that any class may satisfy, reaches all. */
function targetsOf(context: IReceiverContext, receiver: Resolved): AccessTargets {
  if (receiver === null || receiver.some((def) => ts.isInterfaceDeclaration(def.node))) return "any";
  const targets = new Set<ITypeDef>();
  for (const def of receiver) for (const relative of context.familyOf(def)) targets.add(relative);
  return targets;
}

function note(into: Map<string, AccessTargets>, name: string, targets: AccessTargets): void {
  const known = into.get(name);
  if (known === "any") return;
  if (targets === "any") {
    into.set(name, "any");
    return;
  }
  const merged = known ?? new Set<ITypeDef>();
  for (const def of targets) merged.add(def);
  into.set(name, merged);
}

/** Records, for every property name that the file reads, the classes that the reads can reach. */
export function recordTypedAccesses(
  context: IReceiverContext,
  repoPath: string,
  sourceFile: ts.SourceFile,
  into: Map<string, AccessTargets>,
): void {
  const visit = (node: ts.Node): void => {
    const access = accessOf(context, repoPath, node);
    if (access && into.get(access.name) !== "any") note(into, access.name, targetsOf(context, access.receiver()));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
