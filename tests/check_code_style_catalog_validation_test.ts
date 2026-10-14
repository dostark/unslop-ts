/**
 * @module CheckCodeStyleCatalogValidationTest
 * @path packages/lint-rules/tests/check_code_style_catalog_validation_test.ts
 * @description Validates the repository catalog with the shared loader and JSON-path errors.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { CatalogError, type JsonValue, parseCatalog } from "@exaix/lint-rules";
import catalogJson from "../../../scripts/config/style_rule_catalog.json" with { type: "json" };

function cloneCatalog(): Record<string, JsonValue> {
  return structuredClone(catalogJson) as Record<string, JsonValue>;
}

function rulesOf(catalog: Record<string, JsonValue>): Record<string, JsonValue> {
  return catalog.rules as Record<string, JsonValue>;
}

function expectReject(mutate: (catalog: Record<string, JsonValue>) => void, pathPart: string): void {
  const catalog = cloneCatalog();
  mutate(catalog);
  try {
    parseCatalog(catalog);
    throw new Error("expected parseCatalog to throw");
  } catch (error) {
    assertEquals(error instanceof CatalogError, true, "expected a CatalogError");
    assertStringIncludes((error as CatalogError).path, pathPart);
  }
}

Deno.test("catalog is accepted as committed", () => {
  assertEquals(parseCatalog(cloneCatalog()).version, "1");
});

Deno.test("parseCatalog rejects an unknown top-level key with its JSON path", () => {
  expectReject((catalog) => {
    catalog.unexpected = true;
  }, "catalog");
});

Deno.test("parseCatalog rejects an unknown plugin option with its JSON path", () => {
  expectReject((catalog) => {
    (rulesOf(catalog)["exaix/no-chained-type-assertions"] as Record<string, JsonValue>).options = { nope: 1 };
  }, "options");
});

Deno.test("parseCatalog rejects off without a reason", () => {
  expectReject((catalog) => {
    (rulesOf(catalog)["magic-union-type"] as Record<string, JsonValue>).severity = "off";
  }, "reason");
});

Deno.test("parseCatalog rejects a vocabulary tag no rule uses", () => {
  expectReject((catalog) => {
    (catalog.tagVocabulary as Record<string, JsonValue>).unused = { description: "unused" };
  }, "unused");
});

Deno.test("parseCatalog rejects warn severity on a plugin rule", () => {
  expectReject((catalog) => {
    (rulesOf(catalog)["exaix/no-chained-type-assertions"] as Record<string, JsonValue>).severity = "warn";
  }, "severity");
});
