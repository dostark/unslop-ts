/**
 * @module PackagePinsTest
 * @path tests_node/package_pins.test.mjs
 * @description Checks the host tooling pins, the excluded directories, and the Deno configuration.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOSTS = JSON.parse(readFileSync(join(ROOT, "hosts", "package.json"), "utf8"));
const DENO = JSON.parse(readFileSync(join(ROOT, "deno.json"), "utf8"));
const LOCK = JSON.parse(readFileSync(join(ROOT, "deno.lock"), "utf8"));
const EXACT = /^\d+\.\d+\.\d+$/;
const HOST_TOOLING = [
  "hosts/",
  "node_modules/",
  "tests_node/",
  "examples/node-project/",
  "examples/bun-project/",
  "dist/",
];

test("every host dependency is exact and none is a standard or JSR package", () => {
  for (const [name, version] of Object.entries(HOSTS.devDependencies ?? {})) {
    assert.match(version, EXACT, `${name} must be exact`);
    assert.ok(!name.startsWith("@std/") && !name.startsWith("@jsr/"), name);
  }
});

test("the host pins equal the versions deno.lock resolves", () => {
  assert.equal(HOSTS.devDependencies.zod, LOCK.specifiers["npm:zod@^4.4.3"]);
  assert.equal(HOSTS.devDependencies.typescript, LOCK.specifiers["npm:typescript@6.0.3"]);
});

test("the Deno configuration excludes the host tooling", () => {
  assert.equal("nodeModulesDir" in DENO, false);
  assert.ok(DENO.test.exclude.includes("tests_node/"));
  assert.ok(DENO.test.exclude.includes("hosts/"));
  for (const entry of HOST_TOOLING) assert.ok(DENO.publish.exclude.includes(entry), entry);
});
