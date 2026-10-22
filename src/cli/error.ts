/**
 * @module CliError
 * @path src/cli/error.ts
 * @description Typed CLI failure with the documented exit code: 2 for usage, 1 for invalid content.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [src/cli/unslop.ts]
 */

/** A usage error exits 2; invalid file content exits 1. */
export const USAGE_EXIT = 2;

/** Invalid file content or a failed validation exits 1. */
export const FAILURE_EXIT = 1;

/** A CLI failure that carries the process exit code. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
