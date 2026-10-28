/**
 * @module WholeTreeUnusedFilesManifest
 * @path src/rules/whole_tree/unused_files_manifest.ts
 * @description Manifest mode of the unused-files rule: starts the module walk at the entry points of deno.json and package.json, the Deno test discovery, and the configured references, and reports every scanned file that the walk misses.
 * @architectural-layer Shared
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [src/rules/whole_tree/manifest_entries.ts, src/rules/whole_tree/unused_files.ts, src/rules/whole_tree/options.ts]
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { basename, dirname, extname, join, normalize, relative } from "@std/path";
import type { IUnusedFilesManifestSettings } from "./options.ts";
import type { IUnusedFilesReport } from "./unused_files.ts";
import {
  createImportResolver,
  globMatcher,
  type IManifestFacts,
  isDiscoveredTest,
  isPathLiteral,
  type ITestScope,
  mentionCandidates,
  NO_TEST_SCOPE,
  ownsTestScope,
  pathMentions,
  readDenoManifest,
  readPackageManifest,
  readTestScope,
} from "./manifest_entries.ts";

const DENO_MANIFEST = "deno.json";
const PACKAGE_MANIFEST = "package.json";
const STYLESHEET_EXTENSION = ".css";
const DOT_PREFIX = ".";
const ROOT_DIRECTORY = ".";
const SCANNED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  STYLESHEET_EXTENSION,
]);

/** The files that one walk of the tree found, as repository-relative paths in sorted order. */
interface ITreeScan {
  readonly files: string[];
  readonly manifests: string[];
  readonly references: string[];
}

/** What a source file names: module specifiers and string literals. */
interface ISourceMentions {
  readonly specifiers: string[];
  readonly literals: string[];
}

