/**
 * @module WholeTreeMagicCheck
 * @path src/rules/whole_tree/magic_check.ts
 * @description Walks a checkout and runs the magic-literal detector with the options of a catalog's wholeTree section.
 * @architectural-layer Shared
 * @dependencies [@std/fs, @std/path, zod]
 * @related-files [src/rules/whole_tree/magic_literals.ts, src/cli/whole_tree.ts]
 */

import { walk } from "@std/fs";
import { relative } from "@std/path";
import { z } from "zod";
import { classifyPath, type JsonValue } from "../../engine/catalog.ts";
import { detectMagicLiterals, type IMagicLiteralFile, type IMagicViolation } from "./magic_literals.ts";
import { parseWholeTreeSettings } from "./options.ts";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const SKIPPED_DIRECTORIES = [/[/\\]\.git[/\\]/, /[/\\]node_modules[/\\]/];

const ScopesSchema = z.object({
  scopes: z.object({ test: z.array(z.string()), fixture: z.array(z.string()) }).default({ test: [], fixture: [] }),
}).loose();

/** Runs the detector over a checkout. Test files count only when `includeTests` is true. */
export async function checkMagicLiterals(
  repoRoot: string,
  catalog: JsonValue,
  includeTests: boolean,
): Promise<IMagicViolation[]> {
  const options = parseWholeTreeSettings(catalog).magicLiterals ?? {};
  const scopes = ScopesSchema.parse(catalog).scopes;
  const files: IMagicLiteralFile[] = [];
  for await (
    const entry of walk(repoRoot, { includeDirs: false, exts: SOURCE_EXTENSIONS, skip: SKIPPED_DIRECTORIES })
  ) {
    const path = relative(repoRoot, entry.path);
    const pathClass = classifyPath(path, scopes);
    if (pathClass === "fixture" || (pathClass === "test" && !includeTests)) continue;
    files.push({ path, text: await Deno.readTextFile(entry.path), isTest: pathClass === "test" });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return detectMagicLiterals(files, options);
}
