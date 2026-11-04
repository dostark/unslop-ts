/**
 * @module WholeTreeTypedCoupling
 * @path src/rules/whole_tree/typed_coupling.ts
 * @description Typed ATFD and CBO of the classes of the walked files. An access counts only when the declared type of its receiver is a known class, so an unknown or interface receiver never adds to the coupling.
 * @architectural-layer Shared
 * @dependencies [typescript]
 * @related-files [src/rules/whole_tree/class_receivers.ts, src/rules/whole_tree/class_context.ts, src/report/class_pass.ts]
 */

import ts from "typescript";
import {
  dataMemberOwner,
  expressionDefs,
  type IClassAccess,
  type IReceiverContext,
  type ITypeDef,
  methodMemberOwner,
  recordClassAccesses,
  typeReferenceDefs,
} from "./class_receivers.ts";
import type { ITypeContext } from "./class_context.ts";

/** The typed foreign-data, coupling and call counts of one class. */
export interface ITypedCoupling {
  readonly atfd: number;
  readonly cbo: number;
  /** The distinct methods of other types that the class calls. RFC adds the methods of the class itself. */
  readonly calledMethods: number;
}

/** What one class has been seen to use so far. */
interface IUsage {
  readonly foreignData: Set<string>;
  readonly calledMethods: Set<string>;
  readonly coupled: Set<ITypeDef>;
}

const MEMBER_SEPARATOR = "\0";

/** The key of a member: the type that declares it and its name. */
function memberKey(owner: ITypeDef, name: string): string {
  return [owner.repoPath, owner.name, name].join(MEMBER_SEPARATOR);
}

function usageOf(into: Map<ITypeDef, IUsage>, def: ITypeDef): IUsage {
  const known = into.get(def);
  if (known) return known;
  const created = { foreignData: new Set<string>(), calledMethods: new Set<string>(), coupled: new Set<ITypeDef>() };
  into.set(def, created);
  return created;
}

/** True when every receiver type is a class, so the property can be told from an interface contract. */
function allClasses(targets: readonly ITypeDef[]): boolean {
  return targets.every((target) => ts.isClassDeclaration(target.node));
}

/** Adds the foreign fields and accessors that a read reaches, leaving out the class family itself. */
function recordForeignData(
  receivers: IReceiverContext,
  access: IClassAccess,
  targets: readonly ITypeDef[],
  usage: IUsage,
): void {
  if (access.role !== "read" || !allClasses(targets)) return;
  const family = receivers.familyOf(access.enclosing);
  for (const target of targets) {
    if (family.has(target)) continue;
    const owner = dataMemberOwner(receivers, target, access.name);
    if (owner) {
      usage.foreignData.add(`${owner.repoPath}${MEMBER_SEPARATOR}${owner.name}${MEMBER_SEPARATOR}${access.name}`);
    }
  }
}

/** Adds the methods of other types that a call reaches, leaving out the class family itself. */
function recordCalledMethods(
  receivers: IReceiverContext,
  access: IClassAccess,
  targets: readonly ITypeDef[],
  usage: IUsage,
): void {
  if (access.role !== "call") return;
  const family = receivers.familyOf(access.enclosing);
  for (const target of targets) {
    if (family.has(target)) continue;
    const owner = methodMemberOwner(receivers, target, access.name);
    if (owner) usage.calledMethods.add(memberKey(owner, access.name));
  }
}

function recordAccess(receivers: IReceiverContext, access: IClassAccess, into: Map<ITypeDef, IUsage>): void {
  if (access.targets === null) return;
  const usage = usageOf(into, access.enclosing);
  for (const target of access.targets) usage.coupled.add(target);
  recordForeignData(receivers, access, access.targets, usage);
  recordCalledMethods(receivers, access, access.targets, usage);
}

/** Adds the types that the declaration of a class names: type references, `new` expressions and its heritage. */
function recordDeclared(receivers: IReceiverContext, def: ITypeDef, usage: IUsage): void {
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      for (const named of typeReferenceDefs(receivers, def.repoPath, node)) usage.coupled.add(named);
    } else if (ts.isNewExpression(node)) {
      for (const named of expressionDefs(receivers, def.repoPath, node)) usage.coupled.add(named);
    }
    ts.forEachChild(node, visit);
  };
  visit(def.node);
  for (const parent of receivers.parentsOf(def)) usage.coupled.add(parent);
}

/** The typed ATFD and CBO of every class declaration of the walked files. */
export function typedCouplingOf(
  context: ITypeContext,
  receivers: IReceiverContext,
): ReadonlyMap<ITypeDef, ITypedCoupling> {
  const usages = new Map<ITypeDef, IUsage>();
  for (const [repoPath, sourceFile] of context.sourceFiles) {
    recordClassAccesses(receivers, repoPath, sourceFile, (access) => recordAccess(receivers, access, usages));
  }
  const result = new Map<ITypeDef, ITypedCoupling>();
  for (const def of context.defs.values()) {
    if (!ts.isClassDeclaration(def.node)) continue;
    const usage = usageOf(usages, def);
    recordDeclared(receivers, def, usage);
    usage.coupled.delete(def);
    result.set(def, { atfd: usage.foreignData.size, cbo: usage.coupled.size, calledMethods: usage.calledMethods.size });
  }
  return result;
}
