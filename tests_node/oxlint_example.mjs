/**
 * @module OxlintExampleTest
 * @path tests_node/oxlint_example.test.mjs
 * @description Runs the Oxlint example through jsPlugins and checks ids, locations, hints, and schema rejection.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const EXAMPLE = join(ROOT, "examples", "oxlint");
const SAMPLE = join(EXAMPLE, "sample.ts");
const CONFIG = join(EXAMPLE, ".oxlintrc.json");
const EXPECTED_IDS = [
  "unslop(no-explicit-unknown)",
  "unslop(require-safety-comment)",
  "unslop(long-comment)",
];

function runOxlint(args) {
  return spawnSync(OXLINT, args, { cwd: ROOT, encoding: "utf8" });
}

test("the Oxlint example reports the expected ids, locations, and hint", () => {
  const result = runOxlint(["-c", CONFIG, "--format=json", SAMPLE]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.deepEqual(diagnostics.map((entry) => entry.code).sort(), [...EXPECTED_IDS].sort());
  for (const entry of diagnostics) {
    assert.ok(entry.message.includes("Hint:"), entry.message);
    assert.ok(entry.labels[0].span.line >= 1 && entry.labels[0].span.column >= 1, entry.code);
  }
});

test("Oxlint rejects an invalid rule option with a schema error", () => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-oxlint-"));
  try {
    const config = join(dir, "oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({
        plugins: ["typescript"],
        jsPlugins: [join(EXAMPLE, "unslop.plugin.mjs")],
        rules: { "unslop/max-params": ["error", { max: "many" }] },
      }),
    );
    const result = runOxlint(["-c", config, SAMPLE]);
    const output = result.stdout + result.stderr;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /should be integer/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
