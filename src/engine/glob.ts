/**
 * @module GlobMatch
 * @path src/engine/glob.ts
 * @description Matches a repository-relative path against extended globs, with one compiled pattern per glob.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/engine/plugin.ts, src/rules/import_rules.ts]
 */

import { globToRegExp } from "@std/path";

const compiledGlobs = new Map<string, RegExp>();

function globRegex(glob: string): RegExp {
  let regex = compiledGlobs.get(glob);
  if (!regex) {
    regex = globToRegExp(glob, { extended: true, globstar: true });
    compiledGlobs.set(glob, regex);
  }
  return regex;
}

/** True when the path matches at least one of the globs. */
export function matchesAnyGlob(repoPath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globRegex(glob).test(repoPath));
}
