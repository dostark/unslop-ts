/**
 * @module TypePatternRules
 * @path src/rules/type_pattern_rules.ts
 * @description Rules about the weak promise-of-response type, described suppression pragmas, and inline string unions.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/mod.ts, src/engine/type_environment.ts]
 */

import {
  asNode,
  type ILintNode,
  innerType,
  typeArguments,
  typeReferenceName,
  unwrap,
} from "../engine/type_environment.ts";
import type { IPluginRuleContext, LintVisitor } from "./types.ts";

const WEAK_TYPE = ["Promise", "<Response>"].join("");
const PROMISE_NAME = "Promise";
const RESPONSE_NAME = "Response";
const TYPE_ALIAS = "TSTypeAliasDeclaration";
const TYPE_ANNOTATION = "TSTypeAnnotation";
const FUNCTION_TYPE = "TSFunctionType";
const PARENTHESIZED = "TSParenthesizedType";
const UNION = "TSUnionType";
const MIN_STRING_MEMBERS = 2;
const DEFAULT_UNION_HINT = "Define a named type alias or an enum.";
const FIRST_LINE = /\r?\n/;
const PRAGMA = /^[\s/*]*@ts-(?:ignore|expect-error|nocheck)\b\s*:?\s*(\S.*)?$/;
const DESCRIPTION_TAIL = /[\s*]+$/;

function parentOf(node: ILintNode): ILintNode | undefined {
  const parent = node.parent;
  return parent && typeof parent === "object" ? asNode(parent) : undefined;
}

/** True when the node is the promise type that carries a response and nothing more specific. */
function isWeakResponsePromise(node: ILintNode): boolean {
  const type = unwrap(node);
  if (typeReferenceName(type) !== PROMISE_NAME) return false;
  const args = typeArguments(type);
  return args.length === 1 && typeReferenceName(unwrap(args[0])) === RESPONSE_NAME;
}

/** The type that a function type returns, or undefined when the node is not a function type. */
function functionTypeReturn(node: ILintNode): ILintNode | undefined {
  if (node.type !== FUNCTION_TYPE || !node.returnType || typeof node.returnType !== "object") return undefined;
  return innerType(asNode(node.returnType));
}

export function createPromiseResponseAlias(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  return {
    TSTypeAliasDeclaration(rawNode: Deno.lint.Node): void {
      const node = asNode(rawNode);
      const body = unwrap(asNode(node.typeAnnotation));
      const returned = functionTypeReturn(body);
      if (!isWeakResponsePromise(body) && !(returned && isWeakResponsePromise(returned))) return;
      context.report({
        node: rawNode,
        message: `A type alias that masks '${WEAK_TYPE}' is not allowed; define a specific response type.`,
        hint: `Name the response shape. See ${ctx.codeStyle ?? "the strict type safety rules"}.`,
      });
    },
  };
}

/** True when the weak type is the whole return type of a function type that a type alias names. */
function isAliasedFunctionReturn(annotation: ILintNode): boolean {
  const fn = parentOf(annotation);
  const alias = fn ? parentOf(fn) : undefined;
  return fn?.type === FUNCTION_TYPE && alias?.type === TYPE_ALIAS;
}

export function createPromiseResponseReturn(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  return {
    TSTypeReference(rawNode: Deno.lint.Node): void {
      const node = asNode(rawNode);
      if (!isWeakResponsePromise(node)) return;
      const annotation = parentOf(node);
      if (annotation?.type !== TYPE_ANNOTATION || isAliasedFunctionReturn(annotation)) return;
      context.report({
        node: rawNode,
        message: `'${WEAK_TYPE}' as a type annotation is too weak; define an interface for the response shape.`,
        hint: `Name the response shape. See ${ctx.codeStyle ?? "the strict type safety rules"}.`,
      });
    },
  };
}

export function createTsSuppressionPragmas(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  return {
    Program(): void {
      for (const comment of context.sourceCode.getAllComments()) {
        const first = comment.value.split(FIRST_LINE)[0];
        const description = PRAGMA.exec(first)?.[1]?.replace(DESCRIPTION_TAIL, "");
        // A pragma without a description is the case of the built-in ban-ts-comment rule.
        if (!description) continue;
        context.report({
          range: comment.range,
          message: "A TypeScript suppression pragma hides a type error even with a description; fix the error.",
          hint: `Fix the type error. See ${ctx.codeStyle ?? "the strict type safety rules"}.`,
        });
      }
    },
  };
}

function isStringLiteralType(node: ILintNode): boolean {
  if (node.type !== "TSLiteralType" || !node.literal || typeof node.literal !== "object") return false;
  return typeof asNode(node.literal).value === "string";
}

/** True when the union is the whole body of a named type alias, possibly inside parentheses or a wider union. */
function isAliasBody(node: ILintNode): boolean {
  let current = parentOf(node);
  while (current && (current.type === PARENTHESIZED || current.type === UNION)) current = parentOf(current);
  return current?.type === TYPE_ALIAS;
}

export function createMagicUnionType(context: Deno.lint.RuleContext, ctx: IPluginRuleContext): LintVisitor {
  const configured = ctx.options.hint;
  const hint = typeof configured === "string" ? configured : DEFAULT_UNION_HINT;
  return {
    TSUnionType(rawNode: Deno.lint.Node): void {
      const node = asNode(rawNode);
      const members = Array.isArray(node.types) ? node.types.map(asNode) : [];
      if (members.filter(isStringLiteralType).length < MIN_STRING_MEMBERS || isAliasBody(node)) return;
      context.report({
        node: rawNode,
        message: "Avoid an inline union of string literals; name the union with a type alias or an enum.",
        hint: ctx.codeStyle ? `${hint} See ${ctx.codeStyle}.` : hint,
      });
    },
  };
}
