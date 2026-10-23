/**
 * @module GlobTest
 * @path tests/glob_test.ts
 * @description Checks the own glob matcher against the corpus and the `@std/path` oracle.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [src/engine/glob.ts, tests/cases/glob_corpus.json]
 */

import { assertEquals } from "@std/assert";
import { globToRegExp as oracleGlobToRegExp } from "@std/path";
import { globToRegExp, matchesAnyGlob } from "../src/engine/glob.ts";
import corpus from "./cases/glob_corpus.json" with { type: "json" };

interface IGlobCase {
  readonly glob: string;
  readonly path: string;
  readonly expected: boolean;
}

const CASES: readonly IGlobCase[] = corpus;
const ORACLE_OPTIONS = { extended: true, globstar: true };
const SOURCES_WITHOUT_STD_PATH = ["src/engine/glob.ts", "src/engine/catalog.ts", "src/rules/import_boundaries.ts"];
const STD_PATH_IMPORT = /from\s+["']@std\/path[^"']*["']/;
const REPO_ROOT = new URL("..", import.meta.url);

Deno.test("the glob corpus matches the recorded expectations", () => {
  const wrong = CASES.filter(({ glob, path, expected }) => globToRegExp(glob).test(path) !== expected);
  assertEquals(wrong, []);
});

Deno.test("the glob corpus expectations equal the @std/path oracle", () => {
  const wrong = CASES.filter(({ glob, path, expected }) =>
    oracleGlobToRegExp(glob, ORACLE_OPTIONS).test(path) !== expected
  );
  assertEquals(wrong, []);
});

Deno.test("the own glob regular expression equals the oracle for every corpus glob", () => {
  const globs = [...new Set(CASES.map((entry) => entry.glob))];
  for (const glob of globs) {
    const expected = oracleGlobToRegExp(glob, ORACLE_OPTIONS).source;
    assertEquals(globToRegExp(glob).source, expected, glob);
  }
});

Deno.test("matchesAnyGlob reports when any glob matches", () => {
  assertEquals(matchesAnyGlob("src/a.ts", ["*.md", "src/*.ts"]), true);
  assertEquals(matchesAnyGlob("src/a.ts", ["*.md", "tests/**"]), false);
});

Deno.test("the path-matching sources import nothing from @std/path", async () => {
  for (const source of SOURCES_WITHOUT_STD_PATH) {
    const text = await Deno.readTextFile(new URL(source, REPO_ROOT));
    assertEquals(STD_PATH_IMPORT.test(text), false, source);
  }
});
