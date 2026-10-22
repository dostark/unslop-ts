/**
 * @module ReportSnapshot
 * @path src/report/snapshot.ts
 * @description Captures the requested source operands as immutable fingerprint input.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [src/report/context.ts, src/cli/commands/report.ts]
 */

import { extname, join, relative } from "@std/path";
import type { ISourceSnapshot } from "./context.ts";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

/** A symlink escape or unreadable source operand. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

function isWithin(root: string, path: string): boolean {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path === root || path.startsWith(prefix);
}

async function readSource(realPath: string): Promise<Uint8Array> {
  try {
    return await Deno.readFile(realPath);
  } catch {
    throw new SnapshotError(`${realPath}: cannot read the source file.`);
  }
}

/**
 * Snapshots every source file under the validated operands. Canonical directories are
 * visited once, logical aliases share bytes, and escaping symlinks are refused.
 */
export async function captureSources(
  operands: readonly string[],
  root: string,
): Promise<ReadonlyMap<string, ISourceSnapshot>> {
  const snapshots = new Map<string, ISourceSnapshot>();
  const byCanonical = new Map<string, ISourceSnapshot>();
  const visitedDirectories = new Set<string>();

  const addFile = async (logicalPath: string, realPath: string): Promise<void> => {
    const canonical = await Deno.realPath(realPath);
    if (!isWithin(root, canonical)) throw new SnapshotError(`${logicalPath}: the source escapes the project root.`);
    if (!SOURCE_EXTENSIONS.has(extname(canonical))) return;
    let snapshot = byCanonical.get(canonical);
    if (!snapshot) {
      snapshot = { canonicalPath: canonical, bytes: await readSource(canonical) };
      byCanonical.set(canonical, snapshot);
    }
    snapshots.set(relative(root, logicalPath), snapshot);
    snapshots.set(relative(root, canonical), snapshot);
  };

  const visit = async (path: string, logicalPath: string): Promise<void> => {
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      const realPath = await Deno.realPath(path);
      if (!isWithin(root, realPath)) throw new SnapshotError(`${logicalPath}: the symlink escapes the project root.`);
      const target = await Deno.stat(realPath);
      if (target.isDirectory) {
        const canonical = await Deno.realPath(realPath);
        if (visitedDirectories.has(canonical)) return;
        await visitDirectory(realPath, logicalPath, canonical);
      } else {
        await addFile(logicalPath, realPath);
      }
      return;
    }
    if (stat.isDirectory) {
      const canonical = await Deno.realPath(path);
      if (visitedDirectories.has(canonical)) return;
      await visitDirectory(path, logicalPath, canonical);
      return;
    }
    await addFile(logicalPath, path);
  };

  const visitDirectory = async (path: string, logicalPath: string, canonical: string): Promise<void> => {
    visitedDirectories.add(canonical);
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(path)) entries.push(entry);
    } catch {
      throw new SnapshotError(`${path}: cannot read the source directory.`);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      await visit(join(path, entry.name), join(logicalPath, entry.name));
    }
  };

  for (const operand of operands) await visit(operand, operand);
  return snapshots;
}
