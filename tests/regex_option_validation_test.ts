/**
 * @module RegexOptionValidationTest
 * @path tests/regex_option_validation_test.ts
 * @description A regular expression option fails at the parse boundary with its field named, and a valid one reaches the rule or the detector.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [src/engine/regex_option.ts, src/rules/rule_options.ts, src/rules/whole_tree/options.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { CatalogError, type JsonValue, parseWholeTreeSettings } from "../mod.ts";
import { loadTestCatalog } from "./helpers/registry.ts";
import { linesOf, runAt } from "./helpers/rule_runner.ts";
import { runDeno } from "./helpers/demo_project.ts";
import { detectMagicLiterals } from "../src/rules/whole_tree/mod.ts";

const BROKEN = "[";
const CLI = new URL("../src/cli/whole_tree.ts", import.meta.url).href;
const USAGE_EXIT = 2;

function catalogWith(key: string, options: Record<string, JsonValue>): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: { test: ["**/tests/**"], fixture: [] },
    tagVocabulary: { demo: { description: "Demo rules." } },
    rules: { [`demo/${key}`]: { engine: "plugin", severity: "error", scope: "all", tags: ["demo"], options } },
  };
}

interface IRuleCase {
  readonly name: string;
  readonly key: string;
  readonly options: Record<string, JsonValue>;
  readonly field: string;
}

const RULE_CASES: readonly IRuleCase[] = [
  {
    name: "a dynamic import specifier",
    key: "dynamic-import",
    options: { allowDynamicImports: [{ files: ["a/**"], specifiers: [BROKEN] }] },
    field: "specifiers",
  },
  {
    name: "a phrase pattern",
    key: "ephemeral-comment",
    options: { phrases: [{ pattern: BROKEN, flags: "i", hint: "a hint" }] },
    field: "pattern",
  },
  {
    name: "a repeated phrase flag",
    key: "ephemeral-comment",
    options: { phrases: [{ pattern: "tried", flags: "ii", hint: "a hint" }] },
    field: "flags",
  },
  {
    name: "a phrase pattern that does not compile with its flags",
    key: "ephemeral-comment",
    options: { phrases: [{ pattern: "\\-", flags: "u", hint: "a hint" }] },
    field: "pattern",
  },
  { name: "a file name pattern", key: "ephemeral-filename", options: { pattern: BROKEN }, field: "pattern" },
];

Deno.test("new_regex_options_reject_invalid_patterns_and_flags", () => {
  for (const entry of RULE_CASES) {
    const error = assertThrows(
      () => loadTestCatalog(catalogWith(entry.key, entry.options)),
      CatalogError,
      "",
      entry.name,
    );
    assertStringIncludes(error.path, `rules.demo/${entry.key}.options`);
    assertStringIncludes(error.path, entry.field);
  }
  const magic = assertThrows(() =>
    parseWholeTreeSettings({ wholeTree: { magicLiterals: { testScaffoldPattern: BROKEN } } })
  );
  assertEquals(magic instanceof CatalogError, true);
  assertStringIncludes((magic as CatalogError).path, "testScaffoldPattern");
});

Deno.test("valid_nondefault_regex_options_reach_consumers", () => {
  const source = "export const a = 1;\n// we tried this\n// ¡caña!\nexport const b = 2;\n";
  const phrases = { phrases: [{ pattern: "\\p{L}{3,}", flags: "u", hint: "a word" }] };
  assertEquals(linesOf("ephemeral-comment", runAt(source, "packages/x/src/a.ts", phrases)).length > 0, true);
  const settings = parseWholeTreeSettings({ wholeTree: { magicLiterals: { testScaffoldPattern: "^scaffold-" } } });
  const text = Array.from({ length: 5 }, (_, index) => `export const v${index} = ["scaffold-value"];`).join("\n");
  const files = [{ path: "a_test.ts", text, isTest: true }];
  assertEquals(detectMagicLiterals(files, settings.magicLiterals ?? {}), []);
  assertEquals(detectMagicLiterals([{ ...files[0], isTest: false }], settings.magicLiterals ?? {}).length, 1);
});

Deno.test("magic_cli_invalid_pattern_is_catalog_error", async () => {
  const dir = await Deno.makeTempDir({ prefix: "magic_cli_regex_" });
  try {
    const catalog = {
      version: "1",
      scopes: { test: [], fixture: [] },
      wholeTree: { magicLiterals: { testScaffoldPattern: BROKEN } },
    };
    await Deno.writeTextFile(join(dir, "catalog.json"), JSON.stringify(catalog));
    await Deno.writeTextFile(join(dir, "a.ts"), "export const a = 1;\n");
    const result = await runDeno(["run", "-A", CLI, "--rule=magic-literals", "--catalog=catalog.json"], dir);
    assertEquals(result.code, USAGE_EXIT, result.stderr);
    assertStringIncludes(result.stderr, "testScaffoldPattern");
    assertEquals(result.stderr.includes("SyntaxError"), false, result.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
