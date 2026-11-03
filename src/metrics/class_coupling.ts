/**
 * @module ClassCoupling
 * @path src/metrics/class_coupling.ts
 * @description Per-file ATFD and CBO of one class: syntactic approximations that need no other file.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/metrics/class_metrics.ts, src/metrics/heritage.ts, tests/class_coupling_test.ts]
 */

import { asNode, type ILintNode, isNodeLike } from "../engine/type_environment.ts";
import { forEachChildNode } from "./estree.ts";
import { heritageNamesOfClass } from "./heritage.ts";
import type { IMeasurementContext } from "./types.ts";

/** The foreign-data and coupling counts of one class. */
export interface IClassCoupling {
  readonly atfd: number;
  readonly cbo: number;
}

/** What the file declares and imports, so a name can be told from a global, a local or a method. */
interface IFileNames {
  readonly imported: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
  readonly declared: ReadonlySet<string>;
  readonly methods: ReadonlySet<string>;
}

const CLASS_KINDS: ReadonlySet<string> = new Set(["ClassDeclaration", "ClassExpression"]);
const DECLARED_KINDS: ReadonlySet<string> = new Set([
  "ClassDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSTypeAliasDeclaration",
]);
const MEMBER_KINDS: ReadonlySet<string> = new Set(["MemberExpression", "OptionalMemberExpression"]);
const CALL_KINDS: ReadonlySet<string> = new Set(["CallExpression", "OptionalCallExpression", "NewExpression"]);
const METHOD_NODE_KINDS: ReadonlySet<string> = new Set(["ClassMethod", "ClassPrivateMethod"]);
const NAMESPACE_SPECIFIER = "ImportNamespaceSpecifier";
const IDENTIFIER = "Identifier";
const UPPERCASE_START = /^[A-Z]/;
const namesByTree = new WeakMap<object, IFileNames>();

/** The identifier name of a node, or null. */
function identifierName(value: ILintNode["object"]): string | null {
  if (!isNodeLike(value)) return null;
  const node = asNode(value);
  return node.type === IDENTIFIER && typeof node.name === "string" ? node.name : null;
}

/** The declaration node under an export wrapper, or the node itself. */
function declarationOf(statement: ILintNode): ILintNode {
  return isNodeLike(statement.declaration) ? asNode(statement.declaration) : statement;
}

/** Records the local names of one import declaration. */
function recordImport(statement: ILintNode, imported: Set<string>, namespaces: Set<string>): void {
  const specifiers = statement.specifiers;
  if (!Array.isArray(specifiers)) return;
  for (const specifier of specifiers) {
    if (!isNodeLike(specifier)) continue;
    const name = identifierName(asNode(specifier).local);
    if (name === null) continue;
    (asNode(specifier).type === NAMESPACE_SPECIFIER ? namespaces : imported).add(name);
  }
}

/** The names of the methods that any class of the file declares. */
function collectMethodNames(root: ILintNode, into: Set<string>): void {
  if (METHOD_NODE_KINDS.has(root.type) && root.kind === "method") {
    const name = identifierName(root.key);
    if (name !== null) into.add(name);
  }
  forEachChildNode(root, (child) => collectMethodNames(child, into));
}

/** Reads the imports, the declared types and the method names of a file from its Babel tree. */
function fileNamesOf(context: IMeasurementContext): IFileNames {
  const known = namesByTree.get(context.syntaxTree);
  if (known !== undefined) return known;
  const imported = new Set<string>();
  const namespaces = new Set<string>();
  const declared = new Set<string>();
  const methods = new Set<string>();
  const program = asNode(context.syntaxTree.program);
  const body = Array.isArray(program.body) ? program.body.filter(isNodeLike).map(asNode) : [];
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") recordImport(statement, imported, namespaces);
    const declaration = declarationOf(statement);
    const name = DECLARED_KINDS.has(declaration.type) ? identifierName(declaration.id) : null;
    if (name !== null) declared.add(name);
  }
  collectMethodNames(program, methods);
  const names = { imported, namespaces, declared, methods };
  namesByTree.set(context.syntaxTree, names);
  return names;
}

