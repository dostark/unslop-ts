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
const EXTENDED_GROUP_OPENERS: Readonly<Record<string, string>> = { "+": "+", "@": "@", "!": "!", "*": "*" };
const POSIX_CLASSES: Readonly<Record<string, string>> = {
  alnum: "\\dA-Za-z",
  alpha: "A-Za-z",
  ascii: "\x00-\x7F",
  blank: "\t ",
  cntrl: "\x00-\x1F\x7F",
  digit: "\\d",
  graph: "\x21-\x7E",
  lower: "a-z",
  print: "\x20-\x7E",
  punct: "!\"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_‘{|}~",
  space: "\\s\v",
  upper: "A-Z",
  word: "\\w",
  xdigit: "\\dA-Fa-f",
};

interface ISegmentState {
  readonly glob: string;
  segment: string;
  readonly groupStack: string[];
  inRange: boolean;
  inEscape: boolean;
  endsWithSep: boolean;
  index: number;
}

type Consumer = (state: ISegmentState) => boolean;

const CONSUMERS: readonly Consumer[] = [
  consumeEscape,
  consumeRangeStart,
  consumeRangeClass,
  consumeRangeEnd,
  consumeRangeBody,
  consumeGroupClose,
  consumeGroupBar,
  consumeAnyCharacter,
  consumeGroupOpen,
  consumeBrace,
  consumeStar,
];

function consumeEscape(state: ISegmentState): boolean {
  const character = globCharacter(state);
  if (!state.inEscape && character !== ESCAPE_PREFIX) return false;
  if (!state.inEscape) {
    state.inEscape = true;
    return true;
  }
  state.inEscape = false;
  const escapeChars = state.inRange ? RANGE_ESCAPE_CHARS : REG_EXP_ESCAPE_CHARS;
  state.segment += escapeChars.includes(character) ? `\\${character}` : character;
  return true;
}

function globCharacter(state: ISegmentState): string {
  return state.glob[state.index];
}

function consumeRangeStart(state: ISegmentState): boolean {
  if (globCharacter(state) !== "[" || state.inRange) return false;
  state.inRange = true;
  state.segment += "[";
  const next = state.glob[state.index + 1];
  if (next === "!") {
    state.index++;
    state.segment += "^";
  } else if (next === "^") {
    state.index++;
    state.segment += "\\^";
  }
  return true;
}

function consumeRangeClass(state: ISegmentState): boolean {
  if (!state.inRange || globCharacter(state) !== "[" || state.glob[state.index + 1] !== ":") return false;
  let cursor = state.index + 1;
  let name = "";
  while (state.glob[cursor + 1] !== undefined && state.glob[cursor + 1] !== ":") {
    name += state.glob[cursor + 1];
    cursor++;
  }
  if (state.glob[cursor + 1] !== ":" || state.glob[cursor + 2] !== "]") {
    state.segment += "[";
    return true;
  }
  state.index = cursor + 2;
  state.segment += POSIX_CLASSES[name] ?? "";
  return true;
}

function consumeRangeEnd(state: ISegmentState): boolean {
  if (globCharacter(state) !== "]" || !state.inRange) return false;
  state.inRange = false;
  state.segment += "]";
  return true;
}

function consumeRangeBody(state: ISegmentState): boolean {
  if (!state.inRange) return false;
  state.segment += globCharacter(state);
  return true;
}

function consumeGroupClose(state: ISegmentState): boolean {
  if (globCharacter(state) !== ")" || state.groupStack.length === 0) return false;
  if (state.groupStack[state.groupStack.length - 1] === "BRACE") return false;
  state.segment += ")";
  const type = state.groupStack.pop();
  if (type === "!") state.segment += POSIX_WILDCARD;
  else if (type !== "@") state.segment += type ?? "";
  return true;
}

function consumeGroupBar(state: ISegmentState): boolean {
  if (globCharacter(state) !== "|" || state.groupStack.length === 0) return false;
  if (state.groupStack[state.groupStack.length - 1] === "BRACE") return false;
  state.segment += "|";
  return true;
}

