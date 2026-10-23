/**
 * @module AdditivityTest
 * @path tests_node/additivity.test.mjs
 * @description Checks the preset shape and membership, the duplicate policy, and that a preset changes no foreign diagnostic.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import parser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import { createEslintPlugin } from "../eslint.ts";
import { DENO_RULE_PACK, TYPESCRIPT_RULE_PACK } from "../mod.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = createEslintPlugin([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], { name: "unslop" });
const BASELINE = [
  js.configs.recommended,
  ...tseslint.configs.strict,
  { files: ["**/*.ts"], languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" } },
];
const CORPUS = {
  any: "export const value: any = 1;\n",
  debugger: "debugger;\n",
  unused: "export function run(a: number) { return 1; }\n",
};
const FILE_GLOBS = ["**/*.ts"];

function mirror(memberships) {
  return Object.entries(TYPESCRIPT_RULE_PACK.rules)
    .filter(([, rule]) => memberships.includes(rule.meta.preset))
    .map(([key]) => `unslop/${key}`)
    .sort();
}

function foreign(messages) {
  return messages.filter((message) => message.ruleId !== null && !message.ruleId.startsWith("unslop/"))
    .map((message) => `${message.ruleId}:${message.line}:${message.message}`)
    .sort();
}

function uncoveredDuplicates(rules, compatRules) {
  return Object.entries(rules)
    .filter(([, rule]) =>
      rule.overlaps?.some((overlap) => overlap.ecosystem === "typescript-eslint" && overlap.kind === "duplicate")
    )
    .map(([key]) => key)
    .filter((key) => compatRules[`unslop/${key}`] !== "off");
}

test("every preset holds only the plugin, unslop rules, and the unslop settings", () => {
  for (const [name, preset] of Object.entries(PLUGIN.configs)) {
    assert.deepEqual(Object.keys(preset).sort(), ["plugins", "rules", "settings"], name);
    assert.equal("languageOptions" in preset, false, name);
    assert.ok(Object.keys(preset.rules).every((id) => id.startsWith("unslop/")), name);
    assert.ok(Object.keys(preset.settings).includes("unslop"), name);
    const severity = name === "strict-error" ? "error" : "warn";
    for (const [id, value] of Object.entries(preset.rules)) {
      assert.ok(value === severity || value === "off", `${name}: ${id} is ${value}`);
    }
  }
});

test("recommended and strict mirror the engine preset memberships", () => {
  assert.deepEqual(Object.keys(PLUGIN.configs.recommended.rules).sort(), mirror(["recommended"]));
  assert.deepEqual(Object.keys(PLUGIN.configs.strict.rules).sort(), mirror(["recommended", "strict"]));
  assert.deepEqual(Object.keys(PLUGIN.configs["strict-error"].rules).sort(), mirror(["recommended", "strict"]));
});

test("every typescript-eslint duplicate is turned off by the compatibility overlay", () => {
  assert.deepEqual(
    uncoveredDuplicates(TYPESCRIPT_RULE_PACK.rules, PLUGIN.configs["typescript-eslint-compat"].rules),
    [],
  );
  const seeded = {
    fake: {
      meta: { preset: "recommended" },
      overlaps: [{ ecosystem: "typescript-eslint", rule: "x", kind: "duplicate" }],
    },
  };
  assert.deepEqual(uncoveredDuplicates(seeded, {}), ["fake"]);
});

test("adding the ESLint preset leaves every foreign diagnostic identical", () => {
  const linter = new Linter();
  for (const [name, code] of Object.entries(CORPUS)) {
    const filename = `src/${name}.ts`;
    const before = foreign(linter.verify(code, BASELINE, { filename }));
    const after = foreign(linter.verify(code, [...BASELINE, PLUGIN.configs.recommended], { filename }));
    assert.deepEqual(after, before, name);
  }
});

test("adding the Oxlint config leaves every foreign diagnostic identical", () => {
  const dir = mkdtempSync(join(ROOT, ".additivity-oxlint-"));
  try {
    for (const [name, code] of Object.entries(CORPUS)) writeFileSync(join(dir, `${name}.ts`), code);
    writeFileSync(join(dir, "baseline.json"), JSON.stringify({ plugins: ["typescript"] }));
    writeFileSync(
      join(dir, "with-preset.json"),
      JSON.stringify({
        plugins: ["typescript"],
        jsPlugins: [join(ROOT, "examples", "oxlint", "unslop.plugin.mjs")],
        rules: PLUGIN.configs.recommended.rules,
        settings: PLUGIN.configs.recommended.settings,
      }),
    );
    const run = (config) => {
      const result = spawnSync(
        join(ROOT, "node_modules", ".bin", "oxlint"),
        ["-c", join(dir, config), "--format=json", dir],
        { encoding: "utf8" },
      );
      return JSON.parse(result.stdout).diagnostics
        .filter((entry) => !entry.code.startsWith("unslop("))
        .map((entry) => `${entry.filename}:${entry.code}`)
        .sort();
    };
    assert.deepEqual(run("with-preset.json"), run("baseline.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the preset files list no foreign rule", () => {
  for (const [name, preset] of Object.entries(PLUGIN.configs)) {
    for (const id of Object.keys(preset.rules)) assert.ok(id.startsWith("unslop/"), `${name}: ${id}`);
  }
  assert.ok(FILE_GLOBS.length > 0);
});
