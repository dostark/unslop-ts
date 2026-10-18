/**
 * @module RequireSafetyCommentTest
 * @path packages/lint-rules/tests/require_safety_comment_test.ts
 * @description Marker-comment placement rules for exaix/require-safety-comment (anti-slop, MIT).
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/rules/evidence_rules.ts]
 */

import { assertEquals } from "@std/assert";
import { type JsonValue, runPlugin } from "@exaix/lint-rules";
import { createTestPlugin, loadTestCatalog } from "./helpers/registry.ts";

const TEST_SCOPES = {
  test: ["**/tests/**", "**/*_test.ts", "**/*_test.tsx", "**/*.test.ts"],
  fixture: ["tests/scenario_framework/fixtures/**", "**/tests/fixtures/**"],
};

const PROD = "packages/x/src/a.ts";

function buildCatalog(options: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    version: "1",
    scopes: TEST_SCOPES,
    tagVocabulary: {
      "type-safety": { description: "Rules that keep type evidence." },
      deslop: { description: "Rule idea from deslop or anti-slop." },
    },
    rules: {
      "exaix/require-safety-comment": {
        engine: "plugin",
        severity: "error",
        scope: "prod",
        tags: ["type-safety", "deslop"],
        options,
      },
    },
  };
}

function reports(source: string, overrides: Record<string, JsonValue> = {}): boolean {
  const plugin = createTestPlugin(loadTestCatalog(buildCatalog(overrides)));
  return runPlugin(plugin, PROD, source).length > 0;
}

Deno.test("require-safety-comment accepts a marker before the statement", () => {
  assertEquals(reports("// SAFETY: upstream payload is untrusted here\nexport const v = input as User;\n"), false);
});

Deno.test("require-safety-comment accepts a marker on the line above the assertion", () => {
  assertEquals(
    reports("export const v =\n  // SAFETY: parsed at the boundary\n  input as User;\n"),
    false,
  );
});

Deno.test("require-safety-comment accepts a custom marker", () => {
  const source = "// INVARIANT: reviewed by hand\nexport const v = input as User;\n";
  assertEquals(reports(source, { markers: ["INVARIANT"] }), false);
  assertEquals(reports(source, { markers: ["SAFETY"] }), true);
});

Deno.test("require-safety-comment reports a missing marker", () => {
  assertEquals(reports("export const v = input as User;\n"), true);
});

Deno.test("require-safety-comment reports a marker with no text", () => {
  assertEquals(reports("// SAFETY:\nexport const v = input as User;\n"), true);
});

Deno.test("require-safety-comment ignores a marker after the assertion", () => {
  assertEquals(reports("export const v = input as User;\n// SAFETY: too late\n"), true);
});

Deno.test("require-safety-comment ignores a marker above an earlier statement", () => {
  assertEquals(
    reports("// SAFETY: belongs to the line below\nexport const a = 1;\nexport const v = input as User;\n"),
    true,
  );
});

// Upstream cases below are ported from anti-slop (MIT) at commit
// 13909c9e07590f5a85d93c62712259fe14a883f7, with upstream case names kept.

Deno.test("require-safety-comment upstream custom-marker cases", () => {
  const valid: Array<[string, string, Record<string, JsonValue>]> = [
    ["INVARIANT configured", "// INVARIANT: The caller parsed this value.\nconst value = input as User;", {
      markers: ["INVARIANT"],
    }],
    ["SAFETY also configured", "// SAFETY: The caller parsed this value.\nconst value = input as User;", {
      markers: ["INVARIANT", "SAFETY"],
    }],
    ["SAFE+ marker", "// SAFE+: The caller parsed this value.\nconst value = input as User;", { markers: ["SAFE+"] }],
  ];
  for (const [name, source, options] of valid) {
    assertEquals(reports(source, options), false, `expected no report for: ${name}`);
  }
  const invalid: Array<[string, string, Record<string, JsonValue>]> = [
    ["unconfigured SAFETY marker", "// SAFETY: This marker is not configured.\nconst value = input as User;", {
      markers: ["INVARIANT"],
    }],
    ["INVARIANT with only spaces", "// INVARIANT:   \nconst value = input as User;", { markers: ["INVARIANT"] }],
  ];
  for (const [name, source, options] of invalid) {
    assertEquals(reports(source, options), true, `expected a report for: ${name}`);
  }
});

Deno.test("require-safety-comment upstream default-marker valid cases", () => {
  const valid: Array<[string, string]> = [
    ["as const is exempt", "const values = [1, 2] as const;"],
    ["angle-bracket const is exempt", "const value = <const>{ id: 'one' };"],
    [
      "marker before the statement",
      "// SAFETY: The parser established the UserId invariant.\nconst id = value as UserId;",
    ],
    [
      "marker inside a function before the return",
      "function parse(): UserId {\n// SAFETY: Validation above established the UserId invariant.\nreturn value as UserId;\n}",
    ],
    ["inline block marker", "const id = /* SAFETY: Validation established the invariant. */ value as UserId;"],
    [
      "marker before an export",
      "// SAFETY: The parser established the exported UserId invariant.\nexport const id = value as UserId;",
    ],
    [
      "block marker before an export",
      "/* SAFETY:\n * The parser established the exported UserId invariant.\n */\nexport const id = value as UserId;",
    ],
  ];
  for (const [name, source] of valid) {
    assertEquals(reports(source), false, `expected no report for: ${name}`);
  }
});

Deno.test("require-safety-comment upstream default-marker invalid cases", () => {
  const invalid: Array<[string, string]> = [
    ["plain cast", "const id = value as UserId;"],
    ["angle-bracket cast", "const id = <UserId>value;"],
    ["marker after the assertion", "const id = value as UserId; // SAFETY: Too late."],
    ["unrelated leading comment", "// This cast seems fine.\nconst id = value as UserId;"],
    ["empty marker", "// SAFETY:\nconst id = value as UserId;"],
    ["whitespace-only marker", "// SAFETY:   \nconst id = value as UserId;"],
    ["empty inline marker", "const id = /* SAFETY: */ value as UserId;"],
    ["exported cast", "export const id = value as UserId;"],
    ["non-justification comment", "// This is not a safety justification.\nexport const id = value as UserId;"],
  ];
  for (const [name, source] of invalid) {
    assertEquals(reports(source), true, `expected a report for: ${name}`);
  }
});
