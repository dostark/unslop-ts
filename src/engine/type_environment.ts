/**
 * @module TypeEnvironment
 * @path packages/lint-rules/src/engine/type_environment.ts
 * @description Per-file type alias resolution for the AST-matched type-safety rules.
 *   Reimplemented from the anti-slop approach (MIT); no upstream source is copied.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/type_safety_rules.ts, packages/lint-rules/src/rules/types.ts]
 */

/** A dynamic ESTree value: a node, a list of values, or a primitive leaf. */
export type LintValue =
  | ILintNode
  | Deno.lint.Node
  | readonly LintValue[]
  | string
  | number
  | boolean
  | null
  | undefined;

/** A lint node with the dynamic keys the rules read. */
export interface ILintNode {
  readonly type: string;
  readonly range?: readonly [number, number];
  readonly [key: string]: LintValue;
}

export interface ITypeEnvironment {
  /** Local type alias names mapped to their annotation nodes. */
  readonly aliases: Map<string, ILintNode>;
  /** Follows local aliases and parentheses to the underlying node. */
  resolve(node: ILintNode): ILintNode;
  /** Flattens a union into its members, after alias resolution. */
  unionMembers(node: ILintNode): ILintNode[];
}

/** Reads a lint value as the dynamic node shape. */
export function asNode(node: LintValue): ILintNode {
  return node as ILintNode;
}

/** The Program node of a source unit, when the runtime exposes it. */
export function programOf(sourceCode: Deno.lint.SourceCode): ILintNode {
  const holder = sourceCode as { ast?: LintValue };
  return holder.ast ? asNode(holder.ast) : asNode({ type: "Program" });
}

function isObject(value: LintValue): boolean {
  return value !== null && typeof value === "object";
}

/** Removes parenthesized type wrappers. */
export function unwrap(node: ILintNode): ILintNode {
  let current = node;
  while (current.type === "TSParenthesizedType" && isObject(current.typeAnnotation)) {
    current = asNode(current.typeAnnotation);
  }
  return current;
}

/** The type inside a `TSTypeAnnotation` wrapper, or the node itself. */
export function innerType(node: ILintNode): ILintNode {
  if (node.type === "TSTypeAnnotation" && isObject(node.typeAnnotation)) {
    return asNode(node.typeAnnotation);
  }
  return node;
}

/** The identifier name of a `TSTypeReference`, or null. */
export function typeReferenceName(node: ILintNode): string | null {
  if (node.type !== "TSTypeReference") return null;
  const nameNode = node.typeName;
  if (isObject(nameNode) && asNode(nameNode).type === "Identifier") {
    return asNode(nameNode).name as string;
  }
  return null;
}

/** The type arguments of a `TSTypeReference`, or an empty list. */
export function typeArguments(node: ILintNode): ILintNode[] {
  const instantiation = node.typeArguments;
  if (!isObject(instantiation)) return [];
  const params = asNode(instantiation).params;
  return Array.isArray(params) ? params.filter(isObject).map(asNode) : [];
}

/** Builds the per-file alias map and the resolution helpers. */
export function createTypeEnvironment(program: ILintNode): ITypeEnvironment {
  const aliases = new Map<string, ILintNode>();
  const statements = program.body;
  if (Array.isArray(statements)) {
    for (const statement of statements) {
      if (!isObject(statement)) continue;
      const node = asNode(statement);
      if (node.type !== "TSTypeAliasDeclaration") continue;
      const id = node.id;
      const annotation = node.typeAnnotation;
      if (isObject(id) && isObject(annotation)) {
        const name = asNode(id).name;
        if (typeof name === "string") aliases.set(name, asNode(annotation));
      }
    }
  }

  const resolve = (node: ILintNode, seen: Set<string> = new Set()): ILintNode => {
    const current = unwrap(innerType(node));
    const name = typeReferenceName(current);
    if (name && aliases.has(name) && !seen.has(name)) {
      seen.add(name);
      return resolve(aliases.get(name)!, seen);
    }
    return current;
  };

  const unionMembers = (node: ILintNode): ILintNode[] => {
    const current = resolve(node);
    if (current.type === "TSUnionType" && Array.isArray(current.types)) {
      return (current.types as readonly LintValue[]).filter(isObject).map(asNode).flatMap(unionMembers);
    }
    return [current];
  };

  return { aliases, resolve, unionMembers };
}
