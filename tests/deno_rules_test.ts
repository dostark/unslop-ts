/**
 * @module DenoRulesTest
 * @path packages/lint-rules/tests/deno_rules_test.ts
 * @description Named valid and invalid cases for the Deno rule pack: forbidden ignores and the script shebang.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/deno/no_forbidden_lint_ignore.ts, packages/lint-rules/src/rules/deno/require_deno_shebang.ts]
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "@exaix/lint-rules";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

const SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

const PROD = "packages/x/src/a.ts";
const SCRIPT = "scripts/x.ts";
const SHEBANG = "#!/usr/bin/env -S deno run -A";
const FORBIDDEN_RULE = "exaix/no-forbidden-lint-ignore";
const SHEBANG_RULE = "exaix/require-deno-shebang";

function ignoreCatalog(options: Record<string, JsonValue>): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: SCOPES,
    tagVocabulary: { "type-safety": { description: "Rules that keep type evidence." } },
    rules: { [FORBIDDEN_RULE]: { engine: "plugin", severity: "error", scope: "all", tags: ["type-safety"], options } },
  };
}

function shebangCatalog(options: Record<string, JsonValue>): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: SCOPES,
    tagVocabulary: { scripts: { description: "Utility script headers." } },
    rules: {
      [SHEBANG_RULE]: {
        engine: "plugin",
        severity: "error",
        scope: "all",
        include: ["scripts/**"],
        tags: ["scripts"],
        options,
      },
    },
  };
}

/** The 1-based line of the start of a diagnostic range. */
function lineOf(source: string, range: readonly [number, number]): number {
  return source.slice(0, range[0]).split("\n").length;
}

function linesFor(catalog: Record<string, JsonValue>, source: string, filename: string): number[] {
  const plugin = createTestPlugin(loadTestCatalog(catalog));
  return runPlugin(plugin, filename, source).map((diagnostic) => lineOf(source, diagnostic.range));
}

const IGNORE_ANY = "// deno-lint-ignore no-explicit-any";

Deno.test("no-forbidden-lint-ignore reports a forbidden rule in a line ignore", () => {
  const invalid: readonly (readonly [string, string, number[]])[] = [
    ["a plain ignore", `export const a = 1;\n${IGNORE_ANY}\nexport const b: any = 1;\n`, [2]],
    ["an ignore without a space after the slashes", `export const a = 1;\n//deno-lint-ignore no-explicit-any\n`, [2]],
    ["an ignore with a reason", `export const a = 1;\n${IGNORE_ANY} -- legacy\n`, [2]],
    ["the forbidden rule listed first", `export const a = 1;\n${IGNORE_ANY} no-unused-vars\n`, [2]],
    ["the forbidden rule listed second", `export const a = 1;\n// deno-lint-ignore no-unused-vars no-explicit-any\n`, [
      2,
    ]],
    ["a trailing comment", `export const b: any = 1; ${IGNORE_ANY}\n`, [1]],
  ];
  for (const [name, source, lines] of invalid) {
    assertEquals(linesFor(ignoreCatalog({}), source, PROD), lines, name);
  }
});

Deno.test("no-forbidden-lint-ignore reports a file ignore only when includeFileIgnores is on", () => {
  const source = "// deno-lint-ignore-file no-explicit-any\nexport const b: any = 1;\n";
  assertEquals(linesFor(ignoreCatalog({ includeFileIgnores: true }), source, PROD), [1]);
  assertEquals(linesFor(ignoreCatalog({ includeFileIgnores: false }), source, PROD), []);
});

Deno.test("no-forbidden-lint-ignore accepts other rules, text that is not a comment, and block comments", () => {
  const valid: readonly (readonly [string, string])[] = [
    ["an ignore for another rule", "// deno-lint-ignore no-unused-vars\nexport const b = 1;\n"],
    ["a string literal", `export const s = "${IGNORE_ANY}";\n`],
    ["a template literal", `export const s = \`\n${IGNORE_ANY}\n\`;\n`],
    ["a block comment, which Deno does not honor", "/* deno-lint-ignore no-explicit-any */\nexport const b = 1;\n"],
    ["a rule whose name only starts with the forbidden name", "// deno-lint-ignore no-explicit-anything\n"],
    ["a comment that is not an ignore", "// no-explicit-any is the rule to fix\nexport const b = 1;\n"],
  ];
  for (const [name, source] of valid) {
    assertEquals(linesFor(ignoreCatalog({}), source, PROD), [], name);
  }
});

Deno.test("no-forbidden-lint-ignore honors the forbiddenRules option", () => {
  const source = `export const a = 1;\n// deno-lint-ignore no-console\n${IGNORE_ANY}\n`;
  assertEquals(linesFor(ignoreCatalog({ forbiddenRules: ["no-console"] }), source, PROD), [2]);
  assertEquals(linesFor(ignoreCatalog({ forbiddenRules: [] }), source, PROD), []);
});

Deno.test("no-forbidden-lint-ignore reports once for each forbidden rule in one comment", () => {
  const source = "// deno-lint-ignore no-console no-explicit-any\n";
  assertEquals(linesFor(ignoreCatalog({ forbiddenRules: ["no-console", "no-explicit-any"] }), source, PROD), [1, 1]);
});

const HEADER = "/**\n * @module M\n * @description d.\n */\n";

Deno.test("require-deno-shebang accepts the exact shebang and a shebang with extra flags", () => {
  assertEquals(linesFor(shebangCatalog({}), `${SHEBANG}\n${HEADER}export const a = 1;\n`, SCRIPT), []);
  assertEquals(linesFor(shebangCatalog({}), `${SHEBANG} --unstable\n${HEADER}export const a = 1;\n`, SCRIPT), []);
});

Deno.test("require-deno-shebang reports a missing or different shebang on line 1", () => {
  const invalid: readonly (readonly [string, string])[] = [
    ["a missing shebang", `${HEADER}export const a = 1;\n`],
    ["a different shebang", `#!/usr/bin/env deno run\n${HEADER}export const a = 1;\n`],
    ["an empty file", ""],
  ];
  for (const [name, source] of invalid) {
    assertEquals(linesFor(shebangCatalog({}), source, SCRIPT), [1], name);
  }
});

Deno.test("require-deno-shebang honors a custom shebang option", () => {
  const custom = "#!/usr/bin/env -S deno run --allow-read";
  assertEquals(linesFor(shebangCatalog({ shebang: custom }), `${custom}\n${HEADER}export const a = 1;\n`, SCRIPT), []);
  assertEquals(linesFor(shebangCatalog({ shebang: custom }), `${SHEBANG}\n${HEADER}export const a = 1;\n`, SCRIPT), [
    1,
  ]);
});

Deno.test("require-deno-shebang applies only to the paths the catalog includes", () => {
  const source = `${HEADER}export const a = 1;\n`;
  assertEquals(linesFor(shebangCatalog({}), source, PROD), []);
  assertEquals(linesFor(shebangCatalog({}), source, "tests/scenario_framework/scripts/x.ts"), []);
});
