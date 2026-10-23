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
  from = resolve(from);
  to = resolve(to);
  if (from === to) return "";

  let fromStart = 1;
  const fromEnd = from.length;
  for (; fromStart < fromEnd; ++fromStart) {
    if (!isPosixPathSeparator(from.charCodeAt(fromStart))) break;
  }
  const fromLen = fromEnd - fromStart;

  let toStart = 1;
  const toEnd = to.length;
  for (; toStart < toEnd; ++toStart) {
    if (!isPosixPathSeparator(to.charCodeAt(toStart))) break;
  }
  const toLen = toEnd - toStart;

  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (isPosixPathSeparator(to.charCodeAt(toStart + i))) {
          return to.slice(toStart + i + 1);
        } else if (i === 0) {
          return to.slice(toStart + i);
        }
      } else if (fromLen > length) {
        if (isPosixPathSeparator(from.charCodeAt(fromStart + i))) {
          lastCommonSep = i;
        } else if (i === 0) {
          lastCommonSep = 0;
        }
      }
      break;
    }
    const fromCode = from.charCodeAt(fromStart + i);
    const toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode) break;
    else if (isPosixPathSeparator(fromCode)) lastCommonSep = i;
  }

  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || isPosixPathSeparator(from.charCodeAt(i))) {
      out += out.length === 0 ? ".." : "/..";
    }
  }

  if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
  toStart += lastCommonSep;
  if (isPosixPathSeparator(to.charCodeAt(toStart))) ++toStart;
  return to.slice(toStart);
}
