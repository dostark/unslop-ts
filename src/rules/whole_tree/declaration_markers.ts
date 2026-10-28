/**
 * @module WholeTreeDeclarationMarkers
 * @path src/rules/whole_tree/declaration_markers.ts
 * @description Reads the markers of a declaration that the whole-tree member checks share: the export modifier and an ignore pragma in the leading comments.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/unused_enum_members.ts, src/rules/whole_tree/unused_class_members.ts]
 */

import ts from "typescript";

/** True when a leading comment of the node holds a match of `pragma`. */
export function hasPragma(sourceFile: ts.SourceFile, node: ts.Node, pragma: RegExp): boolean {
  const text = sourceFile.getFullText();
  return (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).some((range) =>
    pragma.test(text.slice(range.pos, range.end))
  );
}

/** True when the node carries the `export` modifier. */
export function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}
