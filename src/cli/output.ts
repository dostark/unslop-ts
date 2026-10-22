/**
 * @module CliOutput
 * @path src/cli/output.ts
 * @description Deterministic JSON and aligned table output for the CLI, with no terminal colors.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/cli/rules_read.ts, src/cli/presets.ts, src/cli/config_read.ts]
 */

import { CliError, USAGE_EXIT } from "./error.ts";

const NEWLINE = "\n";
const COLUMN_SEPARATOR = "  ";
const ENCODER = new TextEncoder();

/** The two output formats a query command accepts. */
export type OutputFormat = "table" | "json";

/** Parses a format option, rejecting every other value as a usage error. */
export function parseFormat(value: string | undefined): OutputFormat {
  if (value === undefined) return "table";
  if (value === "table" || value === "json") return value;
  throw new CliError(USAGE_EXIT, `unknown format '${value}'`);
}

/** Two-space JSON with a trailing newline. */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}${NEWLINE}`;
}

/** A table whose columns are left-aligned and separated by two spaces. */
export function tableText(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length))
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(COLUMN_SEPARATOR).trimEnd();
  const separator = widths.map((width) => "-".repeat(width)).join(COLUMN_SEPARATOR);
  return [line(headers), separator, ...rows.map(line)].join(NEWLINE) + NEWLINE;
}

/** Writes a successful result to standard output. */
export function print(text: string): void {
  Deno.stdout.writeSync(ENCODER.encode(text));
}

/** Writes a failure to standard error. */
export function printError(text: string): void {
  Deno.stderr.writeSync(ENCODER.encode(text));
}
