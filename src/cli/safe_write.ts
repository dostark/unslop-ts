/**
 * @module SafeWrite
 * @path src/cli/safe_write.ts
 * @description Cooperative, no-clobber migration writes: canonical paths, sibling locks, staged temps, and an explicit partial-write result.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [src/cli/commands/migrate.ts, src/config/compile.ts]
 */

import { basename, dirname, join, resolve } from "@std/path";
import { FAILURE_EXIT, USAGE_EXIT } from "./error.ts";

const LOCK_SUFFIX = ".unslop.lock";
const TEMP_SUFFIX = ".unslop";
const TEMP_EXTENSION = ".tmp";
const DOT = ".";
const ENCODER = new TextEncoder();

/** One file the writer creates. */
export interface IFileOutput {
  readonly path: string;
  readonly contents: string;
}

/** Test seams for the failure paths; production calls omit them. */
export interface IMigrationWriteHooks {
  /** Runs after the layout link exists and before the configuration link. */
  readonly afterLayoutLinked?: (
    paths: { readonly configPath: string; readonly layoutPath: string },
  ) => void | Promise<void>;
}

/** The pair the writer commits and the inputs it must never overwrite. */
export interface IMigrationWriteInputs {
  readonly config: IFileOutput;
  readonly layout: IFileOutput | null;
  /** Existing input files that no output may alias. */
  readonly sources: readonly string[];
  readonly hooks?: IMigrationWriteHooks;
}

/** The committed paths. */
export interface IMigrationWriteResult {
  readonly configPath: string;
  readonly layoutPath: string | null;
}

/** A destination, alias, symlink, or lock refusal. The CLI maps it to exit 2. */
export class WriteRefusalError extends Error {
  readonly exitCode = USAGE_EXIT;

  constructor(message: string) {
    super(message);
    this.name = "WriteRefusalError";
  }
}

/** A failure after the first destination exists, with the exact surviving paths. The CLI maps it to exit 1. */
export class PartialWriteError extends Error {
  readonly exitCode = FAILURE_EXIT;
  readonly surviving: readonly string[];

  constructor(message: string, surviving: readonly string[]) {
    super(`${message}; surviving: ${surviving.join(", ")}`);
    this.name = "PartialWriteError";
    this.surviving = surviving;
  }
}

interface IStagedFile {
  readonly path: string;
  readonly ino: number | null;
}

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch {
    return null;
  }
}

async function canonicalDestination(path: string): Promise<string> {
  const absolute = resolve(path);
  let parent: string;
  try {
    parent = await Deno.realPath(dirname(absolute));
  } catch {
    throw new WriteRefusalError(`${absolute}: the destination directory does not exist.`);
  }
  if (!(await Deno.stat(parent)).isDirectory) {
    throw new WriteRefusalError(`${parent}: the destination parent is not a directory.`);
  }
  return join(parent, basename(absolute));
}

async function existingRefusal(target: string): Promise<void> {
  const stat = await lstatOrNull(target);
  if (!stat) return;
  if (stat.isSymlink) throw new WriteRefusalError(`${target}: the destination is a symlink.`);
  throw new WriteRefusalError(`${target}: the destination already exists.`);
}

async function sourceAliases(target: string, sources: readonly string[]): Promise<boolean> {
  for (const source of sources) {
    let canonical: string;
    try {
      canonical = await Deno.realPath(source);
    } catch {
      continue;
    }
    if (canonical === target) return true;
  }
  return false;
}

