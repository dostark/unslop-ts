/**
 * @module GlobMatch
 * @path src/engine/glob.ts
 * @description Matches a repository-relative path against extended globs, with one compiled pattern per glob.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/engine/plugin.ts, src/rules/import_rules.ts]
 *
 * The glob-to-regexp conversion is a port of `@std/path` (MIT, Deno authors).
 * It is fixed to the POSIX dialect with extended syntax and globstar enabled.
 */

const REG_EXP_ESCAPE_CHARS = ["!", "$", "(", ")", "*", "+", ".", "=", "?", "[", "\\", "^", "{", "|"];
const RANGE_ESCAPE_CHARS = ["-", "\\", "]"];
const POSIX_SEPARATOR = "/";
const POSIX_SEP = "/+";
const POSIX_SEP_MAYBE = "/*";
const POSIX_GLOBSTAR = "(?:[^/]*(?:/|$)+)*";
const POSIX_WILDCARD = "[^/]*";
const ESCAPE_PREFIX = "\\";
const EMPTY_GLOB = /(?!)/;

const compiledGlobs = new Map<string, RegExp>();

/** Converts an extended, globstar POSIX glob to an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  if (glob === "") return EMPTY_GLOB;

  let newLength = glob.length;
  for (; newLength > 1 && glob[newLength - 1] === POSIX_SEPARATOR; newLength--);
  glob = glob.slice(0, newLength);

  let regExpString = "";

  // Each iteration handles one path segment.
  for (let j = 0; j < glob.length;) {
    let segment = "";
    const groupStack: string[] = [];
    let inRange = false;
    let inEscape = false;
    let endsWithSep = false;
    let i = j;

    for (; i < glob.length && !(glob[i] === POSIX_SEPARATOR && groupStack.length === 0); i++) {
      if (inEscape) {
        inEscape = false;
        const escapeChars = inRange ? RANGE_ESCAPE_CHARS : REG_EXP_ESCAPE_CHARS;
        segment += escapeChars.includes(glob[i]) ? `\\${glob[i]}` : glob[i];
        continue;
      }

      if (glob[i] === ESCAPE_PREFIX) {
        inEscape = true;
        continue;
      }

      if (glob[i] === "[") {
        if (!inRange) {
          inRange = true;
          segment += "[";
          if (glob[i + 1] === "!") {
            i++;
            segment += "^";
          } else if (glob[i + 1] === "^") {
            i++;
            segment += "\\^";
          }
          continue;
        } else if (glob[i + 1] === ":") {
          let k = i + 1;
          let value = "";
          while (glob[k + 1] !== undefined && glob[k + 1] !== ":") {
            value += glob[k + 1];
            k++;
          }
          if (glob[k + 1] === ":" && glob[k + 2] === "]") {
            i = k + 2;
            if (value === "alnum") segment += "\\dA-Za-z";
            else if (value === "alpha") segment += "A-Za-z";
            else if (value === "ascii") segment += "\x00-\x7F";
            else if (value === "blank") segment += "\t ";
            else if (value === "cntrl") segment += "\x00-\x1F\x7F";
            else if (value === "digit") segment += "\\d";
            else if (value === "graph") segment += "\x21-\x7E";
            else if (value === "lower") segment += "a-z";
            else if (value === "print") segment += "\x20-\x7E";
            else if (value === "punct") {
              segment += "!\"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_‘{|}~";
            } else if (value === "space") segment += "\\s\v";
            else if (value === "upper") segment += "A-Z";
            else if (value === "word") segment += "\\w";
            else if (value === "xdigit") segment += "\\dA-Fa-f";
            continue;
          }
        }
      }

      if (glob[i] === "]" && inRange) {
        inRange = false;
        segment += "]";
        continue;
      }

      if (inRange) {
        segment += glob[i];
        continue;
      }

      if (glob[i] === ")" && groupStack.length > 0 && groupStack[groupStack.length - 1] !== "BRACE") {
        segment += ")";
        const type = groupStack.pop();
        if (type === "!") {
          segment += POSIX_WILDCARD;
        } else if (type !== "@") {
          segment += type ?? "";
        }
        continue;
      }

      if (glob[i] === "|" && groupStack.length > 0 && groupStack[groupStack.length - 1] !== "BRACE") {
        segment += "|";
        continue;
      }

      if (glob[i] === "+" && glob[i + 1] === "(") {
        i++;
        groupStack.push("+");
        segment += "(?:";
        continue;
      }

      if (glob[i] === "@" && glob[i + 1] === "(") {
        i++;
        groupStack.push("@");
        segment += "(?:";
        continue;
      }

      if (glob[i] === "?") {
        if (glob[i + 1] === "(") {
          i++;
          groupStack.push("?");
          segment += "(?:";
        } else {
          segment += ".";
        }
        continue;
      }

      if (glob[i] === "!" && glob[i + 1] === "(") {
        i++;
        groupStack.push("!");
        segment += "(?!";
        continue;
      }

      if (glob[i] === "{") {
        groupStack.push("BRACE");
        segment += "(?:";
        continue;
      }

      if (glob[i] === "}" && groupStack[groupStack.length - 1] === "BRACE") {
        groupStack.pop();
        segment += ")";
        continue;
      }

      if (glob[i] === "," && groupStack[groupStack.length - 1] === "BRACE") {
        segment += "|";
        continue;
      }

      if (glob[i] === "*") {
        if (glob[i + 1] === "(") {
          i++;
          groupStack.push("*");
          segment += "(?:";
        } else {
          const prevChar = glob[i - 1];
          let numStars = 1;
          while (glob[i + 1] === "*") {
            i++;
            numStars++;
          }
          const nextChar = glob[i + 1];
          const atBoundary = (char: string | undefined): boolean => char === undefined || char === POSIX_SEPARATOR;
          if (numStars === 2 && atBoundary(prevChar) && atBoundary(nextChar)) {
            segment += POSIX_GLOBSTAR;
            endsWithSep = true;
          } else {
            segment += POSIX_WILDCARD;
          }
        }
        continue;
      }

      segment += REG_EXP_ESCAPE_CHARS.includes(glob[i]) ? `\\${glob[i]}` : glob[i];
    }

    // An unclosed group, an open range, or a dangling escape makes the segment literal.
    if (groupStack.length > 0 || inRange || inEscape) {
      segment = "";
      for (const character of glob.slice(j, i)) {
        segment += REG_EXP_ESCAPE_CHARS.includes(character) ? `\\${character}` : character;
        endsWithSep = false;
      }
    }

    regExpString += segment;
    if (!endsWithSep) {
      regExpString += i < glob.length ? POSIX_SEP : POSIX_SEP_MAYBE;
    }

    while (glob[i] === POSIX_SEPARATOR) i++;
    j = i;
  }

  return new RegExp(`^${regExpString}$`);
}

function globRegex(glob: string): RegExp {
  let regex = compiledGlobs.get(glob);
  if (!regex) {
    regex = globToRegExp(glob);
    compiledGlobs.set(glob, regex);
  }
  return regex;
}

/** True when the path matches at least one of the globs. */
export function matchesAnyGlob(repoPath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globRegex(glob).test(repoPath));
}
