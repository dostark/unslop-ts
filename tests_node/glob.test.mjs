/**
 * @module GlobNodeTest
 * @path tests_node/glob.test.mjs
 * @description Runs the glob corpus under Node.js and Bun without Deno.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { globToRegExp, matchesAnyGlob } from "../src/engine/glob.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = JSON.parse(readFileSync(join(ROOT, "tests", "cases", "glob_corpus.json"), "utf8"));

test("the glob corpus matches the recorded expectations", () => {
  const wrong = CASES.filter((entry) => globToRegExp(entry.glob).test(entry.path) !== entry.expected);
  assert.deepEqual(wrong, []);
});

test("matchesAnyGlob reports when any glob matches", () => {
  assert.equal(matchesAnyGlob("src/a.ts", ["*.md", "src/*.ts"]), true);
  assert.equal(matchesAnyGlob("src/a.ts", ["*.md", "tests/**"]), false);
});
