/**
 * @module OxlintHostRunner
 * @path tests_node/hosts/oxlint.mjs
 * @description Runs one rule case through the Oxlint CLI and returns its diagnostics in the shared shape.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const PLUGIN = join(ROOT, "examples", "oxlint", "unslop.plugin.mjs");

function normalizeCode(code) {
  const match = /^unslop\((.+)\)$/.exec(code);
  return match === null ? code : `unslop/${match[1]}`;
}

/** Runs a case through the Oxlint CLI with a temporary flat configuration. */
export function runOxlintHost(testCase) {
  const dir = mkdtempSync(join(tmpdir(), "unslop-oxlint-host-"));
  try {
    const sample = join(dir, "sample.ts");
    const config = join(dir, "oxlintrc.json");
    writeFileSync(sample, testCase.code);
    writeFileSync(
      config,
      JSON.stringify({
        plugins: ["typescript"],
        jsPlugins: [PLUGIN],
        rules: {
          [`unslop/${testCase.rule}`]: testCase.options === undefined ? "error" : ["error", testCase.options],
        },
      }),
    );
    const result = spawnSync(OXLINT, ["-c", config, "--format=json", sample], { cwd: ROOT, encoding: "utf8" });
    const parsed = JSON.parse(result.stdout);
    return parsed.diagnostics.map((entry) => ({
      rule: normalizeCode(entry.code),
      line: entry.labels[0]?.span.line ?? 0,
      column: entry.labels[0]?.span.column ?? 0,
      message: entry.message,
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
