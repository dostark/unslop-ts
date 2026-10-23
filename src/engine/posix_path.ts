/**
 * @module PosixPath
 * @path src/engine/posix_path.ts
 * @description POSIX `dirname`, `join`, and `normalize` for the rules, without `@std/path`.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/rules/import_boundaries.ts, tests/posix_path_test.ts]
 *
 * Ported from `@std/path/posix` (MIT, Deno authors; originally path-browserify, MIT).
 * The helpers accept strings only, so the URL overloads of the originals are omitted.
 */

const CHAR_FORWARD_SLASH = 47;
const SEPARATOR = "/";

function isPosixPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH;
}

/** Resolves `.` and `..` elements in a path with directory names. */
function normalizeString(path: string, allowAboveRoot: boolean): string {
  const segments: string[] = [];
  for (const segment of path.split(SEPARATOR)) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
    else if (allowAboveRoot) segments.push("..");
  }
  return segments.join(SEPARATOR);
}

function stripTrailingSeparators(segment: string): string {
  if (segment.length <= 1) return segment;

  let end = segment.length;
  for (let i = segment.length - 1; i > 0; i--) {
    if (isPosixPathSeparator(segment.charCodeAt(i))) {
      end = i;
    } else {
      break;
    }
  }
  return segment.slice(0, end);
}

/** Normalizes the path, resolving `.` and `..` segments. An empty path is `.`. */
export function normalize(path: string): string {
  const isAbsolute = isPosixPathSeparator(path.charCodeAt(0));
  const trailingSeparator = isPosixPathSeparator(path.charCodeAt(path.length - 1));

  path = normalizeString(path, !isAbsolute);

  if (path.length === 0 && !isAbsolute) path = ".";
  if (path.length > 0 && trailingSeparator) path += SEPARATOR;

  if (isAbsolute) return `/${path}`;
  return path;
}

/** Returns the directory path of a path. */
export function dirname(path: string): string {
  let end = -1;
  let matchedNonSeparator = false;

  for (let i = path.length - 1; i >= 1; --i) {
    if (isPosixPathSeparator(path.charCodeAt(i))) {
      if (matchedNonSeparator) {
        end = i;
        break;
      }
    } else {
      matchedNonSeparator = true;
    }
  }

  if (end === -1) {
    return isPosixPathSeparator(path.charCodeAt(0)) ? SEPARATOR : ".";
  }

  return stripTrailingSeparators(path.slice(0, end));
}

/** Joins the paths and normalizes the result. */
export function join(...paths: string[]): string {
  const joined = paths.filter((path) => path.length > 0).join(SEPARATOR);
  return joined === "" ? "." : normalize(joined);
}

/** Resolves segments into an absolute path. Without an absolute segment the root anchors the path. */
export function resolve(...segments: string[]): string {
  let resolved = "";
  let absolute = false;
  for (let i = segments.length - 1; i >= 0 && !absolute; i--) {
    const segment = segments[i];
    if (segment.length === 0) continue;
    resolved = resolved.length === 0 ? segment : `${segment}/${resolved}`;
    absolute = segment.startsWith(SEPARATOR);
  }
  return normalize(`${SEPARATOR}${resolved}`);
}

/** Returns the relative path from `from` to `to`. Both are resolved from the root first. */
export function relative(from: string, to: string): string {
  const fromPath = resolve(from);
  const toPath = resolve(to);
  if (fromPath === toPath) return "";
  const fromParts = fromPath.split(SEPARATOR).filter((part) => part.length > 0);
  const toParts = toPath.split(SEPARATOR).filter((part) => part.length > 0);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++;
  return [...Array<string>(fromParts.length - common).fill(".."), ...toParts.slice(common)].join(SEPARATOR);
}
