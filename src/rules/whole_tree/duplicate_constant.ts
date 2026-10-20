/**
 * @module WholeTreeDuplicateConstant
 * @path src/rules/whole_tree/duplicate_constant.ts
 * @description Finds a top-level named constant with a static value that two files declare with the same name and value.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/duplicate_groups.ts, src/rules/whole_tree/options.ts]
 * @public Exports are the unit-test surface of this module.
 */

import ts from "typescript";
import {
  duplicatesOf,
  groupBySignature,
  type IDuplicate,
  type ISourceUnit,
  staleAllowEntries,
} from "./duplicate_groups.ts";
import { DuplicateConstantOptionsSchema, type IDuplicateConstantInput } from "./options.ts";

/** A canonical text for a static literal value, or null when the value is not static. */
function staticValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return `s:${node.text}`;
  if (ts.isNumericLiteral(node)) return `n:${node.text}`;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "b:true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "b:false";
  if (ts.isArrayLiteralExpression(node)) {
    const parts: string[] = [];
    for (const element of node.elements) {
      const value = staticValue(element);
      if (value === null) return null;
      parts.push(value);
    }
    return `a:[${parts.join(",")}]`;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const parts: string[] = [];
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return null;
      const value = staticValue(property.initializer);
      if (value === null) return null;
      parts.push(`${property.name.text}=${value}`);
    }
    parts.sort();
    return `o:{${parts.join(",")}}`;
  }
  return null;
}

/** The `const NAME = <static>` pairs declared at the top level of a unit. */
function topLevelConstants(unit: ISourceUnit, namePattern: RegExp): Map<string, string> {
  const result = new Map<string, string>();
  const source = ts.createSourceFile(unit.path, unit.text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const name = declaration.name.text;
      if (!namePattern.test(name)) continue;
      const value = staticValue(declaration.initializer);
      if (value !== null) result.set(name, value);
    }
  }
  return result;
}

function groupsOf(units: readonly ISourceUnit[], input: IDuplicateConstantInput): Map<string, string[]> {
  const pattern = new RegExp(DuplicateConstantOptionsSchema.parse(input).namePattern);
  return groupBySignature(units, (unit) => topLevelConstants(unit, pattern));
}

/** Duplicate `const` names with the same static value across separate files. */
export function findDuplicateConstants(units: readonly ISourceUnit[], input: IDuplicateConstantInput): IDuplicate[] {
  return duplicatesOf(groupsOf(units, input), DuplicateConstantOptionsSchema.parse(input).allow);
}

/** The names of allow entries that no current duplicate constant matches. */
export function validateConstantAllowEntries(units: readonly ISourceUnit[], input: IDuplicateConstantInput): string[] {
  return staleAllowEntries(groupsOf(units, input), DuplicateConstantOptionsSchema.parse(input).allow);
}
