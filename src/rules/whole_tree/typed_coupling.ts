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

/** The typed foreign-data counts of one method, accessor, constructor or function-valued property. */
export interface IMethodCoupling {
  readonly name: string;
  readonly line: number;
  readonly atfd: number;
  /** The share of the attributes read that belong to the class itself, or null when the method reads none. */
  readonly laa: number | null;
  /** The distinct classes whose attributes the method reads. */
  readonly fdp: number;
}

/** The typed foreign-data, coupling and call counts of one class. */
export interface ITypedCoupling {
  readonly atfd: number;
  readonly cbo: number;
  /** The distinct methods of other types that the class calls. RFC adds the methods of the class itself. */
  readonly calledMethods: number;
  readonly methods: readonly IMethodCoupling[];
}

/** The attributes that one member of a class has been seen to read. */
interface IMemberUsage {
  readonly foreign: Set<string>;
  readonly own: Set<string>;
  readonly providers: Set<ITypeDef>;
}

/** What one class has been seen to use so far. */
interface IUsage {
  readonly foreignData: Set<string>;
  readonly calledMethods: Set<string>;
  readonly coupled: Set<ITypeDef>;
  readonly members: Map<ts.ClassElement, IMemberUsage>;
}

const MEMBER_SEPARATOR = "\0";

/** The key of a member: the type that declares it and its name. */
function memberKey(owner: ITypeDef, name: string): string {
  return [owner.repoPath, owner.name, owner.node.getStart(owner.node.getSourceFile()), name].join(MEMBER_SEPARATOR);
}

function usageOf(into: Map<ITypeDef, IUsage>, def: ITypeDef): IUsage {
  const known = into.get(def);
  if (known) return known;
  const created = {
    foreignData: new Set<string>(),
    calledMethods: new Set<string>(),
    coupled: new Set<ITypeDef>(),
    members: new Map<ts.ClassElement, IMemberUsage>(),
  };
  into.set(def, created);
  return created;
}

/** True when every receiver type is a class, so the property can be told from an interface contract. */
function allClasses(targets: readonly ITypeDef[]): boolean {
  return targets.every((target) => ts.isClassLike(target.node));
}

function memberUsageOf(usage: IUsage, member: ts.ClassElement): IMemberUsage {
  const known = usage.members.get(member);
  if (known) return known;
  const created = { foreign: new Set<string>(), own: new Set<string>(), providers: new Set<ITypeDef>() };
  usage.members.set(member, created);
  return created;
}

/** Adds the fields and accessors that a read reaches: those of the class family are its own, the rest are foreign. */
function recordDataReads(
  receivers: IReceiverContext,
  access: IClassAccess,
  targets: readonly ITypeDef[],
  usage: IUsage,
): void {
  if (access.role !== "read" || !allClasses(targets)) return;
  const family = receivers.familyOf(access.enclosing);
  const member = access.member ? memberUsageOf(usage, access.member) : null;
  for (const target of targets) {
    const owner = dataMemberOwner(receivers, target, access.name);
    if (!owner) continue;
    const key = memberKey(owner, access.name);
    if (family.has(target)) member?.own.add(key);
    else {
      usage.foreignData.add(key);
      member?.foreign.add(key);
      member?.providers.add(owner);
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
  recordDataReads(receivers, access, access.targets, usage);
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

function memberNameOf(member: ts.ClassElement): string {
  const name = ts.getNameOfDeclaration(member);
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : "constructor";
}

/** The foreign-data counts of every member that read an attribute. */
function methodCouplingsOf(usage: IUsage): IMethodCoupling[] {
  return [...usage.members].map(([member, used]) => {
    const reads = used.foreign.size + used.own.size;
    const sourceFile = member.getSourceFile();
    return {
      name: memberNameOf(member),
      line: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
      atfd: used.foreign.size,
      laa: reads === 0 ? null : used.own.size / reads,
      fdp: used.providers.size,
    };
  });
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
    if (!ts.isClassLike(def.node)) continue;
    const usage = usageOf(usages, def);
    recordDeclared(receivers, def, usage);
    usage.coupled.delete(def);
    result.set(def, {
      atfd: usage.foreignData.size,
      cbo: usage.coupled.size,
      calledMethods: usage.calledMethods.size,
      methods: methodCouplingsOf(usage),
    });
  }
  return result;
}
