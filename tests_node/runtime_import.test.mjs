/**
 * @module RuntimeImportTest
 * @path tests_node/runtime_import.test.mjs
 * @description Imports the root entry point in-process on Node.js and Bun and checks the install location.
 */

import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as api from "../mod.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PINNED = JSON.parse(readFileSync(join(ROOT, "hosts", "package.json"), "utf8")).devDependencies.zod;

test("mod.ts imports in-process on the running runtime", () => {
  assert.equal(typeof api.parseCatalog, "function");
  assert.equal(typeof api.compileConfig, "function");
});

test("zod resolves from the package install at the pinned version", () => {
  // Node and Bun canonicalize the root link to its hosts/ target, so check both
  // the resolved location and the link that makes the root the nearest install.
  const resolved = import.meta.resolve("zod");
  assert.ok(resolved.includes(`${ROOT}/`), resolved);
  const linked = join(ROOT, "node_modules", "zod", "package.json");
  assert.ok(existsSync(linked), linked);
  const installed = JSON.parse(readFileSync(linked, "utf8")).version;
  assert.equal(installed, PINNED);
});

test("the linker fails with a named error when the install is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-link-"));
  try {
    mkdirSync(join(dir, "hosts"));
    const linker = join(dir, "hosts", "link_node_modules.mjs");
    copyFileSync(join(ROOT, "hosts", "link_node_modules.mjs"), linker);
    const result = spawnSync(process.execPath, [linker], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HOST_INSTALL_MISSING/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
