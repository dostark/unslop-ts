/**
 * @module CheckCodeStyleCatalogEquivalenceTest
 * @path packages/lint-rules/tests/check_code_style_catalog_equivalence_test.ts
 * @description Locks the catalog-driven findings and proves catalog/code rule parity.
 */

import { assertEquals } from "@std/assert";
import { parseCatalog } from "@exaix/lint-rules";
import { checkSource, IMPLEMENTED_SCRIPT_RULE_IDS } from "../src/exaix/check_code_style.ts";
import catalogJson from "../../../scripts/config/style_rule_catalog.json" with { type: "json" };

const PROD = "packages/x/src/a.ts";

Deno.test("catalog covers exactly the implemented script rules", () => {
  const catalog = parseCatalog(catalogJson);
  const catalogScriptIds = Object.entries(catalog.rules)
    .filter(([, entry]) => entry.engine === "script")
    .map(([id]) => id);
  assertEquals(new Set(catalogScriptIds), new Set(IMPLEMENTED_SCRIPT_RULE_IDS));
});

Deno.test("checkSource findings are stable for the committed catalog", () => {
  const source = "export const a: unknown = {};\nexport const b: unknown[] = [];\n";
  const rules = checkSource(PROD, source, parseCatalog(catalogJson)).map((f) => f.rule).sort();
  assertEquals(rules.includes("explicit-unknown"), true);
  assertEquals(rules.includes("explicit-unknown-array"), true);
});
