/**
 * @module PosixPathNodeTest
 * @path tests_node/posix_path.test.mjs
 * @description Runs the POSIX path corpus under Node.js and Bun without Deno.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  dirname as ownDirname,
  join as ownJoin,
  normalize as ownNormalize,
  relative as ownRelative,
  resolve as ownResolve,
} from "../src/engine/posix_path.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = JSON.parse(readFileSync(join(ROOT, "tests", "cases", "posix_path_corpus.json"), "utf8"));

function call(entry) {
  if (entry.function === "normalize") return ownNormalize(entry.inputs[0]);
  if (entry.function === "dirname") return ownDirname(entry.inputs[0]);
  if (entry.function === "join") return ownJoin(...entry.inputs);
  if (entry.function === "relative") return ownRelative(entry.inputs[0], entry.inputs[1]);
  if (entry.function === "resolve") return ownResolve(...entry.inputs);
  throw new Error(`unknown corpus function: ${entry.function}`);
}

test("the own POSIX helpers equal the recorded expectations", () => {
  const wrong = CASES.filter((entry) => call(entry) !== entry.expected);
  assert.deepEqual(wrong, []);
});
