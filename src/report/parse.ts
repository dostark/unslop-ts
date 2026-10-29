/**
 * @module HealthParse
 * @path src/report/parse.ts
 * @description Deno-only file snapshot for the health report: one read, one parse, matching metric context.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/metrics/context.ts, src/metrics/function_metrics.ts, src/report/health.ts]
 */

import { measurementContextOf, parseSourceText } from "../metrics/context.ts";
import { functionUnits } from "../metrics/function_metrics.ts";
import type { IFunctionUnit, IMeasurementContext } from "../metrics/types.ts";

/** The largest accepted source file, named once so the report can state its bound. */
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

/** One parsed source file: the bytes read once, their digest, the tree and the metric context. */
export interface IParsedHealthFile {
  /** The repository-relative POSIX path. */
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly tree: IMeasurementContext["syntaxTree"];
  readonly context: IMeasurementContext;
  readonly units: readonly IFunctionUnit[];
}

/** Encodes a digest as lowercase hexadecimal. */
function hexOf(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Reads one source file once under the size bound, then parses that same read. */
export async function parseHealthFile(absolutePath: string, relativePath: string): Promise<IParsedHealthFile> {
  const bytes = await Deno.readFile(absolutePath);
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`${relativePath}: the file exceeds the ${MAX_SOURCE_BYTES} byte source bound.`);
  }
  const text = new TextDecoder().decode(bytes);
  const tree = parseSourceText(text, relativePath);
  const context = measurementContextOf(tree, text);
  return {
    path: relativePath,
    text,
    bytes: bytes.byteLength,
    sha256: hexOf(await crypto.subtle.digest("SHA-256", bytes)),
    tree,
    context,
    units: functionUnits(tree.program, context),
  };
}
