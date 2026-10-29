/**
 * @module RuleCeiling
 * @path src/cli/rule_ceiling.ts
 * @description Evaluates ratcheted rule counts against the committed ceilings file.
 * @architectural-layer Tooling
 * @dependencies [zod]
 * @related-files [src/engine/catalog.ts]
 * @public Exports are the unit-test surface of this module.
 */

import { z } from "zod";

/** Per-rule, per-package finding counts. */
export interface ICeilings {
  readonly [ruleId: string]: { readonly [packageName: string]: number };
}

/** The strict shape of one ceilings file. */
export const CeilingsSchema: z.ZodType<ICeilings, ICeilings> = z.record(
  z.string(),
  z.record(z.string(), z.number().int().nonnegative()),
);

/** Parses and validates a ceilings file against the known rules and bucket names. */
export function parseCeilings(
  text: string,
  knownRules: readonly string[],
  knownPackages: readonly string[],
): ICeilings {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("the ceilings file is not valid JSON");
  }
  const parsed = CeilingsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`the ceilings file is invalid: ${parsed.error.issues[0]?.message ?? "unexpected shape"}`);
  }
  const knownRuleSet = new Set(knownRules);
  const knownPackageSet = new Set(knownPackages);
  for (const [rule, row] of Object.entries(parsed.data)) {
    if (!knownRuleSet.has(rule)) throw new Error(`the ceilings file names an unknown rule '${rule}'`);
    for (const packageName of Object.keys(row)) {
      if (!knownPackageSet.has(packageName)) {
        throw new Error(`the ceilings file names an unknown bucket '${packageName}'`);
      }
    }
  }
  return parsed.data;
}

/** Projects every ceiling to the one selected rule. A missing row is a configuration error. */
export function projectCeilings(ceilings: ICeilings, rule: string): ICeilings {
  const row = ceilings[rule];
  if (row === undefined) throw new Error(`the ceilings file has no row for the selected rule '${rule}'`);
  return { [rule]: row };
}

export interface ICeilingDelta {
  readonly rule: string;
  readonly packageName: string;
  readonly count: number;
  readonly ceiling: number;
  readonly delta: number;
}

export interface IEvaluation {
  readonly over: ICeilingDelta[];
  readonly under: ICeilingDelta[];
  readonly unknownRules: string[];
  readonly unknownPackages: string[];
}

function packageKeys(ceilings: ICeilings): string[] {
  const keys = new Set<string>();
  for (const perPackage of Object.values(ceilings)) {
    for (const name of Object.keys(perPackage)) keys.add(name);
  }
  return [...keys].sort();
}

/** Compares current counts to the committed ceilings. A host fails on `over`, and decides what to do with `under`. */
export function evaluateCeilings(
  ceilings: ICeilings,
  counts: ICeilings,
  knownRules: readonly string[],
  knownPackages: readonly string[],
): IEvaluation {
  const knownRuleSet = new Set(knownRules);
  const knownPackageSet = new Set(knownPackages);
  const over: ICeilingDelta[] = [];
  const under: ICeilingDelta[] = [];

  for (const [rule, perPackage] of Object.entries(ceilings)) {
    const measured = counts[rule] ?? {};
    const packages = new Set([...Object.keys(perPackage), ...Object.keys(measured)]);
    for (const packageName of packages) {
      const ceiling = perPackage[packageName] ?? 0;
      const count = measured[packageName] ?? 0;
      if (count === ceiling) continue;
      const delta = count - ceiling;
      const entry = { rule, packageName, count, ceiling, delta };
      if (delta > 0) over.push(entry);
      else under.push(entry);
    }
  }

  return {
    over,
    under,
    unknownRules: Object.keys(ceilings).filter((rule) => !knownRuleSet.has(rule)).sort(),
    unknownPackages: packageKeys(ceilings).filter((name) => !knownPackageSet.has(name)),
  };
}
