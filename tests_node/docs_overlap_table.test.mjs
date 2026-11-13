/**
 * @module DocsOverlapTableTest
 * @path tests_node/docs_overlap_table.test.mjs
 * @description Checks the rules-page overlap table against the rule metadata.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const SCRIPT = join(ROOT, "scripts", "generate_overlap_table.mjs");
const RULES_PAGE = readFileSync(join(ROOT, "docs", "reference", "rules.md"), "utf8");

test("the rules-page overlap table is generated from the rule metadata", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const table = RULES_PAGE.split("<!-- BEGIN GENERATED OVERLAPS -->")[1].split("<!-- END GENERATED OVERLAPS -->")[0];
  assert.match(table, /\|\s*unslop rule\s*\|\s*Ecosystem\s*\|\s*Foreign rule\s*\|\s*Kind\s*\|/);
  assert.ok(table.split("\n").filter((line) => line.startsWith("| `unslop/")).length > 0);
});