async function acquireLock(target: string): Promise<string> {
  const lockPath = join(dirname(target), `${DOT}${basename(target)}${LOCK_SUFFIX}`);
  try {
    const handle = await Deno.open(lockPath, { createNew: true, write: true });
    handle.close();
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new WriteRefusalError(`${target}: another unslop command holds ${lockPath}.`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new WriteRefusalError(`${target}: cannot create ${lockPath} (${message}).`);
  }
  return lockPath;
}

async function stage(target: string, contents: string): Promise<IStagedFile> {
  const tempPath = join(
    dirname(target),
    `${DOT}${basename(target)}${TEMP_SUFFIX}-${crypto.randomUUID()}${TEMP_EXTENSION}`,
  );
  const handle = await Deno.open(tempPath, { createNew: true, write: true });
  try {
    await handle.write(ENCODER.encode(contents));
  } finally {
    handle.close();
  }
  const stat = await Deno.stat(tempPath);
  return { path: tempPath, ino: stat.ino };
}

async function removeOwnInode(path: string, ino: number | null): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile) return false;
    if (ino !== null && stat.ino !== null && stat.ino !== ino) return false;
    await Deno.remove(path);
    return true;
  } catch {
    return false;
  }
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch {
    // A missing temp or lock is already clean.
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Writes a layout/config pair. It stages both files, hard-links the layout first and the
 * configuration last, and never overwrites an input or an existing destination.
 */
export async function writeMigrationPair(inputs: IMigrationWriteInputs): Promise<IMigrationWriteResult> {
  const configTarget = await canonicalDestination(inputs.config.path);
  const layoutTarget = inputs.layout === null ? null : await canonicalDestination(inputs.layout.path);
  if (layoutTarget !== null && layoutTarget === configTarget) {
    throw new WriteRefusalError(`${configTarget}: --out and --layout-out must name different files.`);
  }
  const targets = layoutTarget === null ? [configTarget] : [layoutTarget, configTarget];
  for (const target of targets) {
    await existingRefusal(target);
    if (await sourceAliases(target, inputs.sources)) {
      throw new WriteRefusalError(`${target}: the destination aliases an input file.`);
    }
  }

  const locks: string[] = [];
  const temps: IStagedFile[] = [];
  try {
    for (const target of [...targets].sort()) locks.push(await acquireLock(target));
    for (const target of targets) await existingRefusal(target);

    temps.push(await stage(configTarget, inputs.config.contents));
    const layoutTemp = layoutTarget === null || inputs.layout === null
      ? null
      : await stage(layoutTarget, inputs.layout.contents);
    if (layoutTemp) temps.push(layoutTemp);

    if (layoutTemp && layoutTarget) {
      await Deno.link(layoutTemp.path, layoutTarget);
      try {
        if (inputs.hooks?.afterLayoutLinked) {
          await inputs.hooks.afterLayoutLinked({ configPath: configTarget, layoutPath: layoutTarget });
        }
        await Deno.link(temps[0].path, configTarget);
      } catch (error) {
        const surviving: string[] = [];
        if (!await removeOwnInode(layoutTarget, layoutTemp.ino)) surviving.push(layoutTarget);
        if (surviving.length > 0) {
          throw new PartialWriteError(
            `${configTarget}: the configuration was not created and cleanup failed (${asError(error).message})`,
            surviving,
          );
        }
        throw asError(error);
      }
    } else {
      await Deno.link(temps[0].path, configTarget);
    }
    return { configPath: configTarget, layoutPath: layoutTarget };
  } finally {
    for (const temp of temps) await removeQuietly(temp.path);
    for (const lock of locks) await removeQuietly(lock);
  }
}

/** One in-place replacement of an existing file. */
export interface IReplaceFileInput {
  readonly path: string;
  readonly contents: string;
  /** The exact text the caller read before it planned the change. */
  readonly expected: string;
  readonly hooks?: {
    /** Runs under the lock and before the final byte and identity comparison. */
    readonly beforeCompare?: () => void | Promise<void>;
  };
}

/**
 * Replaces an existing regular file: it locks, compares the current bytes and identity,
 * preserves the mode, and renames a private temp over the destination.
 */
export async function replaceFile(input: IReplaceFileInput): Promise<string> {
  const target = await canonicalDestination(input.path);
  const initial = await lstatOrNull(target);
  if (!initial) throw new WriteRefusalError(`${target}: the file does not exist.`);
  if (initial.isSymlink) throw new WriteRefusalError(`${target}: the destination is a symlink.`);
  if (!initial.isFile) throw new WriteRefusalError(`${target}: the destination is not a regular file.`);
  const lock = await acquireLock(target);
  let temp: IStagedFile | null = null;
  try {
    if (input.hooks?.beforeCompare) await input.hooks.beforeCompare();
    const current = await Deno.readTextFile(target);
    const currentStat = await Deno.lstat(target);
    const inoChanged = initial.ino !== null && currentStat.ino !== null && initial.ino !== currentStat.ino;
    if (!currentStat.isFile || inoChanged || current !== input.expected) {
      throw new WriteRefusalError(`${target}: the file changed while the command ran; re-run the command.`);
    }
    temp = await stage(target, input.contents);
    if (initial.mode !== null) await Deno.chmod(temp.path, initial.mode);
    await Deno.rename(temp.path, target);
    return target;
  } finally {
    if (temp) await removeQuietly(temp.path);
    await removeQuietly(lock);
  }
}
