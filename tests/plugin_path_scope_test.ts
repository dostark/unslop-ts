/**
 * @module PluginPathScopeTest
 * @path packages/lint-rules/tests/plugin_path_scope_test.ts
 * @description The plugin's `include` and `exclude` path filters.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/engine/plugin.ts]
 */

import { assertEquals } from "@std/assert";
import { createLintPlugin, type JsonValue, parseCatalog, runPlugin } from "@exaix/lint-rules";

const SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

const SOURCE = "export function f(x: string | number): boolean {\n  return typeof x === 'string';\n}";

function buildCatalog(filters: Record<string, JsonValue>): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: SCOPES,
    tagVocabulary: { "type-safety": { description: "Rules that keep type evidence." } },
    rules: {
      "exaix/no-runtime-typeof": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        tags: ["type-safety"],
        options: { allowInTypeGuards: true },
        ...filters,
      },
    },
  };
}

function count(filters: Record<string, JsonValue>, filename: string): number {
  const plugin = createLintPlugin("exaix", parseCatalog(buildCatalog(filters)));
  return runPlugin(plugin, filename, SOURCE).length;
}

Deno.test("an include glob restricts a rule to matching paths", () => {
  const filters = { include: ["packages/yes/**"] };
  assertEquals(count(filters, "packages/yes/src/a.ts") > 0, true);
  assertEquals(count(filters, "packages/no/src/a.ts"), 0);
});

Deno.test("an exclude glob removes a matching path", () => {
  const filters = { exclude: ["packages/no/**"] };
  assertEquals(count(filters, "packages/yes/src/a.ts") > 0, true);
  assertEquals(count(filters, "packages/no/src/a.ts"), 0);
});
