/**
 * @module CheckCodeStyleRulesOptionsTest
 * @path packages/lint-rules/tests/check_code_style_rules_options_test.ts
 * @description In-process `checkSource` cases proving catalog options drive rule behavior.
 */

import { assertEquals } from "@std/assert";
import { type ICatalog, type JsonValue, parseCatalog } from "@exaix/lint-rules";
import { checkSource } from "../src/exaix/check_code_style.ts";
import catalogJson from "../../../scripts/config/style_rule_catalog.json" with { type: "json" };

const PROD = "packages/x/src/a.ts";

function catalogWith(patch: (rules: Record<string, JsonValue>) => void): ICatalog {
  const clone = structuredClone(catalogJson) as Record<string, JsonValue>;
  patch(clone.rules as Record<string, JsonValue>);
  return parseCatalog(clone);
}

Deno.test("catalog max-params lowers the parameter ceiling", () => {
  const source =
    "export function f(a: number, b: number, c: number, d: number): number {\n  return a + b + c + d;\n}\n";
  const catalog = catalogWith((rules) => {
    (rules["max-params"] as Record<string, JsonValue>).options = { max: 3 };
  });
  assertEquals(checkSource(PROD, source, catalog).filter((f) => f.rule === "max-params").length, 1);
});

Deno.test("catalog long-comment maxLines raises the accepted comment length", () => {
  const source = "export const x = 1;\n/**\n * one\n * two\n */\nexport const y = 2;\n";
  const raised = catalogWith((rules) => {
    (rules["long-comment"] as Record<string, JsonValue>).options = { maxLines: 5 };
  });
  assertEquals(checkSource(PROD, source, raised).filter((f) => f.rule === "long-comment").length, 0);
});

Deno.test("default long-comment maxLines reports the same comment", () => {
  const source = "export const x = 1;\n/**\n * one\n * two\n */\nexport const y = 2;\n";
  const findings = checkSource(PROD, source, parseCatalog(catalogJson)).filter((f) => f.rule === "long-comment");
  assertEquals(findings.length, 1);
});

Deno.test("checkSource returns in-process findings without printing", () => {
  const source = "export const a: unknown = {};\nexport const b: unknown[] = [];\n";
  const findings = checkSource(PROD, source, parseCatalog(catalogJson));
  assertEquals(findings.some((f) => f.rule === "explicit-unknown" && f.line === 1 && f.severity === "error"), true);
  assertEquals(findings.some((f) => f.rule === "explicit-unknown-array" && f.line === 2), true);
});
