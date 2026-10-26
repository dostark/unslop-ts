/**
 * @module WholeTreeUnusedFiles
 * @path src/rules/whole_tree/unused_files.ts
 * @description Finds production files that no entry point reaches, following relative imports, re-exports, and configured aliases.
 * @architectural-layer Shared
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [src/rules/whole_tree/options.ts, src/cli/whole_tree.ts]
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, join, normalize } from "@std/path";
import type { IUnusedFilesSettings } from "./options.ts";

/** One production file that no entry point reaches. */
export interface IUnusedFile {
  readonly repoPath: string;
}

/** The result of an unused-files run. */
export interface IUnusedFilesReport {
  readonly findings: readonly IUnusedFile[];
  /** How many `.ts` files the walk read, so a host can show the analyzed scope. */
  readonly scannedFileCount: number;
}

const TS_EXTENSION = ".ts";
const DOT_PREFIX = ".";

function toRepoPath(repoRoot: string, absolutePath: string): string {
  return absolutePath.startsWith(repoRoot + "/") ? absolutePath.slice(repoRoot.length + 1) : absolutePath;
}

function matchesAnySegment(repoPath: string, segments: readonly string[]): boolean {
  return segments.some((segment) => repoPath.includes(segment));
}

function matchesAnySuffix(repoPath: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => repoPath.endsWith(suffix));
}

function isTestFile(repoPath: string, settings: IUnusedFilesSettings): boolean {
  return matchesAnySegment(repoPath, settings.testSegments) || matchesAnySuffix(repoPath, settings.testSuffixes);
}

function isScriptFile(repoPath: string, settings: IUnusedFilesSettings): boolean {
  return repoPath.startsWith(settings.scriptRoot + "/");
}

function isEntryFile(repoPath: string, settings: IUnusedFilesSettings): boolean {
  return isTestFile(repoPath, settings) || isScriptFile(repoPath, settings) ||
    matchesAnySuffix(repoPath, settings.entrypointSuffixes) ||
    matchesAnySuffix(repoPath, settings.mainEntrypointSuffixes);
}

function isProductionFile(repoPath: string, settings: IUnusedFilesSettings): boolean {
  if (!settings.productionRoots.some((root) => repoPath.startsWith(root))) return false;
  if (isTestFile(repoPath, settings) || isEntryFile(repoPath, settings)) return false;
  return !matchesAnySegment(repoPath, settings.skipSegments) &&
    !settings.skipPrefixes.some((p) => repoPath.startsWith(p));
}

function walkSkipPatterns(settings: IUnusedFilesSettings): RegExp[] {
  return settings.walkSkipPatterns.map((pattern) => new RegExp(pattern));
}

async function collectFiles(repoRoot: string, settings: IUnusedFilesSettings): Promise<string[]> {
  const files: string[] = [];
  const skip = walkSkipPatterns(settings);
  try {
    for await (
      const entry of walk(repoRoot, { includeDirs: false, exts: [TS_EXTENSION], followSymlinks: false, skip })
    ) {
      files.push(toRepoPath(repoRoot, entry.path));
    }
  } catch {
    return files;
  }
  return files;
}

function specifiersOf(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  ts.forEachChild(sourceFile, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    }
  });
  return specifiers;
}

function resolveRelative(importerRepoPath: string, specifier: string): string {
  return normalize(join(dirname(importerRepoPath), specifier));
}

function resolveAlias(specifier: string, settings: IUnusedFilesSettings): string | null {
  let best: { readonly prefix: string; readonly target: string } | null = null;
  for (const alias of settings.aliases) {
    if (specifier !== alias.prefix && !specifier.startsWith(alias.prefix)) continue;
    if (best === null || alias.prefix.length > best.prefix.length) best = alias;
  }
  if (best === null) return null;
  if (specifier === best.prefix) return normalize(best.target);
  const rest = specifier.slice(best.prefix.length).replace(/^\//, "");
  return normalize(join(best.target, rest));
}

function resolveTarget(
  importerRepoPath: string,
  specifier: string,
  settings: IUnusedFilesSettings,
): string | null {
  if (specifier.startsWith(DOT_PREFIX)) return resolveRelative(importerRepoPath, specifier);
  return resolveAlias(specifier, settings);
}

/** Builds the module graph and reports every production file that no entry point reaches. */
export async function checkRepository(
  repoRoot: string,
  settings: IUnusedFilesSettings,
): Promise<IUnusedFilesReport> {
  const files = await collectFiles(repoRoot, settings);
  const known = new Set(files);
  const edges = new Map<string, Set<string>>();
  for (const repoPath of files) {
    const text = await Deno.readTextFile(join(repoRoot, repoPath));
    const sourceFile = ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, true);
    const targets = new Set<string>();
    for (const specifier of specifiersOf(sourceFile)) {
      const target = resolveTarget(repoPath, specifier, settings);
      if (target !== null && known.has(target)) targets.add(target);
    }
    edges.set(repoPath, targets);
  }
  const reached = new Set(files.filter((repoPath) => isEntryFile(repoPath, settings)));
  const queue = [...reached];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const target of edges.get(current) ?? []) {
      if (reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  const findings = files
    .filter((repoPath) => isProductionFile(repoPath, settings) && !reached.has(repoPath))
    .map((repoPath) => ({ repoPath }))
    .sort((left, right) => left.repoPath.localeCompare(right.repoPath));
  return { findings, scannedFileCount: files.length };
}
