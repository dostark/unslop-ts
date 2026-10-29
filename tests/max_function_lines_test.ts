/**
 * @module MaxFunctionLinesTest
 * @path tests/max_function_lines_test.ts
 * @description Golden line counts for the function-size rule and its code-token ownership.
 * @architectural-layer Test
 * @related-files [src/rules/max_function_lines.ts, src/metrics/function_metrics.ts]
 */

import { assert, assertEquals } from "@std/assert";
import type { JsonValue } from "../mod.ts";
import { runPlugin } from "../deno.ts";
import { measureAll } from "./helpers/measurement.ts";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*.test.ts"],
  fixture: ["**/tests/fixtures/**"],
};
const PROD = "packages/x/src/a.ts";

function buildCatalog(options: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      complexity: { description: "Function size limits." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      "demo/max-function-lines": {
        engine: "plugin",
        severity: "error",
        scope: "prod",
        tags: ["complexity", "deslop"],
        options,
      },
    },
  };
}

function messages(source: string, options: Record<string, JsonValue> = {}): string[] {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(options)));
  return runPlugin(plugin, PROD, source).map((d) => d.message);
}

/** A function whose body holds `statements` one-line statements, so its token lines are that plus two. */
function sized(statements: number): string {
  const body = Array.from({ length: statements }, () => "  void 0;").join("\n");
  return `function sized(): void {\n${body}\n}`;
}

Deno.test("function-lines-rule: sixty token lines pass and sixty-one fail", () => {
  assertEquals(measureAll(sized(58))[0].lines, 60);
  assertEquals(measureAll(sized(59))[0].lines, 61);
  assertEquals(messages(sized(58), { max: 60 }), []);
  assertEquals(messages(sized(59), { max: 60 }), ["Function sized has 61 lines (limit 60)."]);
});

Deno.test("function-lines-rule: comments and blank lines never count", () => {
  const source = "function f(): void {\n" +
    "  // a line comment\n" +
    "  void 0;\n" +
    "\n" +
    "  /* a block\n" +
    "     comment */\n" +
    "  void 0;\n" +
    "}";
  assertEquals(measureAll(source)[0].lines, 4);
});

Deno.test("function-lines-rule: a multiline literal owns every line of its span", () => {
  const source = "function f(): void {\n" +
    "  const text = `a\n" +
    "b\n" +
    "c`;\n" +
    "  void 0;\n" +
    "}";
  assertEquals(measureAll(source)[0].lines, 6);
});

Deno.test("function-lines-rule: a nested function keeps its own lines", () => {
  const source = "function outer(): void {\n" +
    "  const inner = (): void => {\n" +
    "    void 0;\n" +
    "    void 0;\n" +
    "  };\n" +
    "  void 0;\n" +
    "}";
  const metrics = measureAll(source);
  assertEquals(metrics.map((entry) => entry.name), ["outer", "inner"]);
  assertEquals(metrics.map((entry) => entry.lines), [5, 4]);
  const found = messages(source, { max: 3 });
  assertEquals(found.length, 2);
  assert(found.some((message) => message.includes("outer") && message.includes("5")), found.join(" | "));
  assert(found.some((message) => message.includes("inner") && message.includes("4")), found.join(" | "));
});
