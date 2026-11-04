/**
 * @module GodClassFixtureHelper
 * @path tests/helpers/god_class_fixture.ts
 * @description Shared fixture for the God Class tests: the rule catalog, the rule runner and a generator of a class whose WMC, TCC and ATFD follow a spec.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/max_class_size_test.ts, tests/design_strategies_test.ts, tests/helpers/registry.ts]
 */

import type { JsonValue } from "../../mod.ts";
import { runPlugin } from "../../deno.ts";
import { createTestPlugin, loadTestCatalog } from "./registry.ts";

export interface IGodSpec {
  readonly methods: number;
  readonly branches: number;
  readonly foreignReads: number;
  readonly cohesion: "grouped" | "shared";
}

/** The rule that the fixtures run. */
const RULE_ID = "demo/max-class-size";
/** The production path that the fixtures lint as. */
const PROD = "packages/x/src/a.ts";

/** A catalog that enables the rule with the options. */
function buildCatalog(options: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: {
      test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
      fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
    },
    tagVocabulary: {
      complexity: { description: "Rules on code complexity." },
      "module-structure": { description: "Rules on module and type structure." },
    },
    rules: {
      [RULE_ID]: {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["complexity", "module-structure"],
        options,
      },
    },
  };
}

/** Runs the rule with the options as given, so the default strategy applies. */
export function godFindings(source: string, options: Record<string, JsonValue> = {}) {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source);
}

/** A class whose WMC, TCC and ATFD follow the spec: grouped gives TCC 0.2 for ten methods, shared gives 1. */
export function godClassSource(spec: IGodSpec): string {
  const attributeOf = (index: number): string => {
    if (spec.cohesion === "shared") return "shared";
    if (index < 4) return "groupA";
    return index < 7 ? "groupB" : `solo${index}`;
  };
  const names = new Set(Array.from({ length: spec.methods }, (_, index) => attributeOf(index)));
  const lines = ["class Hub {", ...[...names].map((name) => `  private ${name} = 0;`)];
  for (let index = 0; index < spec.methods; index++) {
    const branches = Array.from({ length: spec.branches }, (_, step) => `    if (n > ${step}) n++;`);
    const foreign = index < spec.foreignReads ? [`    n += other.field${index};`] : [];
    lines.push(
      `  run${index}(other: Other): number {`,
      `    let n = this.${attributeOf(index)};`,
      ...branches,
      ...foreign,
    );
    lines.push("    return n;", "  }");
  }
  return `${lines.join("\n")}\n}\n`;
}

export const GOD: IGodSpec = { methods: 10, branches: 4, foreignReads: 6, cohesion: "grouped" };
