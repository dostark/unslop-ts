/**
 * @module WholeTreeConstantRestatement
 * @path packages/lint-rules/src/rules/whole_tree/constant_restatement.ts
 * @description A test must derive a list constant's value, not restate it. Whole-tree rule
 *   (TypeScript/regular-expression scan), moved from scripts/check_constant_restatement.ts.
 * @architectural-layer Shared
 * @dependencies [@std/fs, @std/path]
 * @related-files [packages/lint-rules/src/rules/whole_tree/options.ts, packages/lint-rules/tests/whole_tree_constant_restatement_test.ts]
 * @public Exports are the unit-test surface of this module.
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { type IConstantRestatementSettings, WHOLE_TREE_SETTINGS } from "./options.ts";

/** A test that writes out a constant's value rather than importing the constant. */
export interface IRestatement {
  /** Repo-relative path of the offending test. */
  readonly file: string;
  /** Name of the constant whose value was restated. */
  readonly constant: string;
  /** The restated run of elements, as it appears joined in the source. */
  readonly value: string;
}

/** A source file to inspect. */
export interface ISourceFile {
  readonly path: string;
  readonly source: string;
}

/** Separators a list constant is realistically joined with in an assertion. A plain space is
 * deliberately absent — it would match ordinary English prose in unrelated fixtures. */
const JOIN_SEPARATORS: readonly string[] = [",", ", ", "|", ":"];

/** Characters that mark an element as a structured token, not English prose. */
const STRUCTURED_TOKEN_CHARS = /[./:\-_=]/;

const TEST_SUFFIX = "_test.ts";
const DECLARATION = /export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]/g;

/** Exported list-valued string constants, by name. Numeric lists are skipped since their
 * elements appear in unrelated code constantly and would produce noise. */
export function parseListConstants(
  source: string,
  minRestatedElements = WHOLE_TREE_SETTINGS.constantRestatement.minRestatedElements,
): Map<string, string[]> {
  const constants = new Map<string, string[]>();
  for (const match of source.matchAll(DECLARATION)) {
    const [, name, body] = match;
    // Strip comments so a commented-out entry cannot become an element.
    const withoutComments = body.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");
    const elements = [...withoutComments.matchAll(/"([^"\\]*)"/g)].map((m) => m[1]);
    // Only all-string lists are in scope: any other entry yields fewer matches than commas.
    const commaCount = withoutComments.split(",").filter((part) => part.trim().length > 0).length;
    if (elements.length < minRestatedElements || elements.length !== commaCount) continue;
    // Prose lists are out of scope — see STRUCTURED_TOKEN_CHARS.
    if (!elements.every((element) => STRUCTURED_TOKEN_CHARS.test(element))) continue;
    constants.set(name, elements);
  }
  return constants;
}

/** Every run of `minRestatedElements`-or-more consecutive elements, joined each way. */
function restatableRuns(elements: string[], minRestatedElements: number): string[] {
  const runs: string[] = [];
  for (let start = 0; start < elements.length; start++) {
    for (let end = start + minRestatedElements; end <= elements.length; end++) {
      const slice = elements.slice(start, end);
      for (const separator of JOIN_SEPARATORS) runs.push(slice.join(separator));
    }
  }
  // Longest first, so a finding reports the largest copy rather than a two-element fragment of it.
  return runs.sort((a, b) => b.length - a.length);
}

/** Tests that restate a constant's value without importing the constant. */
export function findRestatements(
  constants: Map<string, string[]>,
  files: ISourceFile[],
  minRestatedElements = WHOLE_TREE_SETTINGS.constantRestatement.minRestatedElements,
): IRestatement[] {
  const findings: IRestatement[] = [];

  for (const file of files) {
    for (const [name, elements] of constants) {
      // Importing the constant is the whole point: a test that derives the value cannot go stale.
      if (new RegExp(`\\b${name}\\b`).test(file.source)) continue;

      const hit = restatableRuns(elements, minRestatedElements).find((run) => file.source.includes(run));
      if (hit !== undefined) findings.push({ file: file.path, constant: name, value: hit });
    }
  }
  return findings;
}

/** Walk a repository checkout and report every restatement in its tests. */
export async function checkRepository(
  repoRoot: string,
  settings: IConstantRestatementSettings,
): Promise<IRestatement[]> {
  const constants = new Map<string, string[]>();
  for (const modulePath of settings.constantModules) {
    const parsed = parseListConstants(
      await Deno.readTextFile(join(repoRoot, modulePath)),
      settings.minRestatedElements,
    );
    for (const [name, elements] of parsed) constants.set(name, elements);
  }

  const files: ISourceFile[] = [];
  for (const root of settings.testRoots) {
    try {
      for await (const entry of walk(join(repoRoot, root), { includeDirs: false, exts: [".ts"] })) {
        if (!entry.name.endsWith(TEST_SUFFIX)) continue;
        files.push({ path: relative(repoRoot, entry.path), source: await Deno.readTextFile(entry.path) });
      }
    } catch {
      // A root need not exist in every checkout shape.
    }
  }

  return findRestatements(constants, files, settings.minRestatedElements)
    .sort((a, b) => a.file.localeCompare(b.file));
}
