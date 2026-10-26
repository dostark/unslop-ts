/**
 * @module BarrelOnlyReExportsTest
 * @path tests/barrel_only_reexports_test.ts
 * @description Positive, negative, and option cases for the barrel-only re-export rule.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [src/rules/reexport_rules.ts, src/rules/rule_options.ts]
 */

import { assertEquals } from "@std/assert";
import { linesOf, plainRun, runAt } from "./helpers/rule_runner.ts";

const RULE = "barrel-only-reexports";
const NAMED = 'export { a } from "./a.ts";\n';
const ALL = 'export * from "./a.ts";\n';
const TYPE_ONLY = 'export type { A } from "./a.ts";\n';
const LOCAL = "export const a = 1;\n";

Deno.test("barrel-only-reexports reports a named, star, or type re-export outside a barrel", () => {
  assertEquals(linesOf(RULE, plainRun(NAMED)), [1]);
  assertEquals(linesOf(RULE, plainRun(ALL)), [1]);
  assertEquals(linesOf(RULE, plainRun(TYPE_ONLY)), [1]);
  assertEquals(linesOf(RULE, plainRun(LOCAL)), []);
});

Deno.test("barrel-only-reexports accepts mod.ts and index.ts barrels", () => {
  assertEquals(linesOf(RULE, runAt(NAMED, "packages/x/mod.ts", {})), []);
  assertEquals(linesOf(RULE, runAt(NAMED, "packages/x/src/index.ts", {})), []);
});

Deno.test("barrel-only-reexports exempts test files", () => {
  assertEquals(linesOf(RULE, runAt(NAMED, "packages/x/tests/helpers.ts", {})), []);
});

Deno.test("barrel-only-reexports honours barrelSuffixes and allowPaths", () => {
  assertEquals(linesOf(RULE, runAt(NAMED, "packages/x/src/barrels.ts", { barrelSuffixes: ["/barrels.ts"] })), []);
  assertEquals(
    linesOf(RULE, runAt(NAMED, "packages/x/src/legacy/a.ts", { allowPaths: ["packages/x/src/legacy/"] })),
    [],
  );
});
