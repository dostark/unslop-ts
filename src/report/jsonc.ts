/**
 * @module HealthJsonc
 * @path src/report/jsonc.ts
 * @description Reads JSON with comments and trailing commas, leaving every string value untouched.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/report/aliases.ts, src/rules/whole_tree/unused_exports_resolved.ts]
 */

const STRING_QUOTE = '"';
const ESCAPE = "\\";
const CLOSERS: ReadonlySet<string> = new Set(["}", "]"]);

/** The index after the string literal that starts at `start`. */
function endOfString(text: string, start: number): number {
  let end = start + 1;
  while (end < text.length && text[end] !== STRING_QUOTE) end += text[end] === ESCAPE ? 2 : 1;
  return end + 1;
}

/** The index of the next non-space character at or after `from`. */
function skipSpace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

/** The text without `//` and block comments. Strings are copied as written. */
function withoutComments(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === STRING_QUOTE) {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

/** The text without a comma that sits directly before a closing brace or bracket. Strings are copied as written. */
function withoutTrailingCommas(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === STRING_QUOTE) {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (char === "," && CLOSERS.has(text[skipSpace(text, index + 1)] ?? "")) {
      index++;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

/** The text without comments and without trailing commas, with every string value untouched. */
function stripJsonc(text: string): string {
  return withoutTrailingCommas(withoutComments(text));
}

/** Parses JSON that may carry comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text));
}
