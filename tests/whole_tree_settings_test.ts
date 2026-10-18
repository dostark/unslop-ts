/**
 * @module WholeTreeSettingsTest
 * @path packages/lint-rules/tests/whole_tree_settings_test.ts
 * @description The whole-tree settings are read from a catalog and rejected with a JSON path when invalid.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-rules/src/rules/whole_tree/options.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { CatalogError, type JsonValue, parseWholeTreeSettings } from "../mod.ts";

function wholeTreeSection(): Record<string, JsonValue> {
  return {
    optionalParams: {
      wrapperType: "Opt",
      wrapperImport: "lib/types",
      reasonExamples: ["Absent"],
      testSegments: ["/tests/"],
      testSuffixes: ["_test.ts"],
      skipSegments: ["/scripts/"],
      walkSkipSegments: ["/generated/"],
      pluginRuleId: "demo/require-optional-wrapper",
    },
    constantRestatement: {
      constantModules: ["src/constants.ts"],
      testRoots: ["src"],
      minRestatedElements: 2,
    },
  };
}

function catalogWith(section: Record<string, JsonValue>): JsonValue {
  return { version: "1", wholeTree: section };
}

Deno.test("parseWholeTreeSettings reads the sections a catalog holds", () => {
  const settings = parseWholeTreeSettings(catalogWith(wholeTreeSection()));
  assertEquals(settings.optionalParams?.pluginRuleId, "demo/require-optional-wrapper");
  assertEquals(settings.optionalParams?.walkSkipSegments, ["/generated/"]);
  assertEquals(settings.constantRestatement?.minRestatedElements, 2);
  assertEquals(settings.unusedExports, undefined);
});

Deno.test("parseWholeTreeSettings returns no section for a catalog without wholeTree", () => {
  assertEquals(parseWholeTreeSettings({ version: "1" }), {});
});

Deno.test("parseWholeTreeSettings rejects an unknown key with its JSON path", () => {
  const section = wholeTreeSection();
  const error = assertThrows(
    () => parseWholeTreeSettings(catalogWith({ ...section, surprise: {} })),
    CatalogError,
  );
  assertEquals(error.path, "wholeTree");
});

Deno.test("parseWholeTreeSettings rejects a missing minRestatedElements with its JSON path", () => {
  const section = wholeTreeSection();
  const restatement = { constantModules: ["src/constants.ts"], testRoots: ["src"] };
  const error = assertThrows(
    () => parseWholeTreeSettings(catalogWith({ ...section, constantRestatement: restatement })),
    CatalogError,
  );
  assertEquals(error.path, "wholeTree.constantRestatement.minRestatedElements");
});
