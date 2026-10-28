/**
 * @module WholeTreeManifestEntries
 * @path src/rules/whole_tree/manifest_entries.ts
 * @description Reads the entry points, the import map, and the test scope from deno.json and package.json for the manifest mode of the unused-files rule.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/rules/whole_tree/unused_files_manifest.ts, src/rules/whole_tree/options.ts]
 */

import { basename, dirname, globToRegExp, join, normalize } from "@std/path";

const CODE_EXTENSIONS = "tsx?|mts|cts|jsx?|mjs|cjs";
const PATH_SOURCE = `[\\w@$.{}/-]+\\.(?:${CODE_EXTENSIONS}|css)`;
const PATH_TOKEN = new RegExp(`${PATH_SOURCE}\\b`, "g");
const PATH_LITERAL = new RegExp(`^${PATH_SOURCE}$`);
const GLOB_TOKEN = new RegExp(`[\\w@$.{}/*-]*\\*[\\w@$.{}/*-]*\\.(?:${CODE_EXTENSIONS})\\b`, "g");
const TEST_COMMAND = /\b(?:deno test|node --test|bun test|vitest|jest|mocha)\b/;
const CD_PREFIX = /^\s*cd\s+(\S+)\s*&&\s*/;
const ROOT_VARIABLE_PREFIX = /^\$\{?[A-Z_]+\}?\//;
const TEST_BASENAME = /(?:^|[._])test\.(?:tsx?|mts|jsx?|mjs)$/;
const SLASH = "/";
const ROOT_DIRECTORY = ".";
const GLOB_MARK = "*";
const DENO_TEST_COMMAND = "deno test";

/** One key of an import map and the repository path that it maps to. */
export interface IImportMapEntry {
  readonly key: string;
  readonly target: string;
}

/** What one manifest contributes: repository paths and globs that start the walk, and import map entries. */
export interface IManifestFacts {
  readonly entries: readonly string[];
  readonly entryGlobs: readonly string[];
  readonly importMap: readonly IImportMapEntry[];
}

/** The paths that the Deno test discovery covers. An empty include list covers every path. */
export interface ITestScope {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

const NO_FACTS: IManifestFacts = { entries: [], entryGlobs: [], importMap: [] };
export const NO_TEST_SCOPE: ITestScope = { include: [], exclude: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValues(value: unknown): unknown[] {
  return isRecord(value) ? Object.values(value) : [];
}

/** Every string below a manifest field, whether the field is a string, a list, or a nested condition map. */
function leafStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leafStrings);
  return recordValues(value).flatMap(leafStrings);
}

function commandText(task: unknown): string {
  if (typeof task === "string") return task;
  return isRecord(task) && typeof task.command === "string" ? task.command : "";
}

/** The paths and test globs that one task or script command names, relative to the repository root. */
interface ICommandFacts {
  readonly paths: string[];
  readonly globs: string[];
}

function commandFacts(dir: string, task: unknown): ICommandFacts {
  const text = commandText(task);
  const moved = CD_PREFIX.exec(text);
  const base = moved ? resolveIn(dir, moved[1]) : dir;
  const command = moved ? text.slice(moved[0].length) : text;
  const globs = TEST_COMMAND.test(command) ? command.match(GLOB_TOKEN) ?? [] : [];
  return {
    paths: (command.match(PATH_TOKEN) ?? []).map((path) => resolveIn(base, path)),
    globs: globs.map((glob) => resolveIn(base, glob)),
  };
}

function resolveIn(dir: string, path: string): string {
  return normalize(join(dir, path));
}

function importMapOf(dir: string, imports: unknown): IImportMapEntry[] {
  if (!isRecord(imports)) return [];
  return Object.entries(imports).flatMap(([key, value]) =>
    typeof value === "string" && value.startsWith(".") ? [{ key, target: resolveIn(dir, value) }] : []
  );
}

/** Facts of the `scripts`/`tasks` commands of one manifest. */
function commandsOf(dir: string, commands: unknown): ICommandFacts[] {
  return recordValues(commands).map((task) => commandFacts(dir, task));
}

function factsOf(dir: string, fieldPaths: readonly string[], commands: ICommandFacts[]): IManifestFacts {
  return {
    entries: [...fieldPaths.map((path) => resolveIn(dir, path)), ...commands.flatMap((command) => command.paths)],
    entryGlobs: commands.flatMap((command) => command.globs),
    importMap: [],
  };
}