function consumeAnyCharacter(state: ISegmentState): boolean {
  if (globCharacter(state) !== "?") return false;
  if (state.glob[state.index + 1] === "(") {
    state.index++;
    state.groupStack.push("?");
    state.segment += "(?:";
    return true;
  }
  state.segment += ".";
  return true;
}

function consumeGroupOpen(state: ISegmentState): boolean {
  if (state.glob[state.index + 1] !== "(") return false;
  const opener = globCharacter(state);
  if (opener === "?") {
    state.index++;
    state.groupStack.push("?");
    state.segment += "(?:";
    return true;
  }
  const type = EXTENDED_GROUP_OPENERS[opener];
  if (type === undefined) return false;
  state.index++;
  state.groupStack.push(type);
  state.segment += type === "!" ? "(?!" : "(?:";
  return true;
}

function consumeBrace(state: ISegmentState): boolean {
  const character = globCharacter(state);
  const top = state.groupStack[state.groupStack.length - 1];
  if (character === "{") {
    state.groupStack.push("BRACE");
    state.segment += "(?:";
    return true;
  }
  if (character === "}" && top === "BRACE") {
    state.groupStack.pop();
    state.segment += ")";
    return true;
  }
  if (character === "," && top === "BRACE") {
    state.segment += "|";
    return true;
  }
  return false;
}

function consumeStar(state: ISegmentState): boolean {
  if (globCharacter(state) !== "*") return false;
  if (state.glob[state.index + 1] === "(") {
    state.index++;
    state.groupStack.push("*");
    state.segment += "(?:";
    return true;
  }
  const previous = state.glob[state.index - 1];
  let stars = 1;
  while (state.glob[state.index + 1] === "*") {
    state.index++;
    stars++;
  }
  const next = state.glob[state.index + 1];
  const atBoundary = (character: string | undefined): boolean =>
    character === undefined || character === POSIX_SEPARATOR;
  if (stars === 2 && atBoundary(previous) && atBoundary(next)) {
    state.segment += POSIX_GLOBSTAR;
    state.endsWithSep = true;
  } else {
    state.segment += POSIX_WILDCARD;
  }
  return true;
}

function consumeLiteral(state: ISegmentState): void {
  const character = globCharacter(state);
  state.segment += REG_EXP_ESCAPE_CHARS.includes(character) ? `\\${character}` : character;
}

function trimTrailingSeparators(glob: string): string {
  let length = glob.length;
  for (; length > 1 && glob[length - 1] === POSIX_SEPARATOR; length--);
  return glob.slice(0, length);
}

function literalSegment(glob: string, start: number, end: number): string {
  let segment = "";
  for (const character of glob.slice(start, end)) {
    segment += REG_EXP_ESCAPE_CHARS.includes(character) ? `\\${character}` : character;
  }
  return segment;
}

/** Converts an extended, globstar POSIX glob to an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  if (glob === "") return EMPTY_GLOB;
  glob = trimTrailingSeparators(glob);
  let regExpString = "";
  for (let start = 0; start < glob.length;) {
    const state: ISegmentState = {
      glob,
      segment: "",
      groupStack: [],
      inRange: false,
      inEscape: false,
      endsWithSep: false,
      index: start,
    };
    for (
      ;
      state.index < glob.length &&
      !(globCharacter(state) === POSIX_SEPARATOR && state.groupStack.length === 0);
      state.index++
    ) {
      applyConsumer(state);
    }
    const end = state.index;
    if (state.groupStack.length > 0 || state.inRange || state.inEscape) {
      state.segment = literalSegment(state.glob, start, end);
      state.endsWithSep = false;
    }
    regExpString += state.segment;
    if (!state.endsWithSep) regExpString += end < glob.length ? POSIX_SEP : POSIX_SEP_MAYBE;
    start = end;
    while (glob[start] === POSIX_SEPARATOR) start++;
  }
  return new RegExp(`^${regExpString}$`);
}

function applyConsumer(state: ISegmentState): void {
  for (const consume of CONSUMERS) {
    if (consume(state)) return;
  }
  consumeLiteral(state);
}

const compiledGlobs = new Map<string, RegExp>();

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
