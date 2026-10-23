/**
 * @module EslintAdapterTest
 * @path tests_node/eslint_adapter.test.mjs
 * @description Runs the adapter rule table on ESLint 9.0.0, 9.39.5, and 10.13.0 and checks the host mapping.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Linter, RuleTester as RuleTester10 } from "eslint";
import { RuleTester as RuleTester9 } from "eslint-9";
import { RuleTester as RuleTesterFloor } from "eslint-floor";
import parser from "@typescript-eslint/parser";
import { createEslintPlugin, HINT_SEPARATOR } from "../eslint.ts";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../mod.ts";
import table from "../tests/cases/conformance.json" with { type: "json" };

const RULE_TESTERS = [
  ["10.13.0", RuleTester10],
  ["9.39.5", RuleTester9],
  ["9.0.0", RuleTesterFloor],
];
const LANGUAGE = { parser, ecmaVersion: 2022, sourceType: "module" };
const SETTINGS = {
  unslop: {
    testGlobs: ["**/*_test.ts"],
    fixtureGlobs: ["**/fixtures/**"],
    ignoreGlobs: ["**/vendor/**"],
  },
};
const PLUGIN = createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "unslop" });
const DEFAULT_FILENAME = "src/a.ts";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function caseObjects(entries) {
  return entries.map((entry) => {
    const value = typeof entry === "string" ? { code: entry } : entry;
    return { filename: DEFAULT_FILENAME, ...value };
  });
}

// RuleTester registers suites, so the table runs at module scope for Node.js and Bun.
for (const [, RuleTester] of RULE_TESTERS) {
  const tester = new RuleTester({ languageOptions: LANGUAGE, settings: SETTINGS, plugins: { unslop: PLUGIN } });
  for (const entry of table) {
    const rule = PLUGIN.rules[entry.rule];
    assert.ok(rule, entry.rule);
    tester.run(entry.rule, rule, {
      valid: caseObjects(entry.valid),
      invalid: entry.invalid.map((value) => ({
        code: value.code,
        filename: value.filename ?? DEFAULT_FILENAME,
        ...(value.options === undefined ? {} : { options: value.options }),
        errors: 1,
      })),
    });
  }
}

const ALL_RULES = Object.fromEntries(
  Object.keys(PLUGIN.rules).map((key) => [`unslop/${key}`, "error"]),
);
const FILE_GLOBS = ["**/*.{ts,tsx,js,mjs}"];

function verify(code, rules, { filename = "src/a.ts", settings = SETTINGS, useParser = parser } = {}) {
  const linter = new Linter();
  return linter.verify(
    code,
    [{
      files: FILE_GLOBS,
      plugins: { unslop: PLUGIN },
      languageOptions: useParser === null
        ? { ecmaVersion: 2022, sourceType: "module" }
        : { parser: useParser, ecmaVersion: 2022, sourceType: "module" },
      rules,
      settings,
    }],
    { filename },
  );
}

test("a plain JavaScript file yields no report and no error from any rule", () => {
  const source = "#!/usr/bin/env -S deno run -A\n// Usage:\n//   node script.js\nconst value = 1;\n";
  assert.deepEqual(verify(source, ALL_RULES, { filename: "src/a.js", useParser: null }), []);
});

test("a violating JavaScript file stays silent while TypeScript still reports", () => {
  const source = "export function run(a, b, c, d, e, f, g, h) { return a; }\n";
  const rules = { "unslop/max-params": "error" };
  assert.deepEqual(verify(source, rules, { filename: "src/a.js", useParser: null }), []);
  assert.equal(verify(source, rules, { filename: "src/a.ts" }).length, 1);
});

test("a bare-key docs override remains available to hand-written configs", () => {
  const source = "export function run(a, b, c, d, e, f, g, h) { return a; }\n";
  const settings = { unslop: { ...SETTINGS.unslop, docs: { "max-params": "https://example.test/bare" } } };
  assert.match(verify(source, { "unslop/max-params": "error" }, { settings })[0].message, /example\.test\/bare/);
});

