/**
 * @module LintRulesCatalogTest
 * @path packages/lint-rules/tests/catalog_test.ts
 * @description Validates the style-rule catalog loader, path classification, and settings.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  CatalogError,
  classifyPath,
  createRuleRegistry,
  type JsonValue,
  parseCatalog,
  ruleSettings,
  TYPESCRIPT_RULE_PACK,
} from "../mod.ts";
import { loadTestCatalog, TEST_REGISTRY } from "./helpers/registry.ts";

const SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

function baseCatalog(): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: SCOPES,
    tagVocabulary: {
      "type-safety": { description: "Rules that keep type evidence." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      "demo/no-chained-type-assertions": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        codeStyle: "CODE_STYLE.md#strict-type-safety",
        tags: ["type-safety", "deslop"],
        options: { allowPartialMockInTests: true },
      },
    },
  };
}

function ruleOf(catalog: Record<string, JsonValue>): Record<string, JsonValue> {
  return (catalog.rules as Record<string, JsonValue>)["demo/no-chained-type-assertions"] as Record<string, JsonValue>;
}

function expectError(mutate: (c: Record<string, JsonValue>) => void, pathPart: string): void {
  const catalog = baseCatalog();
  mutate(catalog);
  try {
    loadTestCatalog(catalog);
    throw new Error("expected parseCatalog to throw");
  } catch (error) {
    assertEquals(error instanceof CatalogError, true, "expected a CatalogError");
    assertStringIncludes((error as CatalogError).path, pathPart);
  }
}

Deno.test("parseCatalog rejects an unknown rule id", () => {
  expectError((c) => {
    (c.rules as Record<string, JsonValue>)["demo/not-a-rule"] = { ...ruleOf(c), tags: ["type-safety"] };
  }, "demo/not-a-rule");
});

Deno.test("parseCatalog rejects a plugin id that no registered pack defines, with the existing message and path", () => {
  const catalog = baseCatalog();
  (catalog.rules as Record<string, JsonValue>)["demo/not-a-rule"] = { ...ruleOf(catalog), tags: ["type-safety"] };
  try {
    loadTestCatalog(catalog);
    throw new Error("expected parseCatalog to throw");
  } catch (error) {
    assertEquals(error instanceof CatalogError, true, "expected a CatalogError");
    assertEquals((error as CatalogError).path, "rules.demo/not-a-rule");
    assertStringIncludes((error as CatalogError).message, "no plugin rule implementation is registered for this id");
  }
});

Deno.test("parseCatalog rejects a plugin id under another plugin name", () => {
  const otherRegistry = createRuleRegistry("other", [TYPESCRIPT_RULE_PACK]);
  try {
    parseCatalog(baseCatalog(), { scriptRuleSchemas: null, registry: otherRegistry });
    throw new Error("expected parseCatalog to throw");
  } catch (error) {
    assertEquals(error instanceof CatalogError, true, "expected a CatalogError");
    assertEquals((error as CatalogError).path, "rules.demo/no-chained-type-assertions");
  }
});

Deno.test("parseCatalog rejects an unknown option", () => {
  expectError((c) => {
    ruleOf(c).options = { allowPartialMockInTests: true, nope: 1 };
  }, "options");
});

Deno.test("parseCatalog rejects warn severity on a plugin rule", () => {
  expectError((c) => {
    ruleOf(c).severity = "warn";
  }, "severity");
});

Deno.test("parseCatalog rejects off without a reason", () => {
  expectError((c) => {
    ruleOf(c).severity = "off";
  }, "reason");
});

Deno.test("parseCatalog rejects an empty tags list", () => {
  expectError((c) => {
    ruleOf(c).tags = [];
  }, "tags");
});

Deno.test("parseCatalog rejects a tag outside tagVocabulary", () => {
  expectError((c) => {
    ruleOf(c).tags = ["mystery"];
  }, "tags");
});

Deno.test("parseCatalog rejects a vocabulary tag no rule uses", () => {
  expectError((c) => {
    (c.tagVocabulary as Record<string, JsonValue>).unused = { description: "unused" };
  }, "unused");
});

Deno.test("parseCatalog rejects a requiresScope breach", () => {
  expectError((c) => {
    (c.tagVocabulary as Record<string, JsonValue>)["test-quality"] = {
      description: "test rules",
      requiresScope: ["test"],
    };
    ruleOf(c).tags = ["type-safety", "test-quality"];
  }, "test-quality");
});

Deno.test("classifyPath classifies production, test, and fixture paths", () => {
  assertEquals(classifyPath("packages/x/src/a.ts", SCOPES), "prod");
  assertEquals(classifyPath("packages/x/tests/a_test.ts", SCOPES), "test");
  assertEquals(classifyPath("tests/scenario_framework/fixtures/a.ts", SCOPES), "fixture");
});

Deno.test("ruleSettings applies option defaults", () => {
  const catalog = baseCatalog();
  delete (ruleOf(catalog) as { options?: JsonValue }).options;
  const settings = ruleSettings(loadTestCatalog(catalog), "demo/no-chained-type-assertions", TEST_REGISTRY);
  assertEquals(settings.options, { allowPartialMockInTests: true, allowNeverAnyMockInTests: true });
  assertEquals(settings.severity, "error");
});
