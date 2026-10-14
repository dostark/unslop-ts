/**
 * @module NoChainedTypeAssertionsTest
 * @path packages/lint-rules/tests/no_chained_type_assertions_test.ts
 * @description Rule-level tests for exaix/no-chained-type-assertions, including cases
 *   ported from anti-slop (MIT) at commit 13909c9e07590f5a85d93c62712259fe14a883f7.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { createLintPlugin, type JsonValue, parseCatalog, runPlugin } from "@exaix/lint-rules";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

function buildCatalog(ruleOverrides: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      "type-safety": { description: "Rules that keep type evidence." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      "exaix/no-chained-type-assertions": {
        engine: "plugin",
        severity: "error",
        scope: "all",
        codeStyle: "CODE_STYLE.md#strict-type-safety",
        tags: ["type-safety", "deslop"],
        options: { allowPartialMockInTests: true },
        ...ruleOverrides,
      },
    },
  };
}

const PROD = "packages/x/src/a.ts";
const TEST = "packages/x/tests/a_test.ts";

function run(source: string, filename = PROD, ruleOverrides: Record<string, JsonValue> = {}) {
  const plugin = createLintPlugin("exaix", parseCatalog(buildCatalog(ruleOverrides)));
  return runPlugin(plugin, filename, source);
}

Deno.test("no-chained-type-assertions valid cases report nothing", () => {
  const valid = [
    ["single as assertion", "const value = input as User;", PROD],
    ["parenthesized single assertion (upstream)", "const value = (input as User);", PROD],
    ["const-only chain (upstream)", "const value = ({ id: 1 } as const) as const;", PROD],
    ["satisfies expression", "const value = input satisfies User;", PROD],
    ["partial mock in a test file", "const value = input as Partial<User> as User;", TEST],
    ["never mock in a test file", "const value = input as never as User;", TEST],
    ["any mock in a test file", "const value = input as any as User;", TEST],
  ] as const;
  for (const [name, source, filename] of valid) {
    assertEquals(run(source, filename).length, 0, `expected no report for: ${name}`);
  }
});

Deno.test("no-chained-type-assertions invalid cases report one diagnostic", () => {
  const invalid = [
    ["as chain (upstream)", "const value = input as unknown as User;", PROD],
    ["parenthesized chain (upstream)", "const value = (input as unknown) as User;", PROD],
    ["angle-bracket chain (upstream)", "const value = <User>(<unknown>input);", PROD],
    ["mixed const chain (upstream)", "const value = ({ id: 1 } as const) as User;", PROD],
    ["never chain", "const value = input as never as User;", PROD],
    ["object chain", "const value = input as object as User;", PROD],
    ["double parenthesized chain", "const value = (input as A) as B;", PROD],
    ["partial mock in a production file", "const value = input as Partial<User> as User;", PROD],
  ] as const;
  for (const [name, source, filename] of invalid) {
    const diagnostics = run(source, filename);
    assertEquals(diagnostics.length, 1, `expected one report for: ${name}`);
    assertEquals(diagnostics[0].id, "exaix/no-chained-type-assertions", name);
  }
});

Deno.test("no-chained-type-assertions message names the defect and the hint links the style anchor", () => {
  const diagnostics = run("const value = input as unknown as User;");
  assertStringIncludes(diagnostics[0].message, "Chained type assertions");
  assertStringIncludes(diagnostics[0].hint ?? "", "CODE_STYLE.md#strict-type-safety");
});

Deno.test("no-chained-type-assertions allowPartialMockInTests:false reports the test-file partial chain", () => {
  const diagnostics = run("const value = input as Partial<User> as User;", TEST, {
    options: { allowPartialMockInTests: false },
  });
  assertEquals(diagnostics.length, 1);
});

Deno.test("no-chained-type-assertions allowNeverAnyMockInTests:false reports the test-file never mock", () => {
  const diagnostics = run("const value = input as never as User;", TEST, {
    options: { allowNeverAnyMockInTests: false },
  });
  assertEquals(diagnostics.length, 1);
});

Deno.test("no-chained-type-assertions severity off reports nothing", () => {
  const diagnostics = run("const value = input as unknown as User;", PROD, {
    severity: "off",
    reason: "disabled in this probe",
  });
  assertEquals(diagnostics.length, 0);
});

Deno.test("no-chained-type-assertions respects the rule scope (test-only rule skips production)", () => {
  const diagnostics = run("const value = input as unknown as User;", PROD, { scope: "test" });
  assertEquals(diagnostics.length, 0);
});