test("every range-only reporter yields a located message and no crash", () => {
  const samples = [
    ["require-deno-shebang", "export const value = 1;\n"],
    ["require-module-header", "export const value = 1;\n"],
    ["require-script-usage", "#!/usr/bin/env -S deno run -A\n// Script entry.\nexport const value = 1;\n"],
    ["require-safety-comment", "export const value = input as string;\n"],
    ["long-comment", "export const value = 1;\n// one\n// two\n// three\n// four\n"],
    ["ephemeral-comment", "export const value = 1;\n// 2024-01-02\n"],
    ["decorative-comment", "export const value = 1;\n// ==========================\n"],
    ["ts-suppression-pragmas", "// @ts-ignore: legacy code\nexport const value = 1;\n"],
    [
      "ignore-needs-reason",
      "// eslint-disable-next-line unslop/no-explicit-unknown\nexport const value: unknown = 1;\n",
    ],
    ["no-forbidden-lint-ignore", "// eslint-disable-next-line unslop/no-explicit-unknown\nexport const value = 1;\n", {
      forbiddenRules: ["unslop/no-explicit-unknown"],
    }],
  ];
  for (const [rule, code, options] of samples) {
    const rules = { [`unslop/${rule}`]: options ? ["error", options] : "error" };
    const messages = verify(code, rules).filter((message) => message.ruleId === `unslop/${rule}`);
    assert.equal(messages.length, 1, rule);
    assert.ok(messages[0].line >= 1 && messages[0].column >= 1, `${rule} has no location`);
    assert.ok(messages[0].message.length > 0, rule);
  }
});

test("a test-glob rule demands settings and classifies a test path", () => {
  const source = "export const value = input as Partial<T> as T;\n";
  const rules = { "unslop/no-chained-type-assertions": "error" };
  assert.throws(
    () => verify(source, rules, { settings: {} }),
    (error) => error.name === "EslintAdapterError",
  );
  assert.equal(verify(source, rules, { filename: "src/a.ts" }).length, 1);
  assert.equal(verify(source, rules, { filename: "src/a_test.ts" }).length, 0);
});

test("settings.unslop.root gives a subdirectory run the root diagnostics", () => {
  const source = "export const value = input as unknown as string;\n";
  const rules = { "unslop/no-chained-type-assertions": "error" };
  const fromRoot = verify(source, rules, {
    filename: "/repo/packages/app/src/a.ts",
    settings: { unslop: { root: "packages/app", testGlobs: ["**/*_test.ts"] } },
  });
  const fromApp = verify(source, rules, {
    filename: "/repo/packages/app/src/a.ts",
    settings: { unslop: { root: ".", testGlobs: ["**/*_test.ts"] } },
  });
  assert.equal(fromRoot.length, fromApp.length);
  assert.equal(fromRoot.length, 1);
});

test("fixture and ignored paths yield no report", () => {
  const source = "export const value = input as unknown as string;\n";
  const rules = { "unslop/no-chained-type-assertions": "error" };
  assert.equal(verify(source, rules, { filename: "src/fixtures/a.ts" }).length, 0);
  assert.equal(verify(source, rules, { filename: "src/vendor/a.ts" }).length, 0);
  assert.equal(verify(source, rules, { filename: "src/a.ts" }).length, 1);
});

test("every rule carries the expected type, docs URL, and hint suffix", () => {
  for (const [key, rule] of Object.entries(PLUGIN.rules)) {
    const packRule = TYPESCRIPT_RULE_PACK.rules[key] ?? DENO_RULE_PACK.rules[key];
    assert.ok(packRule, key);
    assert.equal(
      rule.meta.docs.url,
      `https://github.com/dostark/unslop-ts/blob/main/docs/style_guide.md${packRule.meta.docs}`,
      key,
    );
    const expectedType = ["type-safety", "imports", "boundaries"].includes(packRule.meta.category)
      ? "problem"
      : "suggestion";
    assert.equal(rule.meta.type, expectedType, key);
    assert.equal(rule.meta.schema.length, 1, key);
    assert.equal(rule.meta.defaultOptions.length, 1, key);
  }
  const messages = verify("export function run(a, b, c, d, e, f, g, h) { return a; }\n", {
    "unslop/max-params": "error",
  });
  assert.equal(messages.length, 1);
  assert.ok(messages[0].message.includes(HINT_SEPARATOR), messages[0].message);
});

test("an invalid option is rejected", () => {
  assert.throws(() =>
    verify("export const value = 1;\n", {
      "unslop/max-params": ["error", { max: "many" }],
    })
  );
});

test("eslint and the TypeScript parser resolve from the package install", () => {
  const eslintUrl = import.meta.resolve("eslint");
  const parserUrl = import.meta.resolve("@typescript-eslint/parser");
  assert.ok(eslintUrl.includes(`${ROOT}/`), eslintUrl);
  assert.ok(parserUrl.includes(`${ROOT}/`), parserUrl);
});

test("the ESLint example reports the expected ids", () => {
  const dir = join(ROOT, "examples", "eslint");
  const result = spawnSync(
    process.execPath,
    [join(ROOT, "node_modules", "eslint", "bin", "eslint.js"), "--format=json", "sample.ts"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const reports = JSON.parse(result.stdout);
  assert.deepEqual(
    reports[0].messages.map((message) => message.ruleId).filter((id) => id.startsWith("unslop/")).sort(),
    ["unslop/no-chained-type-assertions"],
  );
});