async function scanTree(repoRoot: string, settings: IUnusedFilesManifestSettings): Promise<ITreeScan> {
  const skip = settings.walkSkipPatterns.map((pattern) => new RegExp(pattern));
  const isReference = globMatcher(settings.referenceGlobs);
  const scan: ITreeScan = { files: [], manifests: [], references: [] };
  for await (
    const entry of walk(repoRoot, { includeDirs: false, includeSymlinks: false, followSymlinks: false, skip })
  ) {
    const repoPath = relative(repoRoot, entry.path);
    const name = basename(repoPath);
    if (name === DENO_MANIFEST || name === PACKAGE_MANIFEST) scan.manifests.push(repoPath);
    if (SCANNED_EXTENSIONS.has(extname(repoPath))) scan.files.push(repoPath);
    if (isReference(repoPath)) scan.references.push(repoPath);
  }
  for (const paths of Object.values(scan)) paths.sort();
  return scan;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

/** What the manifests give: their facts, and the test scope of each manifest that runs its own tests. */
interface IManifestRead {
  readonly facts: IManifestFacts[];
  readonly scopes: ReadonlyMap<string, ITestScope>;
}

async function readManifests(repoRoot: string, manifests: readonly string[]): Promise<IManifestRead> {
  const facts: IManifestFacts[] = [];
  const denoManifests: Array<{ dir: string; json: unknown }> = [];
  for (const manifestPath of manifests) {
    const json = await readJson(join(repoRoot, manifestPath));
    const dir = dirname(manifestPath);
    if (basename(manifestPath) === PACKAGE_MANIFEST) {
      facts.push(readPackageManifest(dir, json));
      continue;
    }
    facts.push(readDenoManifest(dir, json));
    denoManifests.push({ dir, json });
  }
  const scopes = new Map(
    denoManifests.filter(({ json }) => ownsTestScope(json)).map(({ dir, json }) => [dir, readTestScope(json)]),
  );
  return { facts, scopes };
}

/** True when `deno test`, run in the directory of the nearest manifest that owns a test scope, picks up the file. */
function isDiscoveredBy(repoPath: string, scopes: ReadonlyMap<string, ITestScope>): boolean {
  for (let dir = dirname(repoPath);; dir = dirname(dir)) {
    const scope = scopes.get(dir);
    if (scope) return isDiscoveredTest(dir === ROOT_DIRECTORY ? repoPath : repoPath.slice(dir.length + 1), scope);
    if (dir === ROOT_DIRECTORY) return isDiscoveredTest(repoPath, NO_TEST_SCOPE);
  }
}

function mentionsOf(sourceFile: ts.SourceFile): ISourceMentions {
  const mentions: ISourceMentions = { specifiers: [], literals: [] };
  const visit = (node: ts.Node): void => {
    const isDeclaration = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
    if (isDeclaration && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      mentions.specifiers.push(node.moduleSpecifier.text);
    }
    const isDynamicImport = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
    if (isDynamicImport && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      mentions.specifiers.push(node.arguments[0].text);
    }
    if (ts.isStringLiteralLike(node)) mentions.literals.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return mentions;
}

function knownCandidates(candidates: readonly string[], known: ReadonlySet<string>): string[] {
  return candidates.filter((candidate) => known.has(candidate));
}

/** The scanned files that one source file imports, re-exports, or names by a path string. */
function targetsOf(
  repoPath: string,
  mentions: ISourceMentions,
  known: ReadonlySet<string>,
  resolveAlias: (specifier: string) => string[],
): Set<string> {
  const targets = new Set<string>();
  for (const specifier of mentions.specifiers) {
    const candidates = specifier.startsWith(DOT_PREFIX)
      ? [normalize(join(dirname(repoPath), specifier))]
      : resolveAlias(specifier);
    for (const target of knownCandidates(candidates, known)) targets.add(target);
  }
  for (const literal of mentions.literals) {
    if (!isPathLiteral(literal)) continue;
    for (const target of knownCandidates(mentionCandidates(repoPath, literal), known)) targets.add(target);
  }
  return targets;
}

async function buildEdges(
  repoRoot: string,
  files: readonly string[],
  known: ReadonlySet<string>,
  resolveAlias: (specifier: string) => string[],
): Promise<Map<string, Set<string>>> {
  const edges = new Map<string, Set<string>>();
  for (const repoPath of files) {
    if (extname(repoPath) === STYLESHEET_EXTENSION) continue;
    const text = await Deno.readTextFile(join(repoRoot, repoPath));
    const sourceFile = ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest);
    edges.set(repoPath, targetsOf(repoPath, mentionsOf(sourceFile), known, resolveAlias));
  }
  return edges;
}

/** The scanned files that the path mentions of the configured reference files name. */
async function referencedFiles(
  repoRoot: string,
  references: readonly string[],
  known: ReadonlySet<string>,
): Promise<string[]> {
  const found: string[] = [];
  for (const reference of references) {
    const text = await Deno.readTextFile(join(repoRoot, reference));
    for (const mention of pathMentions(text)) {
      found.push(...knownCandidates(mentionCandidates(reference, mention), known));
    }
  }
  return found;
}

function reachFrom(entries: Iterable<string>, edges: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const reached = new Set(entries);
  const queue = [...reached];
  while (queue.length > 0) {
    for (const target of edges.get(queue.pop()!) ?? []) {
      if (reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  return reached;
}

/** Walks the tree from the manifest entry points and reports every scanned file that the walk does not reach. */
export async function checkManifestRepository(
  repoRoot: string,
  settings: IUnusedFilesManifestSettings,
): Promise<IUnusedFilesReport> {
  const scan = await scanTree(repoRoot, settings);
  const known = new Set(scan.files);
  const { facts, scopes } = await readManifests(repoRoot, scan.manifests);
  const isExtraEntry = globMatcher([...settings.extraEntries, ...facts.flatMap((fact) => fact.entryGlobs)]);
  const entries = new Set([
    ...knownCandidates(facts.flatMap((fact) => fact.entries), known),
    ...scan.files.filter((repoPath) => isDiscoveredBy(repoPath, scopes) || isExtraEntry(repoPath)),
    ...await referencedFiles(repoRoot, scan.references, known),
  ]);
  const resolveAlias = createImportResolver(facts.flatMap((fact) => fact.importMap));
  const reached = reachFrom(entries, await buildEdges(repoRoot, scan.files, known, resolveAlias));
  const findings = scan.files.filter((repoPath) => !reached.has(repoPath)).map((repoPath) => ({ repoPath }));
  return { findings, scannedFileCount: scan.files.length };
}
