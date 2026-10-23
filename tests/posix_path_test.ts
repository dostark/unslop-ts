/**
 * @module PosixPathTest
 * @path tests/posix_path_test.ts
 * @description Checks the own POSIX path helpers against the corpus and the `@std/path` oracle.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [src/engine/posix_path.ts, tests/cases/posix_path_corpus.json]
 */

import { assertEquals } from "@std/assert";
import { dirname as oracleDirname, join as oracleJoin, normalize as oracleNormalize } from "@std/path/posix";
import { dirname, join, normalize } from "../src/engine/posix_path.ts";
import corpus from "./cases/posix_path_corpus.json" with { type: "json" };

interface IPosixCase {
  readonly function: string;
  readonly inputs: readonly string[];
  readonly expected: string;
}

const CASES: readonly IPosixCase[] = corpus;

function ownCall(entry: IPosixCase): string {
  if (entry.function === "normalize") return normalize(entry.inputs[0]);
  if (entry.function === "dirname") return dirname(entry.inputs[0]);
  if (entry.function === "join") return join(...entry.inputs);
  throw new Error(`unknown corpus function: ${entry.function}`);
}

function oracleCall(entry: IPosixCase): string {
  if (entry.function === "normalize") return oracleNormalize(entry.inputs[0]);
  if (entry.function === "dirname") return oracleDirname(entry.inputs[0]);
  if (entry.function === "join") return oracleJoin(...entry.inputs);
  throw new Error(`unknown corpus function: ${entry.function}`);
}

Deno.test("the own POSIX helpers equal the recorded expectations", () => {
  const wrong = CASES.filter((entry) => ownCall(entry) !== entry.expected);
  assertEquals(wrong, []);
});

Deno.test("the POSIX corpus expectations equal the @std/path oracle", () => {
  const wrong = CASES.filter((entry) => oracleCall(entry) !== entry.expected);
  assertEquals(wrong, []);
});
