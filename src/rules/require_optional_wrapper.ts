/**
 * @module RequireOptionalWrapper
 * @path packages/lint-rules/src/rules/require_optional_wrapper.ts
 * @description Requires a catalogued wrapper type for optional parameters.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts]
 */

import {
  asNode,
  type ILintNode,
  innerType,
  isNodeLike,
  type LintValue,
  toLintNode,
  typeReferenceName,
  unwrap,
} from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

const FUNCTION_NODES = [
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "TSMethodSignature",
  "TSDeclareFunction",
];

/** The union members of a type, or the type itself when it is not a union. */
function membersOf(node: ILintNode | null): ILintNode[] {
  if (!node) return [];
  const resolved = unwrap(node);
  if (resolved.type === "TSUnionType" && Array.isArray(resolved.types)) {
    return (resolved.types as unknown[]).filter(isNodeLike).map((value) => asNode(value as LintValue));
  }
  return [resolved];
}

/** True when the annotation is (or unions) a reference to the wrapper type. */
function isWrapped(annotation: LintValue, wrapper: string): boolean {
  for (const member of membersOf(isNodeLike(annotation) ? unwrap(innerType(asNode(annotation))) : null)) {
    if (typeReferenceName(member) === wrapper) return true;
  }
  return false;
}

/** True when the annotation unions `undefined`. */
function hasUndefined(annotation: LintValue): boolean {
  for (const member of membersOf(isNodeLike(annotation) ? unwrap(innerType(asNode(annotation))) : null)) {
    if (member.type === "TSUndefinedKeyword") return true;
  }
  return false;
}

export function createRequireOptionalWrapper(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const wrapper = typeof ctx.options.wrapperType === "string" ? ctx.options.wrapperType : "Opt";
  const check = (rawNode: Deno.lint.Node): void => {
    const fn = asNode(rawNode);
    const params = fn.params;
    if (!Array.isArray(params)) return;
    for (const param of params) {
      if (!isNodeLike(param)) continue;
      const node = asNode(param);
      const annotation = node.typeAnnotation;
      if (isWrapped(annotation, wrapper)) continue;
      const bare = node.optional === true || hasUndefined(annotation);
      if (!bare) continue;
      context.report({
        node: toLintNode(param),
        message: `An optional parameter must use the ${wrapper} wrapper instead of a bare '?' or '| undefined'.`,
        hint: `Declare the parameter as ${wrapper}<T, Reason.*>.`,
      });
    }
  };
  const visitor: LintVisitor = {};
  for (const type of FUNCTION_NODES) visitor[type] = check;
  return visitor;
}