/** Entry points from `exports`, `tasks`, and `lint.plugins`, and the `imports` map of a deno.json. */
export function readDenoManifest(dir: string, json: unknown): IManifestFacts {
  if (!isRecord(json)) return NO_FACTS;
  const fieldPaths = [...leafStrings(json.exports), ...(isRecord(json.lint) ? leafStrings(json.lint.plugins) : [])];
  return { ...factsOf(dir, fieldPaths, commandsOf(dir, json.tasks)), importMap: importMapOf(dir, json.imports) };
}

/** Entry points from `main`, `module`, `bin`, `exports`, and the code paths in `scripts` of a package.json. */
export function readPackageManifest(dir: string, json: unknown): IManifestFacts {
  if (!isRecord(json)) return NO_FACTS;
  const fieldPaths = [json.main, json.module, json.bin, json.exports].flatMap(leafStrings);
  return factsOf(dir, fieldPaths, commandsOf(dir, json.scripts));
}

/** True when running `deno test` in the manifest directory is how its tests run: a `test` section or a `deno test` task. */
export function ownsTestScope(json: unknown): boolean {
  if (!isRecord(json)) return false;
  return isRecord(json.test) || recordValues(json.tasks).some((task) => commandText(task).includes(DENO_TEST_COMMAND));
}

/** The `test.include` and `test.exclude` lists of a deno.json. */
export function readTestScope(json: unknown): ITestScope {
  if (!isRecord(json) || !isRecord(json.test)) return NO_TEST_SCOPE;
  return { include: leafStrings(json.test.include), exclude: leafStrings(json.test.exclude) };
}

function matchesScopePattern(repoPath: string, pattern: string): boolean {
  const cleaned = normalize(pattern);
  if (cleaned.includes(GLOB_MARK)) return globToRegExp(cleaned, { extended: true, globstar: true }).test(repoPath);
  const bare = cleaned.endsWith(SLASH) ? cleaned.slice(0, -1) : cleaned;
  return repoPath === bare || repoPath.startsWith(bare + SLASH);
}

/** True when `deno test` runs the file: the name follows the test convention and the scope covers the path. */
export function isDiscoveredTest(repoPath: string, scope: ITestScope): boolean {
  if (!TEST_BASENAME.test(basename(repoPath))) return false;
  const included = scope.include.length === 0 || scope.include.some((p) => matchesScopePattern(repoPath, p));
  return included && !scope.exclude.some((p) => matchesScopePattern(repoPath, p));
}

/** Compiles globs once and tests repository paths against them. */
export function globMatcher(globs: readonly string[]): (repoPath: string) => boolean {
  const patterns = globs.map((glob) => globToRegExp(glob, { extended: true, globstar: true }));
  return (repoPath) => patterns.some((pattern) => pattern.test(repoPath));
}

/** Resolves a bare specifier through the import maps. An exact key matches itself; only a key with a trailing slash is a prefix. */
export function createImportResolver(entries: readonly IImportMapEntry[]): (specifier: string) => string[] {
  const exact = new Map<string, string[]>();
  const prefixes: IImportMapEntry[] = [];
  for (const entry of entries) {
    if (entry.key.endsWith(SLASH)) prefixes.push(entry);
    const targets = exact.get(entry.key) ?? [];
    if (!targets.includes(entry.target)) exact.set(entry.key, [...targets, entry.target]);
  }
  return (specifier) => {
    const targets = [...(exact.get(specifier) ?? [])];
    for (const { key, target } of prefixes) {
      if (specifier.startsWith(key) && specifier !== key) targets.push(resolveIn(target, specifier.slice(key.length)));
    }
    return targets;
  };
}

/** The code paths that a text names, as written in the text. */
export function pathMentions(text: string): string[] {
  return text.match(PATH_TOKEN) ?? [];
}

/** True when a string literal reads as a path with a directory part, such as `../tools/run.ts`. */
export function isPathLiteral(text: string): boolean {
  return text.includes(SLASH) && PATH_LITERAL.test(text);
}

function ancestorDirectories(path: string): string[] {
  const directories = [dirname(path)];
  while (directories[directories.length - 1] !== ROOT_DIRECTORY) {
    directories.push(dirname(directories[directories.length - 1]));
  }
  return directories;
}

/**
 * The repository paths that a mention may stand for. A mention with a variable prefix, such as `$SUITE_HOME/x.ts`, names
 * a directory that the file does not state, so each ancestor directory of the file is a candidate. Any other mention is
 * relative to the file that holds it or to the repository root.
 */
export function mentionCandidates(fromPath: string, mention: string): string[] {
  const cleaned = mention.replace(ROOT_VARIABLE_PREFIX, "");
  if (cleaned !== mention) return ancestorDirectories(fromPath).map((directory) => resolveIn(directory, cleaned));
  return [resolveIn(dirname(fromPath), cleaned), normalize(cleaned)];
}
