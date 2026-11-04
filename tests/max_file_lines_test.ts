/**
 * @module MaxFileLinesTest
 * @path tests/max_file_lines_test.ts
 * @description The module size rule: a file above the hard limit is reported once, at its first line, and the soft limit never reports.
 * @architectural-layer Test
 * @related-files [src/rules/max_file_lines.ts, src/rules/rule_options.ts]
 */

import { assertEquals } from "@std/assert";
import type { JsonValue } from "../mod.ts";
import { runPlugin } from "../deno.ts";
import { createTestPlugin, loadTestCatalog, singleRuleCatalog } from "./helpers/registry.ts";
import { TYPESCRIPT_OPTION_SCHEMAS } from "../src/rules/rule_options.ts";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*.test.ts"],
  fixture: ["**/tests/fixtures/**"],
};
const PROD = "packages/x/src/a.ts";

function messages(source: string, options: Record<string, JsonValue> = {}) {
  const catalog = singleRuleCatalog("max-file-lines", options, TEST_SCOPES, "complexity", "prod");
  return runPlugin(createTestPlugin(loadTestCatalog(catalog)), PROD, source);
}

/** A file of exactly `count` physical lines, each ending in a line break. */
function lines(count: number, line = "void 0;"): string {
  return Array.from({ length: count }, () => line).join("\n") + "\n";
}

Deno.test("file-lines-rule: the hard limit passes and one more line fails", () => {
  assertEquals(messages(lines(10), { max: 10 }), []);
  const found = messages(lines(11), { max: 10 });
  assertEquals(found.length, 1);
  assertEquals(found[0].message, "File has 11 lines (limit 10).");
});

Deno.test("file-lines-rule: comments and blank lines count, because an agent reads them", () => {
  const source = lines(4, "// a comment") + lines(4, "") + lines(4);
  assertEquals(messages(source, { max: 11 }).length, 1);
  assertEquals(messages(source, { max: 12 }).length, 0);
});

Deno.test("file-lines-rule: a final line without a line break counts and an empty file is clean", () => {
  assertEquals(messages("void 0;\nvoid 0;", { max: 1 }).length, 1);
  assertEquals(messages("", { max: 1 }), []);
});

Deno.test("file-lines-rule: the lint rule ignores softMax and the default hard limit is 1000", () => {
  assertEquals(messages(lines(30), { max: 40, softMax: 10 }), []);
  assertEquals(messages(lines(1000)), []);
  assertEquals(messages(lines(1001)).length, 1);
});

Deno.test("file-lines-rule: a test file is out of the production scope", () => {
  const catalog = singleRuleCatalog("max-file-lines", { max: 1 }, TEST_SCOPES, "complexity", "prod");
  const found = runPlugin(createTestPlugin(loadTestCatalog(catalog)), "packages/x/tests/a_test.ts", lines(5));
  assertEquals(found, []);
});

Deno.test("file-lines-rule: the options reject an unknown key and a soft limit above the hard limit", () => {
  const schema = TYPESCRIPT_OPTION_SCHEMAS["max-file-lines"];
  assertEquals(schema.safeParse({ softMax: 800, max: 1000 }).success, true);
  assertEquals(schema.safeParse({ extra: 1 }).success, false);
  assertEquals(schema.safeParse({ softMax: 1200, max: 1000 }).success, false);
});
