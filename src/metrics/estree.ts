/**
 * @module EstreeSupport
 * @path src/metrics/estree.ts
 * @description Host-neutral ESTree helpers the metric core shares: traversal, ranges, and function kinds.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/metrics/function_metrics.ts, src/metrics/cognitive.ts]
 */

import { asNode, type ILintNode, isNodeLike } from "../engine/type_environment.ts";

/** The node types that declare an executable function body, for ESTree and Babel trees. */
export const FUNCTION_KINDS: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod",
  "ClassPrivateMethod",
]);

/** Keys a traversal never follows: host metadata, positions, comments, and parent links. */
const SKIPPED_KEYS: ReadonlySet<string> = new Set(["parent", "range", "loc", "comments", "tokens"]);

/** A metric-core failure that a caller must surface instead of hiding as a zero value. */
export class MetricCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricCoreError";
  }
}

/** Visits every ESTree child of a node, skipping host metadata. */
export function forEachChildNode(node: ILintNode, visit: (child: ILintNode) => void): void {
  for (const key in node) {
    if (SKIPPED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNodeLike(item)) visit(asNode(item));
      }
    } else if (isNodeLike(value)) {
      visit(asNode(value));
    }
  }
}

/** The host range of a node, or an explicit failure when the host supplies none. */
export function rangeOf(node: ILintNode): readonly [number, number] {
  const range = node.range;
  if (range === undefined) {
    throw new MetricCoreError(`The host node '${node.type}' has no range, so it cannot be measured.`);
  }
  return range;
}

/** True when the node declares an executable function body. */
export function isFunctionUnitNode(node: ILintNode): boolean {
  return FUNCTION_KINDS.has(node.type) && isNodeLike(node.body);
}

/** The function body node, or null when the host supplies no executable body. */
export function functionBody(node: ILintNode): ILintNode | null {
  return isNodeLike(node.body) ? asNode(node.body) : null;
}
