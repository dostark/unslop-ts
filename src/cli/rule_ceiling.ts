/**
 * @module RuleCeiling
 * @path packages/lint-rules/src/cli/rule_ceiling.ts
 * @description Evaluates ratcheted rule counts against the committed ceilings file.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [packages/lint-rules/src/engine/catalog.ts, tests/scripts/rule_ceiling_ratchet_test.ts]
 */

/** Per-rule, per-package finding counts. */
export interface ICeilings {
  readonly [ruleId: string]: { readonly [packageName: string]: number };
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

/** Compares current counts to the committed ceilings. Any mismatch is a failure. */
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
    for (const [packageName, ceiling] of Object.entries(perPackage)) {
      const count = counts[rule]?.[packageName] ?? 0;
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