/** The receiver key of a read: a plain identifier, or `this.field`. Null for any other receiver. */
function receiverKey(object: ILintNode["object"]): string | null {
  const plain = identifierName(object);
  if (plain !== null) return plain === "this" ? null : plain;
  if (!isNodeLike(object)) return null;
  const node = asNode(object);
  if (!MEMBER_KINDS.has(node.type) || node.computed === true) return null;
  if (!isNodeLike(node.object) || asNode(node.object).type !== "ThisExpression") return null;
  const field = identifierName(node.property);
  return field === null ? null : `this.${field}`;
}

/** True when a member read touches the data of another object rather than a type, a call or a write. */
function isForeignRead(node: ILintNode, parent: ILintNode | null, names: IFileNames): string | null {
  if (node.computed === true) return null;
  const key = receiverKey(node.object);
  const property = identifierName(node.property);
  if (key === null || property === null || names.methods.has(property)) return null;
  const root = key.split(".")[0];
  if (UPPERCASE_START.test(root) || names.namespaces.has(root) || names.declared.has(root)) return null;
  if (parent !== null && CALL_KINDS.has(parent.type) && parent.callee === node) return null;
  if (parent !== null && parent.type === "AssignmentExpression" && parent.operator === "=" && parent.left === node) {
    return null;
  }
  return `${key}.${property}`;
}

/** Access to foreign data: the distinct reads of attributes of other objects inside the class body. */
function foreignDataAccesses(classNode: ILintNode, names: IFileNames): number {
  const reads = new Set<string>();
  const visit = (node: ILintNode, parent: ILintNode | null): void => {
    if (MEMBER_KINDS.has(node.type)) {
      const read = isForeignRead(node, parent, names);
      if (read !== null) reads.add(read);
    }
    forEachChildNode(node, (child) => {
      if (!CLASS_KINDS.has(child.type)) visit(child, node);
    });
  };
  forEachChildNode(classNode, (child) => visit(child, classNode));
  return reads.size;
}

/** The type name that a reference writes: a plain name, or `namespace.Name`. Null for anything else. */
function typeReferenceName(typeName: ILintNode["typeName"]): string | null {
  const plain = identifierName(typeName);
  if (plain !== null) return plain;
  if (!isNodeLike(typeName)) return null;
  const node = asNode(typeName);
  const left = identifierName(node.left);
  const right = identifierName(node.right);
  return node.type === "TSQualifiedName" && left !== null && right !== null ? `${left}.${right}` : null;
}

/** The names the class writes in types, `new`, static access and heritage, before they are checked against the file. */
function namedDependencies(classNode: ILintNode): Set<string> {
  const used = new Set<string>();
  for (const name of heritageNamesOfClass(classNode)) {
    if (name !== null) used.add(name);
  }
  const visit = (node: ILintNode): void => {
    if (node.type === "TSTypeReference") {
      const name = typeReferenceName(node.typeName);
      if (name !== null) used.add(name);
    } else if (node.type === "NewExpression") {
      const name = identifierName(node.callee);
      if (name !== null) used.add(name);
    } else if (MEMBER_KINDS.has(node.type)) {
      const name = identifierName(node.object);
      if (name !== null && UPPERCASE_START.test(name)) used.add(name);
    }
    forEachChildNode(node, (child) => {
      if (!CLASS_KINDS.has(child.type)) visit(child);
    });
  };
  forEachChildNode(classNode, visit);
  return used;
}

/** Coupling between objects: the distinct imported or file-declared types the class depends on, without itself. */
function couplingBetweenObjects(classNode: ILintNode, names: IFileNames): number {
  const own = identifierName(classNode.id);
  let count = 0;
  for (const name of namedDependencies(classNode)) {
    const root = name.split(".")[0];
    const known = names.imported.has(root) || names.namespaces.has(root) || names.declared.has(root);
    if (known && name !== own) count++;
  }
  return count;
}

/** Measures the per-file ATFD and CBO of one class. */
export function measureCoupling(classNode: ILintNode, context: IMeasurementContext): IClassCoupling {
  const names = fileNamesOf(context);
  return { atfd: foreignDataAccesses(classNode, names), cbo: couplingBetweenObjects(classNode, names) };
}
