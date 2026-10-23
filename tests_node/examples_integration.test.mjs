/**
 * @module ExamplesIntegrationTest
 * @path tests_node/examples_integration.test.mjs
 * @description Spawns the real ESLint and Oxlint CLIs in the Node.js and Bun example projects.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const ESLINT = join(ROOT, "node_modules", "eslint", "bin", "eslint.js");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const PROJECTS = ["examples/node-project", "examples/bun-project"];

function eslintIds(project) {
  const result = spawnSync(process.execPath, [ESLINT, "--format=json", "sample.ts"], {
    cwd: join(ROOT, project),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout)[0].messages
    .map((message) => message.ruleId)
    .filter((id) => typeof id === "string" && id.startsWith("unslop/"))
    .sort();
}

function oxlintIds(project) {
  const result = spawnSync(OXLINT, ["-c", ".oxlintrc.json", "--format=json", "sample.ts"], {
    cwd: join(ROOT, project),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).diagnostics
    .map((entry) => entry.code)
    .filter((code) => typeof code === "string" && code.startsWith("unslop("))
    .map((code) => code.replace(/^unslop\((.*)\)$/, "unslop/$1"))
    .sort();
}

for (const project of PROJECTS) {
  test(`${project} lints its seeded violation through ESLint`, () => {
    assert.deepEqual(eslintIds(project), ["unslop/no-chained-type-assertions"]);
  });

  if (typeof Bun === "undefined") {
    test(`${project} lints its seeded violation through Oxlint`, () => {
      assert.deepEqual(oxlintIds(project), [
        "unslop/no-chained-type-assertions",
        "unslop/no-explicit-unknown",
      ]);
    });
  }
}
