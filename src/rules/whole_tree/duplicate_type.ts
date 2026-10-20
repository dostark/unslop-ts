/**
 * @module WholeTreeDuplicateType
 * @path src/rules/whole_tree/duplicate_type.ts
 * @description Finds an interface or object type alias that two files declare with the same name and members.
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
import { DuplicateTypeOptionsSchema, type IDuplicateTypeInput } from "./options.ts";

interface ITypeShape {
  readonly name: string;
  readonly members: string[];
}

const MEMBER_SEPARATOR = "\u0001";
const WHITESPACE = /\s+/g;

/** Whitespace-normalized text for one type member. */
function memberSignature(member: ts.TypeElement): string {
  return member.getText().replace(WHITESPACE, " ").trim();
}

/** The name and member signatures of an interface or object type alias, or null. */
function typeShapeOf(statement: ts.Statement): ITypeShape | null {
  if (ts.isInterfaceDeclaration(statement)) {
    return { name: statement.name.text, members: statement.members.map(memberSignature) };
  }
  if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
    return { name: statement.name.text, members: statement.type.members.map(memberSignature) };
  }
  return null;
}

/** The top-level `interface NAME` and `type NAME = { ... }` member sets of a unit, by name. */
function topLevelTypes(unit: ISourceUnit, minProperties: number): Map<string, string> {
  const result = new Map<string, string>();
  const source = ts.createSourceFile(unit.path, unit.text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    const shape = typeShapeOf(statement);
    if (shape === null || shape.members.length < minProperties) continue;
    result.set(shape.name, [...shape.members].sort().join(MEMBER_SEPARATOR));
  }
  return result;
}

function groupsOf(units: readonly ISourceUnit[], input: IDuplicateTypeInput): Map<string, string[]> {
  const { minProperties } = DuplicateTypeOptionsSchema.parse(input);
  return groupBySignature(units, (unit) => topLevelTypes(unit, minProperties));
}

/** Duplicate interface and object-type members with the same name across separate files. */
export function findDuplicateTypes(units: readonly ISourceUnit[], input: IDuplicateTypeInput): IDuplicate[] {
  return duplicatesOf(groupsOf(units, input), DuplicateTypeOptionsSchema.parse(input).allow);
}

/** The names of allow entries that no current duplicate type matches. */
export function validateTypeAllowEntries(units: readonly ISourceUnit[], input: IDuplicateTypeInput): string[] {
  return staleAllowEntries(groupsOf(units, input), DuplicateTypeOptionsSchema.parse(input).allow);
}
