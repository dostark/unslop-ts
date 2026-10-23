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

const CHAR_DOT = 46;
const CHAR_FORWARD_SLASH = 47;
const SEPARATOR = "/";

function isPosixPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH;
}

/** Resolves `.` and `..` elements in a path with directory names. */
function normalizeString(path: string, allowAboveRoot: boolean): string {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code: number | undefined;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (isPosixPathSeparator(code ?? 0)) {
      break;
    } else {
      code = CHAR_FORWARD_SLASH;
    }

    if (isPosixPathSeparator(code ?? 0)) {
      if (lastSlash === i - 1 || dots === 1) {
        // A repeated separator or a single dot: nothing to add.
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== CHAR_DOT ||
          res.charCodeAt(res.length - 2) !== CHAR_DOT
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(SEPARATOR);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(SEPARATOR);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length === 2 || res.length === 1) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0) res += `${SEPARATOR}..`;
          else res = "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += SEPARATOR + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
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
