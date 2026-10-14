/**
 * @module NoChainedTypeAssertions
 * @path packages/lint-rules/src/rules/no_chained_type_assertions.ts
 * @description Reports chained TypeScript type assertions. Ported from anti-slop (MIT) at commit 13909c9e.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/mod.ts, packages/lint-rules/tests/no_chained_type_assertions_test.ts]
 */

import type { IPluginRuleContext, LintVisitor } from "./types.ts";

interface ILintNode {
  readonly type: string;
  readonly range: [number, number];
  readonly parent?: ILintNode | null;
  readonly expression?: ILintNode;
  readonly typeAnnotation?: ILintNode;
  readonly typeName?: ILintNode;
  readonly name?: string;
}

function asLintNode(node: Deno.lint.Node): ILintNode {
  return node as ILintNode;
}

function isAssertion(node: ILintNode | null): boolean {
  return node !== null && (node.type === "TSAsExpression" || node.type === "TSTypeAssertion");
}

function unwrapParenthesized(expression: ILintNode): ILintNode {
  let current = expression;
  while (current.type === "ParenthesizedExpression" && current.expression) {
    current = current.expression;
  }
  return current;
}

function isConstAssertion(node: ILintNode): boolean {
  const annotation = node.typeAnnotation;
  return annotation?.type === "TSTypeReference" &&
    annotation.typeName?.type === "Identifier" &&
    annotation.typeName.name === "const";
}

/** True when no enclosing assertion wraps this node, so the outermost link reports once. */
function isOutermostAssertion(node: ILintNode): boolean {
  let current: ILintNode = node;
  let parent = node.parent ?? undefined;
  while (parent && parent.type === "ParenthesizedExpression" && parent.expression === current) {
    current = parent;
    parent = parent.parent ?? undefined;
  }
  return !parent || !isAssertion(parent ?? null) || parent.expression !== current;
}

interface IChain {
  readonly count: number;
  readonly hasNonConst: boolean;
  /** Outer-to-inner assertion links. */
  readonly links: ILintNode[];
}

function collectChain(node: ILintNode): IChain {
  const links: ILintNode[] = [];
  let hasNonConst = false;
  let current: ILintNode | undefined = node;
  while (current && isAssertion(current ?? null)) {
    links.push(current);
    hasNonConst ||= !isConstAssertion(current);
    const inner: ILintNode | undefined = current.expression;
    current = inner ? unwrapParenthesized(inner) : undefined;
  }
  return { count: links.length, hasNonConst, links };
}

/** True for the test-only `x as Partial<T> as T` mock shape (innermost link is Partial<...>). */
function isPartialMockChain(links: ILintNode[], sourceCode: Deno.lint.SourceCode): boolean {
  if (links.length !== 2) return false;
  const inner = links[1];
  if (!inner.typeAnnotation) return false;
  return /^Partial\s*</.test(textOf(inner.typeAnnotation, sourceCode));
}

/** True for the test-only bypass mock: the innermost link is `never` or `any`. */
function isNeverAnyMockChain(links: ILintNode[]): boolean {
  if (links.length !== 2) return false;
  const annotation = links[1].typeAnnotation;
  return annotation?.type === "TSNeverKeyword" || annotation?.type === "TSAnyKeyword";
}

function textOf(node: ILintNode, sourceCode: Deno.lint.SourceCode): string {
  return sourceCode.text.slice(node.range[0], node.range[1]);
}

export function createNoChainedTypeAssertions(
  context: Deno.lint.RuleContext,
  ctx: IPluginRuleContext,
): LintVisitor {
  const allowPartialMock = ctx.options.allowPartialMockInTests !== false;
  const allowNeverAnyMock = ctx.options.allowNeverAnyMockInTests !== false;
  const codeStyle = ctx.codeStyle ?? "CODE_STYLE.md#strict-type-safety";
  const sourceCode = context.sourceCode;

  const check = (rawNode: Deno.lint.Node): void => {
    const node = asLintNode(rawNode);
    if (!isOutermostAssertion(node)) return;
    const chain = collectChain(node);
    if (chain.count <= 1 || !chain.hasNonConst) return;
    if (ctx.isTestFile) {
      if (allowPartialMock && isPartialMockChain(chain.links, sourceCode)) return;
      if (allowNeverAnyMock && isNeverAnyMockChain(chain.links)) return;
    }
    context.report({
      node: rawNode,
      message:
        "Chained type assertions discard type evidence. Keep the precise type, or parse the value at its boundary before narrowing.",
      hint: `Keep the precise type or parse at the boundary. See ${codeStyle}.`,
    });
  };

  return { TSAsExpression: check, TSTypeAssertion: check };
}
