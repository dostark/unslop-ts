/**
 * @module OverlapTest
 * @path tests_node/overlap.test.mjs
 * @description Keeps every engine rule's declared overlaps in step with the ESLint and Oxlint host rule sets.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import comments from "@eslint-community/eslint-plugin-eslint-comments";
import parser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import table from "../tests/cases/overlap_expectations.json" with { type: "json" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = table;
const ESLINT_CONFIG = [
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts"],
    plugins: { "@eslint-community/eslint-comments": comments },
    rules: {
      ...comments.configs.recommended.rules,
      "@eslint-community/eslint-comments/require-description": "error",
    },
  },
  { files: ["**/*.ts"], languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" } },
];
const SEEDED = "export const value: any = 1;\n";
const OXLINT_SEEDED = "debugger;\n";

function undeclared(actual, expected) {
  return [...new Set(actual)].filter((code) => !(code in expected));
}

function problemsFor(label, collected) {
  return CASES.flatMap((entry, index) => {
    const expected = entry.expected[label] ?? {};
    return [
      ...undeclared(collected[index], expected).map((code) => `${entry.rule}: undeclared ${code}`),
      ...Object.keys(expected).filter((code) => !collected[index].includes(code)).map((code) =>
        `${entry.rule}: declared ${code} does not fire`
      ),
    ];
  });
}

function collectEslint() {
  return CASES.map((entry) => {
    const messages = new Linter().verify(entry.source, ESLINT_CONFIG, { filename: "src/a.ts" });
    return messages.map((message) => message.ruleId).filter((id) => id !== null && !id.startsWith("unslop/"));
  });
}

function collectOxlint() {
  const dir = mkdtempSync(join(ROOT, ".overlap-oxlint-"));
  try {
    for (const [index, entry] of CASES.entries()) {
      writeFileSync(join(dir, `case_${String(index).padStart(2, "0")}.ts`), entry.source);
    }
    writeFileSync(join(dir, "oxlintrc.json"), JSON.stringify({ plugins: ["typescript"] }));
    const result = spawnSync(
      join(ROOT, "node_modules", ".bin", "oxlint"),
      ["-c", join(dir, "oxlintrc.json"), "--format=json", dir],
      { encoding: "utf8" },
    );
    const collected = CASES.map(() => []);
    for (const diagnostic of JSON.parse(result.stdout).diagnostics) {
      const match = /case_(\d+)\.ts$/.exec(diagnostic.filename);
      if (match === null) continue;
      collected[Number(match[1])].push(diagnostic.code);
    }
    return collected;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("every ESLint code on a case is declared, and every declared code fires", () => {
  assert.deepEqual(problemsFor("eslint", collectEslint()), []);
});

test("every Oxlint code on a case is declared, and every declared code fires", () => {
  assert.deepEqual(problemsFor("oxlint", collectOxlint()), []);
});

test("an undeclared ESLint code fails", () => {
  const codes = new Linter().verify(SEEDED, ESLINT_CONFIG, { filename: "src/a.ts" })
    .map((message) => message.ruleId)
    .filter((id) => id !== null);
  assert.ok(undeclared(codes, {}).includes("@typescript-eslint/no-explicit-any"));
});

test("an undeclared Oxlint code fails", () => {
  const dir = mkdtempSync(join(ROOT, ".overlap-oxlint-seed-"));
  try {
    writeFileSync(join(dir, "seeded.ts"), OXLINT_SEEDED);
    writeFileSync(join(dir, "oxlintrc.json"), JSON.stringify({ plugins: ["typescript"] }));
    const result = spawnSync(
      join(ROOT, "node_modules", ".bin", "oxlint"),
      ["-c", join(dir, "oxlintrc.json"), "--format=json", dir],
      { encoding: "utf8" },
    );
    const codes = JSON.parse(result.stdout).diagnostics.map((entry) => entry.code);
    assert.ok(undeclared(codes, {}).length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
