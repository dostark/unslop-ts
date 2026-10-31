/**
 * @module MeasurementContext
 * @path src/metrics/context.ts
 * @description Per-file parser context: code tokens and one-based UTF-16 positions from Babel.
 * @architectural-layer Shared
 * @dependencies [@babel/parser]
 * @related-files [src/metrics/types.ts, src/metrics/function_metrics.ts]
 */

import { lineAt, lineStarts } from "../engine/module_layout.ts";
import { parse, type ParseResult, type ParserPlugin } from "@babel/parser";
import type { IMeasurementContext, IMeasurementSource, IMetricPosition, IMetricToken } from "./types.ts";

/** The token fields the metric core reads from the parser token stream. */
interface IParserToken {
  readonly type: { readonly label: string | null };
  readonly start: number;
  readonly end: number;
}

/** The measured tokens of one file, with the start of every optional-link token. */
interface ICollectedTokens {
  readonly tokens: IMetricToken[];
  readonly optionalChainOffsets: number[];
}

/** The extra syntax Deno accepts and Babel enables only on request. */
const SYNTAX_PLUGINS: readonly ParserPlugin[] = [
  ["decorators", {}],
  "decoratorAutoAccessors",
  "explicitResourceManagement",
  "importAttributes",
];

const END_OF_FILE_LABEL = "eof";
const JSX_TEXT_LABEL = "jsxText";
const QUESTION_DOT_LABEL = "?.";
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([".cjs", ".cts"]);

/** The lowercase extension of a filename, or the empty string. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/** The syntax plugins a filename needs, so TSX and JSX parse as markup. */
function parserPlugins(filename: string): ParserPlugin[] {
  switch (extensionOf(filename)) {
    case ".tsx":
      return ["typescript", "jsx"];
    case ".jsx":
    case ".js":
    case ".mjs":
    case ".cjs":
      return ["jsx"];
    case ".ts":
    case ".mts":
    case ".cts":
      return ["typescript"];
    default:
      return ["typescript"];
  }
}

/** True for the extensions whose files run as scripts rather than modules. */
function isScript(filename: string): boolean {
  return SCRIPT_EXTENSIONS.has(extensionOf(filename));
}

/** Parses one source text with the pinned parser, naming the file when the parser rejects it. */
export function parseSourceText(text: string, filename: string): ParseResult {
  try {
    return parse(text, {
      sourceType: isScript(filename) ? "script" : "module",
      plugins: [...parserPlugins(filename), ...SYNTAX_PLUGINS],
      tokens: true,
      ranges: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Metrics cannot parse ${filename}: ${reason}`);
  }
}

/** True when the token is code that a line count and a metric must keep. */
function isMeasuredToken(token: IParserToken, text: string): boolean {
  const label = token.type.label;
  // A comment token carries no label, so only a string label marks code.
  if (typeof label !== "string" || label === END_OF_FILE_LABEL) return false;
  if (label !== JSX_TEXT_LABEL) return true;
  return text.slice(token.start, token.end).trim().length > 0;
}

/** Reads the parser token stream into metric tokens and optional-link offsets. */
function collectTokens(tree: ParseResult, text: string): ICollectedTokens {
  const tokens: IMetricToken[] = [];
  const optionalChainOffsets: number[] = [];
  const parsed = (tree.tokens ?? []) as readonly IParserToken[];
  for (const token of parsed) {
    if (!isMeasuredToken(token, text)) continue;
    tokens.push({ start: token.start, end: token.end });
    if (token.type.label === QUESTION_DOT_LABEL) optionalChainOffsets.push(token.start);
  }
  return { tokens, optionalChainOffsets };
}

/** The one-based line and column of an offset, found by binary search over the line starts. */
function positionOf(starts: readonly number[], offset: number): IMetricPosition {
  const line = lineAt(starts, offset);
  return { line, column: offset - starts[line - 1] + 1 };
}

/** Builds the tokens and position lookup of an already parsed source text. */
export function measurementContextOf(tree: ParseResult, text: string): IMeasurementContext {
  const collected = collectTokens(tree, text);
  const starts = lineStarts(text);
  return {
    syntaxTree: tree,
    tokens: collected.tokens,
    optionalChainOffsets: collected.optionalChainOffsets,
    positionAt(offset: number): IMetricPosition {
      return positionOf(starts, offset);
    },
  };
}

/** Parses the source text once and returns its tokens and position lookup. */
export function createMeasurementContext(
  sourceCode: IMeasurementSource,
  filename: string,
): IMeasurementContext {
  return measurementContextOf(parseSourceText(sourceCode.text, filename), sourceCode.text);
}
